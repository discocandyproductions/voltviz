/**
 * VU Meter (McIntosh) — a Canvas 2D visualizer. Same ballistic VU math as `VUMeter`, restyled
 * as a single McIntosh-style wide meter window: brushed-metal housing with corner screws, one
 * deep cobalt-blue lamp-lit glass face holding both channels as stacked rows (L on top, R
 * below), tapered black needles, and the current Sendspin track (artist / title) printed below
 * the glass, falling back to "Music Assistant" when no track info is available.
 */
import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

// --- VU meter arc geometry (angles from vertical in radians, negative = left) ---
const ARC_START_DEG = -58;
const ARC_END_DEG = 46;
const ARC_START = (ARC_START_DEG * Math.PI) / 180;
const ARC_END = (ARC_END_DEG * Math.PI) / 180;
const ARC_SPAN = ARC_END - ARC_START;

function vuToPercent(vu: number): number {
  return Math.pow(10, vu / 20) * 100;
}

const MAX_PCT = vuToPercent(3); // ~141.25%

function vuToAngle(vu: number): number {
  const pct = vuToPercent(Math.max(-50, Math.min(4, vu)));
  return ARC_START + (pct / MAX_PCT) * ARC_SPAN;
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

/** Pivot point and radius that fit the swept arc inside [x, x+w] × [rowTopY, rowTopY+rowH]. */
function fitRow(
  x: number, w: number, rowTopY: number, rowH: number, widthFill: number, heightFill: number
): { R: number; pivotY: number; cx: number } {
  const { minF, maxF, minSin, maxSin } = ARC_BOUNDS;
  const Rw = (w * widthFill) / (maxSin - minSin);
  const Rh = (rowH * heightFill) / (maxF - minF);
  const R = Math.min(Rw, Rh);
  const pivotY = rowTopY + rowH * heightFill - minF * R - (rowH * (1 - heightFill));
  const cx = x + w / 2 - ((minSin + maxSin) / 2) * R;
  return { R, pivotY, cx };
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  cx: number, py: number, r: number,
  from: number, to: number, steps: number
) {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const v = from + (i / steps) * (to - from);
    const a = vuToAngle(v);
    const x = cx + Math.sin(a) * r;
    const y = py - Math.cos(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** One channel's VU scale + needle, fitted into a horizontal row of the shared glass. */
function drawRow(
  ctx: CanvasRenderingContext2D,
  x: number, w: number, rowTopY: number, rowH: number,
  vuLevel: number, chLabel: string
) {
  const { R, pivotY, cx } = fitRow(x, w, rowTopY, rowH, 0.84, 0.72);
  const fs = Math.max(8, Math.min(w * 0.014, 15));
  const red = 'hsl(353, 82%, 52%)';

  ctx.strokeStyle = '#061018';
  ctx.lineWidth = Math.max(1.3, w * 0.0018);
  drawArc(ctx, cx, pivotY, R, -20, 0, 60);

  ctx.strokeStyle = red;
  ctx.lineWidth = Math.max(1.6, w * 0.0022);
  drawArc(ctx, cx, pivotY, R, 0, 3, 30);

  const dbMarks = [
    { vu: -20, label: '20' }, { vu: -10, label: '10' },
    { vu: -7, label: '7' }, { vu: -5, label: '5' },
    { vu: -3, label: '3' }, { vu: -2, label: '2' },
    { vu: -1, label: '1' }, { vu: 0, label: '0' },
    { vu: 1, label: '1' }, { vu: 2, label: '2' },
    { vu: 3, label: '3' },
  ];

  const tick = R * 0.035;
  ctx.font = `bold ${fs}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const m of dbMarks) {
    const a = vuToAngle(m.vu);
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const isRed = m.vu >= 1;

    ctx.strokeStyle = isRed ? red : '#061018';
    ctx.lineWidth = Math.max(1, w * 0.0014);
    ctx.beginPath();
    ctx.moveTo(cx + sin * R, pivotY - cos * R);
    ctx.lineTo(cx + sin * (R - tick), pivotY - cos * (R - tick));
    ctx.stroke();

    const lr = R + fs * 0.85;
    ctx.fillStyle = isRed ? red : '#0c2d44';
    ctx.fillText(m.label, cx + sin * lr, pivotY - cos * lr);
  }

  for (const vu of [-15, -8, -6, -4, -0.5, 0.5, 1.5, 2.5]) {
    const a = vuToAngle(vu);
    const isRed = vu > 0;
    ctx.strokeStyle = isRed ? red : '#061018';
    ctx.lineWidth = Math.max(0.5, w * 0.0009);
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * R, pivotY - Math.cos(a) * R);
    ctx.lineTo(cx + Math.sin(a) * (R - tick * 0.5), pivotY - Math.cos(a) * (R - tick * 0.5));
    ctx.stroke();
  }

  // Channel label at the left edge of the row
  ctx.font = `bold ${fs * 1.3}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = 'rgba(12,45,68,0.8)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(chLabel, x + w * 0.012, rowTopY + rowH * 0.5);

  // === NEEDLE (tapered, like a real meter pointer) ===
  const needleAngle = vuToAngle(vuLevel);
  const dirX = Math.sin(needleAngle);
  const dirY = -Math.cos(needleAngle);
  const perpX = -dirY;
  const perpY = dirX;

  const needleLen = R * 1.02;
  const baseWidth = Math.max(1.4, w * 0.0022);
  const tipWidth = Math.max(0.3, w * 0.0003);

  const tipX = cx + dirX * needleLen;
  const tipY = pivotY + dirY * needleLen;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1.5;
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

  const rowH = h * 0.36;
  const gap = h * 0.08;
  const rowTopY1 = y + h * 0.07;
  const rowTopY2 = rowTopY1 + rowH + gap;

  drawRow(ctx, x, w, rowTopY1, rowH, vuL, 'L');
  drawRow(ctx, x, w, rowTopY2, rowH, vuR, 'R');

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
      const aspect = 2.5; // wide, landscape window like a real amplifier meter

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
