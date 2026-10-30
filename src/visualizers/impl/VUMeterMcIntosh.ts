/**
 * VU Meter (McIntosh) — a Canvas 2D visualizer. Same ballistic VU math as `VUMeter`, restyled
 * as a single McIntosh-style wide meter window: solid black housing with corner screws, one
 * deep cobalt-blue lamp-lit glass face holding both channels as stacked rows (L on top, R
 * below). Each row carries that meter's dual-ring look — an outer and an inner dashed scale,
 * both read by one tapered needle — but it's still a normal VU meter underneath: both rings
 * share the same VU numbers rather than a separately calibrated watts/dB scale. The current
 * Sendspin track (artist / title) prints inside the glass at the bottom, where "POWER OUTPUT"
 * sits on the real unit, falling back to "Music Assistant" when no track info is available.
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
 * The small angled "stop" mark at each end of a ring — a real meter's scale ends in a short
 * flick bent away from the dash direction (the mechanical end-of-travel marker), not just
 * another straight dash like the rest of the graduation.
 */
function drawEndStop(
  ctx: CanvasRenderingContext2D,
  cx: number, pivotY: number, R: number,
  angle: number, bendSign: 1 | -1, lineWidth: number
) {
  const bend = (16 * Math.PI) / 180;
  const tangent = angle + bendSign * bend;
  const baseX = cx + Math.sin(angle) * R;
  const baseY = pivotY - Math.cos(angle) * R;
  const tipLen = R * 0.032;
  const tipX = cx + Math.sin(tangent) * (R + tipLen);
  const tipY = pivotY - Math.cos(tangent) * (R + tipLen);
  ctx.strokeStyle = '#0c2d44';
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
}

/**
 * One channel's dual-ring scale + needle, fitted into a horizontal row of the shared glass —
 * an outer and an inner ring, both read by the same needle, like the real McIntosh power-output
 * meter. The exact watts/dB calibration isn't the point — this is a normal VU meter wearing
 * that meter's look, so both rings share the same simple VU numbers rather than a separately
 * computed watts scale. Returns the row's lowest drawn pixel so the next row can stack below it.
 */
function drawRow(
  ctx: CanvasRenderingContext2D,
  x: number, w: number, topY: number,
  vuLevel: number, chLabel: string
): { lowestY: number } {
  const red = 'hsl(353, 82%, 52%)';
  const fsOuter = Math.max(12, Math.min(w * 0.016, 30));
  const fsInner = Math.max(9, Math.min(w * 0.0105, 20));

  const wattsLabelSpace = fsOuter * 1.55;
  const arcApexY = topY + wattsLabelSpace;

  const { R: Router, pivotY, cx } = fitRow(x, w, arcApexY, 0.88);
  // The pivot sits far below the row (shallow, wide sweep), so a smaller radius sharing that
  // same pivot would collapse toward it instead of nesting next to the outer ring. A small,
  // fixed pixel gap (not a ratio of R) keeps the inner ring close against the outer one, like
  // the reference's tightly nested pair rather than two widely separated arcs.
  const ringGap = fsInner * 2.6;
  const Rinner = Router - ringGap;

  const dbLabels = ['-50', '-40', '-30', '-20', '-10', '0', '+3'];

  // Both rings read the same, fairly thin stroke weight and the same single navy ink (with just
  // the overload segment in red) — one continuous-reading dial, not two differently-styled ones.
  const ringLineWidth = Math.max(2.0, w * 0.0032);
  drawDashedRing(ctx, cx, pivotY, Router, TICK_ANGLES, ringLineWidth, red);
  drawDashedRing(ctx, cx, pivotY, Rinner, TICK_ANGLES, ringLineWidth, red);
  drawEndStop(ctx, cx, pivotY, Router, TICK_ANGLES[0], -1, ringLineWidth);
  drawEndStop(ctx, cx, pivotY, Router, TICK_ANGLES[TICK_ANGLES.length - 1], 1, ringLineWidth);
  drawEndStop(ctx, cx, pivotY, Rinner, TICK_ANGLES[0], -1, ringLineWidth);
  drawEndStop(ctx, cx, pivotY, Rinner, TICK_ANGLES[TICK_ANGLES.length - 1], 1, ringLineWidth);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < TICK_ANGLES.length; i++) {
    const a = TICK_ANGLES[i];
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const isRed = DB_MARKS[i] >= 1;
    ctx.fillStyle = isRed ? red : '#0c2d44';
    ctx.font = `600 ${fsOuter}px "Helvetica Neue", Arial, sans-serif`;
    const lrOuter = Router + fsOuter * 0.8;
    ctx.fillText(dbLabels[i], cx + sin * lrOuter, pivotY - cos * lrOuter);
    ctx.font = `600 ${fsInner}px "Helvetica Neue", Arial, sans-serif`;
    const lrInner = Rinner + fsInner * 0.85;
    ctx.fillText(dbLabels[i], cx + sin * lrInner, pivotY - cos * lrInner);
  }

  // Channel label at the left edge of the row
  ctx.font = `bold ${fsOuter * 0.8}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = 'rgba(12,45,68,0.75)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(chLabel, x + w * 0.012, arcApexY + fsOuter * 0.8);

  // === NEEDLE (tapered, like a real meter pointer), crossing through both rings ===
  // The true pivot sits far below the visible window (this is a shallow, wide-radius sweep), so
  // a needle drawn all the way from it would trail a long, mostly-hidden shaft straight down
  // through whatever sits below the rings — the now-playing text, in this layout. A real meter's
  // needle is only ever seen near the dial face, so this one is drawn from just inside the inner
  // ring out to just past the outer ring, not from the pivot itself.
  const needleAngle = vuToAngle(vuLevel);
  const dirX = Math.sin(needleAngle);
  const dirY = -Math.cos(needleAngle);
  const perpX = -dirY;
  const perpY = dirX;

  const needleBaseR = Rinner * 0.78;
  const needleTipR = Router * 1.03;
  const baseWidth = Math.max(1.4, w * 0.0022);
  const tipWidth = Math.max(0.3, w * 0.0003);

  const baseX = cx + dirX * needleBaseR;
  const baseY = pivotY + dirY * needleBaseR;
  const tipX = cx + dirX * needleTipR;
  const tipY = pivotY + dirY * needleTipR;

  // No drop shadow: on a needle this thin, a blurred offset shadow reads as a second, separate
  // line right next to the real one rather than as depth — doubling each needle visually.
  ctx.save();
  ctx.fillStyle = '#060606';
  ctx.beginPath();
  ctx.moveTo(baseX + perpX * baseWidth, baseY + perpY * baseWidth);
  ctx.lineTo(tipX + perpX * tipWidth, tipY + perpY * tipWidth);
  ctx.lineTo(tipX - perpX * tipWidth, tipY - perpY * tipWidth);
  ctx.lineTo(baseX - perpX * baseWidth, baseY - perpY * baseWidth);
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
  vuL: number, vuR: number, nowPlaying: string
) {
  const cx = x + w / 2;
  const cr = w * 0.016;
  const bezelPad = Math.min(w, h) * 0.035;

  // --- Solid matte-black housing — a real stop/flat black, not a brushed-metal highlight band ---
  ctx.fillStyle = '#060606';
  ctx.beginPath();
  ctx.roundRect(x - bezelPad, y - bezelPad, w + bezelPad * 2, h + bezelPad * 2, cr + bezelPad * 0.5);
  ctx.fill();

  drawScrews(ctx, x - bezelPad, y - bezelPad, w + bezelPad * 2, h + bezelPad * 2, Math.max(2.5, w * 0.007));

  ctx.strokeStyle = 'rgba(210,214,220,0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 2, y - 2, w + 4, h + 4, cr + 1);
  ctx.stroke();

  // --- Deep cobalt-blue lamp-lit glass face, shared by both rows ---
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cr);
  ctx.clip();

  // Lamp-lit base: brighter upper-centre, darker toward the bottom — a real backlit bulb
  // casting up into curved glass, not a flat, evenly-lit panel.
  const base = ctx.createLinearGradient(x, y, x, y + h);
  base.addColorStop(0, '#5ab3e6');
  base.addColorStop(0.35, '#3f96cf');
  base.addColorStop(1, '#215f8c');
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);

  // Bright lamp hotspot, upper-centre
  const glow = ctx.createRadialGradient(cx, y + h * 0.28, 0, cx, y + h * 0.28, w * 0.5);
  glow.addColorStop(0, 'rgba(235,250,255,0.38)');
  glow.addColorStop(0.5, 'rgba(220,245,255,0.1)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  // Real vignette: noticeably darker corners, especially the lower ones, for a convex-glass feel
  const vignette = ctx.createRadialGradient(cx, y + h * 0.4, w * 0.3, cx, y + h * 0.4, w * 0.8);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(5,20,35,0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);
  const bottomShade = ctx.createLinearGradient(x, y + h * 0.6, x, y + h);
  bottomShade.addColorStop(0, 'rgba(0,0,0,0)');
  bottomShade.addColorStop(1, 'rgba(0,10,20,0.3)');
  ctx.fillStyle = bottomShade;
  ctx.fillRect(x, y, w, h);

  const rowTopY1 = y + h * 0.02;
  const row1 = drawRow(ctx, x, w, rowTopY1, vuL, 'L');
  const rowTopY2 = row1.lowestY + h * 0.03;
  const row2 = drawRow(ctx, x, w, rowTopY2, vuR, 'R');

  // Now-playing text sits inside the glass, at the bottom — where "POWER OUTPUT" sits on the
  // real unit — in the same dark ink as the rest of the dial, not as separate white UI text.
  const npFs = Math.max(9, Math.min(w * 0.0105, 18));
  ctx.font = `600 ${npFs}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = 'rgba(8,30,48,0.68)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const npY = Math.max(row2.lowestY + npFs * 1.6, y + h - npFs * 0.9);
  ctx.fillText(fitText(ctx, nowPlaying, w * 0.86), cx, Math.min(npY, y + h - npFs * 0.5));

  // Curved-glass sheen
  const sweep = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
  sweep.addColorStop(0, 'rgba(255,255,255,0.15)');
  sweep.addColorStop(0.4, 'rgba(255,255,255,0.03)');
  sweep.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sweep;
  ctx.fillRect(x, y, w, h);

  const domeShade = ctx.createLinearGradient(x, y, x, y + h);
  domeShade.addColorStop(0, 'rgba(0,0,0,0.22)');
  domeShade.addColorStop(0.12, 'rgba(0,0,0,0)');
  domeShade.addColorStop(0.88, 'rgba(0,0,0,0)');
  domeShade.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = domeShade;
  ctx.fillRect(x, y, w, h);

  ctx.restore(); // end clip

  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
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

      // One wide window holding both channels, sized to fill the available area. The now-playing
      // text is printed inside the glass (where "POWER OUTPUT" sits on the real unit), so no
      // separate strip is reserved outside the housing for it any more.
      const pad = Math.min(w, h) * 0.06;
      const aspect = 1.9; // wide, landscape window; tall enough for the tightened dual rings

      let mW = (w - pad * 2) * Math.min(s.scale, 2);
      let mH = mW / aspect;
      const maxH = (h - pad * 2) * Math.min(s.scale, 2);
      if (mH > maxH) { mH = maxH; mW = mH * aspect; }

      const sx = (w - mW) / 2;
      const sy = (h - mH) / 2;

      const clL = Math.max(-20, Math.min(3, smoothedL));
      const clR = Math.max(-20, Math.min(3, smoothedR));

      // Now-playing text: artist — title, falling back to "Music Assistant"
      const artist = metadata?.artist?.trim();
      const title = metadata?.title?.trim();
      const nowPlaying = title || artist ? [artist, title].filter(Boolean).join(' — ') : 'Music Assistant';

      drawMeterWindow(ctx, sx, sy, mW, mH, clL, clR, nowPlaying);
    },
    dispose() {
      canvas.remove();
    },
  };
};

export default VUMeterMcIntosh;
