/**
 * VU Meter (McIntosh) — a Canvas 2D visualizer. Same ballistic VU math as `VUMeter`, restyled
 * as a single McIntosh-style wide meter window: brushed-metal housing with corner screws, one
 * deep cobalt-blue lamp-lit glass face holding both channels as stacked rows (L on top, R
 * below). Each row carries a real power-meter's dual scale — an outer WATTS ring and an inner
 * DECIBELS ring, both read by one tapered needle — plus the current Sendspin track (artist /
 * title) printed below the glass, falling back to "Music Assistant" when no track info is
 * available.
 */
import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

// --- VU meter arc geometry (angles from vertical in radians, negative = left) ---
// A shallow sweep (narrow angle range) so the scale reads almost edge-to-edge across a wide
// window with modest vertical rise, like a real meter's needle pivoting far below the dial.
// Symmetric around 0° so the curve itself — not just its bounding box — sits visually centered.
const ARC_START_DEG = -30;
const ARC_END_DEG = 30;
const ARC_START = (ARC_START_DEG * Math.PI) / 180;
const ARC_END = (ARC_END_DEG * Math.PI) / 180;
const ARC_SPAN = ARC_END - ARC_START;

// --- Printed scale graduation ---
// A real meter's needle follows a log response, but its printed tick marks are drawn evenly
// spaced across the dial face — not crowded together the way a strict log scale would put them.
// Five equal 10 dB steps (-50..0), then a smaller 0.3x step out to the +3 dB headroom mark —
// mirrors the reference photo, where the -50..0 ticks are evenly fanned and the +3 overload tick
// sits closer to 0 than a full 10 dB step away.
const DB_MARKS = [-50, -40, -30, -20, -10, 0, 3];
const TICK_WEIGHTS = [1, 1, 1, 1, 1, 0.3];
const TICK_WEIGHT_SUM = TICK_WEIGHTS.reduce((a, b) => a + b, 0);
function computeTickAngles(): number[] {
  const angles = [ARC_START];
  let acc = 0;
  for (const wgt of TICK_WEIGHTS) {
    acc += wgt;
    angles.push(ARC_START + (acc / TICK_WEIGHT_SUM) * ARC_SPAN);
  }
  return angles;
}
const TICK_ANGLES = computeTickAngles();

/**
 * The needle's angle for a given VU/dB level — interpolated along the SAME evenly-fanned scale
 * as the printed tick marks (not a separate true-log curve). Using a different curve for the
 * needle than for the graduation it points at used to pull them far apart (e.g. the true-log
 * angle for -20 dB sits barely past the scale's start, while the printed "-20" tick sits past
 * the middle), so the needle never pointed at the number matching its own level.
 */
function vuToAngle(vu: number): number {
  const v = Math.max(DB_MARKS[0], Math.min(DB_MARKS[DB_MARKS.length - 1], vu));
  for (let i = 0; i < DB_MARKS.length - 1; i++) {
    const a = DB_MARKS[i];
    const b = DB_MARKS[i + 1];
    if (v <= b) {
      const t = (v - a) / (b - a);
      return TICK_ANGLES[i] + t * (TICK_ANGLES[i + 1] - TICK_ANGLES[i]);
    }
  }
  return TICK_ANGLES[TICK_ANGLES.length - 1];
}

/**
 * The watts-equivalent label for a dB mark (outer ring), e.g. -20 dB -> "1.5" (at a 150 W
 * reference). The +3 dB headroom mark is shown as a clean doubling (e.g. "300"), matching how
 * McIntosh actually labels it, rather than the slightly-off 10^0.3 result (299.25).
 */
function wattsLabel(db: number, refWatts: number): string {
  if (db === 3) return `${Math.round(refWatts * 2)}`;
  const watts = refWatts * Math.pow(10, db / 10);
  if (watts >= 10) return `${Math.round(watts)}`;
  if (watts >= 1) return `${Math.round(watts * 10) / 10}`;
  if (watts >= 0.1) return `.${Math.round(watts * 100)}`;
  return `${Math.round(watts * 1000 * 10) / 10}m`;
}

/**
 * The swept arc's bounding box at R=1, pivot=(0,0): how far it reaches in each direction.
 * Found once by sampling the angle range, then used to fit the arc snugly into any box
 * (see `fitRow`) without hand-tuned per-size constants.
 */
function scanArcBounds(): { minF: number; maxF: number; minSin: number; maxSin: number } {
  let minF = Infinity, maxF = -Infinity, minSin = Infinity, maxSin = -Infinity;
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const theta = ARC_START + (i / steps) * ARC_SPAN;
    const f = -Math.cos(theta); // y-offset factor from the pivot
    const s = Math.sin(theta); // x-offset factor from the pivot
    if (f < minF) minF = f;
    if (f > maxF) maxF = f;
    if (s < minSin) minSin = s;
    if (s > maxSin) maxSin = s;
  }
  return { minF, maxF, minSin, maxSin };
}
const ARC_BOUNDS = scanArcBounds();

/**
 * Pivot point and radius so the swept arc spans `widthFill` of the row's width, almost
 * edge-to-edge like a real meter. Width drives the size; the caller sizes `rowH` generously
 * enough (see `drawMeterWindow`) to hold the resulting — fairly shallow — vertical rise.
 */
function fitRow(x: number, w: number, rowTopY: number, widthFill: number): { R: number; pivotY: number; cx: number } {
  const { minF, minSin, maxSin } = ARC_BOUNDS;
  const R = (w * widthFill) / (maxSin - minSin);
  const pivotY = rowTopY - minF * R; // the apex (minF) sits at rowTopY
  const cx = x + w / 2 - ((minSin + maxSin) / 2) * R;
  return { R, pivotY, cx };
}

/** Draws one dashed ring (either the outer WATTS or the inner DECIBELS scale) along `angles`. */
function drawDashedRing(
  ctx: CanvasRenderingContext2D,
  cx: number, pivotY: number, R: number,
  angles: number[], lineWidth: number, red: string
) {
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  for (let i = 0; i < angles.length - 1; i++) {
    const aFromRaw = angles[i];
    const aToRaw = angles[i + 1];
    const isRed = DB_MARKS[i] >= 0;
    ctx.strokeStyle = isRed ? red : '#0c2d44';
    const segDeg = (aToRaw - aFromRaw) * (180 / Math.PI);
    const gapRad = (Math.min(1.0, segDeg * 0.1) * Math.PI) / 180;
    const aFrom = aFromRaw + gapRad;
    const aTo = aToRaw - gapRad;
    ctx.beginPath();
    const steps = 16;
    for (let s = 0; s <= steps; s++) {
      const a = aFrom + (s / steps) * (aTo - aFrom);
      const px = cx + Math.sin(a) * R;
      const py = pivotY - Math.cos(a) * R;
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.lineCap = 'round';
}

/**
 * One channel's dual-ring scale + needle, fitted into a horizontal row of the shared glass —
 * an outer WATTS ring and an inner DECIBELS ring, both read by the same needle, like the real
 * McIntosh power-output meter. `caption` ('WATTS' / 'DECIBELS' / null) prints above the row.
 * Returns the row's lowest drawn pixel so the caller can stack the next row below it.
 */
function drawRow(
  ctx: CanvasRenderingContext2D,
  x: number, w: number, topY: number,
  vuLevel: number, chLabel: string, caption: string | null, refWatts: number
): { lowestY: number } {
  const red = 'hsl(353, 82%, 52%)';
  const fsCaption = Math.max(10, Math.min(w * 0.0125, 24));
  // The WATTS numbers read clearly larger than the DECIBELS numbers in the reference photo
  // (roughly double) — not the same size, which is what made the two rings look flat/equal.
  const fsOuter = Math.max(12, Math.min(w * 0.0145, 28));
  const fsInner = Math.max(8, Math.min(w * 0.0078, 15));

  let contentTop = topY;
  if (caption) {
    ctx.font = `600 ${fsCaption}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = 'rgba(12,45,68,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(caption, x + w / 2, contentTop + fsCaption);
    contentTop += fsCaption * 1.55;
  }
  const wattsLabelSpace = fsOuter * 1.6;
  const arcApexY = contentTop + wattsLabelSpace;

  const { R: Router, pivotY, cx } = fitRow(x, w, arcApexY, 0.88);
  // The pivot sits far below the row (shallow, wide sweep), so a smaller radius sharing that
  // same pivot would collapse toward it instead of nesting next to the outer ring. A small,
  // fixed pixel gap (not a ratio of R) keeps the inner ring visually just inside the outer one.
  const ringGap = fsOuter * 3.2 + fsInner * 1.6;
  const Rinner = Router - ringGap;

  const dbLabels = ['-50', '-40', '-30', '-20', '-10', '0', '+3'];
  const wLabels = DB_MARKS.map(v => wattsLabel(v, refWatts));

  // Both rings read the same, fairly thin stroke weight — the reference doesn't make the outer
  // ring noticeably heavier than the inner one, the way an earlier pass here did.
  const ringLineWidth = Math.max(1.8, w * 0.0028);
  drawDashedRing(ctx, cx, pivotY, Router, TICK_ANGLES, ringLineWidth, red);
  drawDashedRing(ctx, cx, pivotY, Rinner, TICK_ANGLES, ringLineWidth, red);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < TICK_ANGLES.length; i++) {
    const a = TICK_ANGLES[i];
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const isRed = DB_MARKS[i] >= 1;
    ctx.fillStyle = isRed ? red : '#0c2d44';
    ctx.font = `600 ${fsOuter}px "Helvetica Neue", Arial, sans-serif`;
    const lrOuter = Router + fsOuter * 0.95;
    ctx.fillText(wLabels[i], cx + sin * lrOuter, pivotY - cos * lrOuter);
    ctx.font = `600 ${fsInner}px "Helvetica Neue", Arial, sans-serif`;
    const lrInner = Rinner + fsInner * 1.1;
    ctx.fillText(dbLabels[i], cx + sin * lrInner, pivotY - cos * lrInner);
  }

  // Channel label at the left edge of the row
  ctx.font = `bold ${fsOuter * 0.85}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = 'rgba(12,45,68,0.75)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(chLabel, x + w * 0.012, arcApexY + fsOuter * 0.8);

  // === NEEDLE (tapered, like a real meter pointer), crossing through both rings ===
  const needleAngle = vuToAngle(vuLevel);
  const dirX = Math.sin(needleAngle);
  const dirY = -Math.cos(needleAngle);
  const perpX = -dirY;
  const perpY = dirX;

  const needleLen = Router * 1.03;
  const baseWidth = Math.max(1.4, w * 0.0022);
  const tipWidth = Math.max(0.3, w * 0.0003);

  const tipX = cx + dirX * needleLen;
  const tipY = pivotY + dirY * needleLen;

  // No drop shadow: on a needle this thin, a blurred offset shadow reads as a second, separate
  // line right next to the real one rather than as depth — doubling each needle visually.
  ctx.save();
  ctx.fillStyle = '#060606';
  ctx.beginPath();
  ctx.moveTo(cx + perpX * baseWidth, pivotY + perpY * baseWidth);
  ctx.lineTo(tipX + perpX * tipWidth, tipY + perpY * tipWidth);
  ctx.lineTo(tipX - perpX * tipWidth, tipY - perpY * tipWidth);
  ctx.lineTo(cx - perpX * baseWidth, pivotY - perpY * baseWidth);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Pivot cover (polished centre cap)
  const pivotGrad = ctx.createRadialGradient(cx - w * 0.004, pivotY - w * 0.004, 0, cx, pivotY, w * 0.009);
  pivotGrad.addColorStop(0, '#5a5a5a');
  pivotGrad.addColorStop(0.5, '#1a1a1a');
  pivotGrad.addColorStop(1, '#000000');
  ctx.fillStyle = pivotGrad;
  ctx.beginPath();
  ctx.arc(cx, pivotY, w * 0.009, 0, Math.PI * 2);
  ctx.fill();

  // Widest point of the outer ring — the row's true lowest pixel, used to stack the next row.
  const lowestY = pivotY - Math.cos(ARC_START) * Router;
  return { lowestY };
}

/** Four small Phillips-head screws, one near each corner of the housing. */
function drawScrews(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const insetX = r * 2.2;
  const insetY = r * 2.2;
  const positions: Array<[number, number]> = [
    [x + insetX, y + insetY],
    [x + w - insetX, y + insetY],
    [x + insetX, y + h - insetY],
    [x + w - insetX, y + h - insetY],
  ];
  for (const [sx, sy] of positions) {
    const grad = ctx.createRadialGradient(sx - r * 0.3, sy - r * 0.3, 0, sx, sy, r);
    grad.addColorStop(0, '#b9bec4');
    grad.addColorStop(0.5, '#6b6f74');
    grad.addColorStop(1, '#202224');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(0.6, r * 0.22);
    ctx.beginPath();
    ctx.moveTo(sx - r * 0.55, sy);
    ctx.lineTo(sx + r * 0.55, sy);
    ctx.stroke();
  }
}

/** The whole wide McIntosh-style window: housing, one lamp-lit glass face, both channel rows. */
function drawMeterWindow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  vuL: number, vuR: number
) {
  const cx = x + w / 2;
  const cr = w * 0.016;
  const bezelPad = Math.min(w, h) * 0.035;

  // --- Brushed-metal housing ---
  const housing = ctx.createLinearGradient(x, y - bezelPad, x, y + h + bezelPad);
  housing.addColorStop(0, '#2b2d30');
  housing.addColorStop(0.08, '#141516');
  housing.addColorStop(0.5, '#0a0a0b');
  housing.addColorStop(0.92, '#141516');
  housing.addColorStop(1, '#2b2d30');
  ctx.fillStyle = housing;
  ctx.beginPath();
  ctx.roundRect(x - bezelPad, y - bezelPad, w + bezelPad * 2, h + bezelPad * 2, cr + bezelPad * 0.5);
  ctx.fill();

  drawScrews(ctx, x - bezelPad, y - bezelPad, w + bezelPad * 2, h + bezelPad * 2, Math.max(2.5, w * 0.007));

  ctx.strokeStyle = 'rgba(210,214,220,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - 2, y - 2, w + 4, h + 4, cr + 1);
  ctx.stroke();

  // --- Deep cobalt-blue lamp-lit glass face, shared by both rows ---
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cr);
  ctx.clip();

  // Flat, evenly-lit powder blue — close to a real backlit meter face, not a moody gradient
  const base = ctx.createLinearGradient(x, y, x, y + h);
  base.addColorStop(0, '#3a8fc2');
  base.addColorStop(0.5, '#4ea0d2');
  base.addColorStop(1, '#3785b8');
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);

  // Faint centre lift, just enough to suggest backlighting without a dark gradient
  const glow = ctx.createRadialGradient(cx, y + h * 0.5, 0, cx, y + h * 0.5, w * 0.55);
  glow.addColorStop(0, 'rgba(220,245,255,0.18)');
  glow.addColorStop(0.6, 'rgba(220,245,255,0.04)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  // Very light vignette, just softening the corners rather than darkening the whole face
  const vignette = ctx.createRadialGradient(cx, y + h * 0.5, w * 0.55, cx, y + h * 0.5, w * 0.85);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(10,30,45,0.22)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);

  const rowTopY1 = y + h * 0.015;
  const row1 = drawRow(ctx, x, w, rowTopY1, vuL, 'L', 'WATTS', 150);
  const rowTopY2 = row1.lowestY + h * 0.035;
  drawRow(ctx, x, w, rowTopY2, vuR, 'R', 'DECIBELS', 150);

  // Curved-glass sheen
  const sweep = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
  sweep.addColorStop(0, 'rgba(255,255,255,0.13)');
  sweep.addColorStop(0.4, 'rgba(255,255,255,0.03)');
  sweep.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sweep;
  ctx.fillRect(x, y, w, h);

  const domeShade = ctx.createLinearGradient(x, y, x, y + h);
  domeShade.addColorStop(0, 'rgba(0,0,0,0.2)');
  domeShade.addColorStop(0.1, 'rgba(0,0,0,0)');
  domeShade.addColorStop(0.9, 'rgba(0,0,0,0)');
  domeShade.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = domeShade;
  ctx.fillRect(x, y, w, h);

  ctx.restore(); // end clip

  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cr);
  ctx.stroke();
}

/** Truncates `text` with an ellipsis so it fits within `maxWidth` at the current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = `${text.slice(0, mid).trimEnd()}…`;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

const VUMeterMcIntosh: VisualizerFactory = ({ container }) => {
  const c = mountCanvas2D(container);
  const canvas = c.canvas;
  const ctx = c.ctx;

  let smoothedL = -40;
  let smoothedR = -40;

  return {
    resize: (w, h, dpr) => c.resize(w, h, dpr),
    frame({ audio, settings, metadata, dt: frameDt }) {
      const dt = Math.min(frameDt, 0.1);

      const w = canvas.width;
      const h = canvas.height;
      const s = settings;

      const { left: bufL, right: bufR } = audio.stereo();
      const N = bufL.length;

      let sumL = 0, sumR = 0;
      for (let i = 0; i < N; i++) {
        sumL += bufL[i] * bufL[i];
        sumR += bufR[i] * bufR[i];
      }
      let rmsL = Math.sqrt(sumL / N);
      let rmsR = Math.sqrt(sumR / N);
      // Mono fallback: mirror left channel if right is silent
      if (rmsR < 1e-5) rmsR = rmsL;

      const gain = s.sensitivity * 6;
      const dbL = rmsL > 0 ? 20 * Math.log10(rmsL * gain) : -60;
      const dbR = rmsR > 0 ? 20 * Math.log10(rmsR * gain) : -60;

      // VU ballistic smoothing (~300 ms rise/fall)
      const attack = 1 - Math.exp(-dt * 3.5 * s.speed);
      const release = 1 - Math.exp(-dt * 2.5 * s.speed);
      const tL = Math.max(-25, Math.min(4, dbL));
      const tR = Math.max(-25, Math.min(4, dbR));
      smoothedL += (tL - smoothedL) * (tL > smoothedL ? attack : release);
      smoothedR += (tR - smoothedR) * (tR > smoothedR ? attack : release);

      // Brushed-black amplifier front
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#1c1d1f');
      bg.addColorStop(0.5, '#050505');
      bg.addColorStop(1, '#141516');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Reserve a strip at the bottom for the now-playing text
      const textH = Math.max(h * 0.09, 22);
      const meterAreaH = h - textH;

      // One wide window holding both channels, sized to fill the available area
      const pad = Math.min(w, meterAreaH) * 0.06;
      const aspect = 2.15; // wide, landscape window; taller than before to fit the dual watts/dB rings

      let mW = (w - pad * 2) * Math.min(s.scale, 2);
      let mH = mW / aspect;
      const maxH = (meterAreaH - pad * 2) * Math.min(s.scale, 2);
      if (mH > maxH) { mH = maxH; mW = mH * aspect; }

      const sx = (w - mW) / 2;
      const sy = (meterAreaH - mH) / 2;

      const clL = Math.max(-20, Math.min(3, smoothedL));
      const clR = Math.max(-20, Math.min(3, smoothedR));

      drawMeterWindow(ctx, sx, sy, mW, mH, clL, clR);

      // Now-playing text: artist — title, falling back to "Music Assistant"
      const artist = metadata?.artist?.trim();
      const title = metadata?.title?.trim();
      const nowPlaying = title || artist ? [artist, title].filter(Boolean).join(' — ') : 'Music Assistant';

      const fs = Math.max(10, Math.min(textH * 0.5, w * 0.022));
      ctx.font = `${fs}px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, nowPlaying, w * 0.9), w / 2, meterAreaH + textH / 2);
    },
    dispose() {
      canvas.remove();
    },
  };
};

export default VUMeterMcIntosh;
