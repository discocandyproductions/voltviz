/**
 * VU Meter (McIntosh) — a Canvas 2D visualizer. Same ballistic VU math as `VUMeter`, restyled
 * as a single McIntosh-style wide meter window: solid black housing (top corners rounded,
 * bottom corners square) with corner screws, one deep cobalt-blue lamp-lit glass face — lit
 * from below, like a real backlit bulb — holding both channels as stacked rows (L on top, R
 * below). Each row is a normal VU meter wearing that meter's dashed-scale look: one wide,
 * shallow ring per channel, read by one long thin needle, with a small angled "stop" mark at
 * each end of the scale. A fixed "MusicAssistant" title sits above the rings; the current
 * Sendspin track (artist – title) prints below the bottom ring.
 */
import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

// --- VU meter arc geometry (angles from vertical in radians, negative = left) ---
// A shallow sweep (narrow angle range) so the scale reads almost edge-to-edge across a wide
// window with modest vertical rise, like a real meter's needle pivoting far below the dial.
// Symmetric around 0° so the curve itself — not just its bounding box — sits visually centered.
const ARC_START_DEG = -18;
const ARC_END_DEG = 18;
const ARC_START = (ARC_START_DEG * Math.PI) / 180;
const ARC_END = (ARC_END_DEG * Math.PI) / 180;
const ARC_SPAN = ARC_END - ARC_START;

// --- Printed scale graduation ---
// A normal VU meter's scale, not a watts/dB calibration: -20, -10, -7, -5, -3, -2, -1, 0,
// +1, +2, +3 — evenly fanned across the arc, with 0 and above in the red "overload" zone.
const MARKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
const TICK_ANGLES: number[] = (() => {
  const weights = MARKS.slice(1).map(() => 1); // evenly fanned
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const angles = [ARC_START];
  let acc = 0;
  for (const wgt of weights) {
    acc += wgt;
    angles.push(ARC_START + (acc / weightSum) * ARC_SPAN);
  }
  return angles;
})();

/** The needle's angle for a given VU level — interpolated along the same evenly-fanned scale
 *  as the printed tick marks, so the needle always points at the number matching its own level. */
function vuToAngle(vu: number): number {
  const v = Math.max(MARKS[0], Math.min(MARKS[MARKS.length - 1], vu));
  for (let i = 0; i < MARKS.length - 1; i++) {
    const a = MARKS[i];
    const b = MARKS[i + 1];
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
function scanArcBounds(): { minF: number; minSin: number; maxSin: number } {
  let minF = Infinity, minSin = Infinity, maxSin = -Infinity;
  const steps = 300;
  for (let i = 0; i <= steps; i++) {
    const theta = ARC_START + (i / steps) * ARC_SPAN;
    const f = -Math.cos(theta); // y-offset factor from the pivot
    const s = Math.sin(theta); // x-offset factor from the pivot
    if (f < minF) minF = f;
    if (s < minSin) minSin = s;
    if (s > maxSin) maxSin = s;
  }
  return { minF, minSin, maxSin };
}
const ARC_BOUNDS = scanArcBounds();

/**
 * Pivot point and radius so the swept arc spans `widthFill` of the row's width, almost
 * edge-to-edge like a real meter. At this shallow, wide angle the pivot sits far below the
 * row — R itself ends up very large — which the needle and end-stop math below has to work
 * around rather than treat as an ordinary small-radius dial.
 */
function fitRow(x: number, w: number, rowTopY: number, widthFill: number): { R: number; pivotY: number; cx: number } {
  const { minF, minSin, maxSin } = ARC_BOUNDS;
  const R = (w * widthFill) / (maxSin - minSin);
  const pivotY = rowTopY - minF * R; // the apex (minF) sits at rowTopY
  const cx = x + w / 2 - ((minSin + maxSin) / 2) * R;
  return { R, pivotY, cx };
}

/** Draws the row's dashed scale ring along `TICK_ANGLES`, with a small gap between dashes. */
function drawDashedRing(
  ctx: CanvasRenderingContext2D,
  cx: number, pivotY: number, R: number, lineWidth: number, red: string
) {
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  for (let i = 0; i < TICK_ANGLES.length - 1; i++) {
    const aFromRaw = TICK_ANGLES[i];
    const aToRaw = TICK_ANGLES[i + 1];
    const isRed = MARKS[i] >= 0;
    ctx.strokeStyle = isRed ? red : '#0c2d44';
    const segDeg = (aToRaw - aFromRaw) * (180 / Math.PI);
    const gapRad = (Math.min(1.2, segDeg * 0.12) * Math.PI) / 180;
    const aFrom = aFromRaw + gapRad;
    const aTo = aToRaw - gapRad;
    ctx.beginPath();
    const steps = 12;
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
 * The small V-shaped "stop" mark at one end of the ring — a mechanical end-of-travel flag,
 * like the real meter's. IMPORTANT: this is deliberately built from fixed PIXEL lengths, not
 * as a rotation around the ring's own (very distant) pivot. An angle-based hook — rotating a
 * few degrees around R — looked right on an ordinary small-radius dial, but on this shallow,
 * wide sweep R is enormous, so even a small angle change swept a huge pixel distance and shot
 * the hook far outside the glass. Two short fixed-length segments avoid that entirely.
 */
function drawEndStop(
  ctx: CanvasRenderingContext2D,
  cx: number, pivotY: number, R: number, w: number,
  angle: number, bendSign: 1 | -1, lineWidth: number, color: string
) {
  const baseX = cx + Math.sin(angle) * R;
  const baseY = pivotY - Math.cos(angle) * R;
  // direction the ring continues outward in, past this end's last dash
  const ox = bendSign * Math.cos(angle);
  const oy = bendSign * Math.sin(angle);
  const segLen = Math.max(12, w * 0.016);
  const vx = baseX + ox * segLen;
  const vy = baseY + oy * segLen;
  // second segment folds sharply back (~100°) to form the V
  const kink = bendSign * ((-100 * Math.PI) / 180);
  const rx = ox * Math.cos(kink) - oy * Math.sin(kink);
  const ry = ox * Math.sin(kink) + oy * Math.cos(kink);
  const tipX = vx + rx * segLen;
  const tipY = vy + ry * segLen;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(vx, vy);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.lineCap = 'round';
}

/**
 * One channel's scale + needle, fitted into a horizontal row of the shared glass. `bandBottomY`
 * is the pixel row (not a fraction of R) the needle's visible base should reach down to — see
 * the needle section below for why that has to be a fixed pixel position rather than a fraction
 * of R. Returns the row's lowest drawn pixel so the next row (or the artist/title text) can be
 * placed below it.
 */
function drawRow(
  ctx: CanvasRenderingContext2D,
  x: number, w: number, topY: number,
  vuLevel: number, bandBottomY: number
): { lowestY: number } {
  const red = 'hsl(353, 82%, 52%)';
  const widthFill = 0.92;
  const { R, pivotY, cx } = fitRow(x, w, topY, widthFill);

  const fsLabel = Math.max(14, Math.min(w * 0.022, 34));
  const ringLineWidth = Math.max(7, w * 0.012);

  drawDashedRing(ctx, cx, pivotY, R, ringLineWidth, red);

  // Stop marks: the left end (lowest mark) stays in the dial's normal dark ink; the right end
  // sits in the red overload zone, so its stop mark reads red too, matching the ring under it.
  drawEndStop(ctx, cx, pivotY, R, w, TICK_ANGLES[0], -1, ringLineWidth, '#0c2d44');
  drawEndStop(ctx, cx, pivotY, R, w, TICK_ANGLES[TICK_ANGLES.length - 1], 1, ringLineWidth, red);

  // Scale numbers stay in the dial's dark ink everywhere — including over the red zone, where
  // only the ring/stop itself turns red, not the printed digits.
  ctx.font = `600 ${fsLabel}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0c2d44';
  for (let i = 0; i < TICK_ANGLES.length; i++) {
    const a = TICK_ANGLES[i];
    const lr = R + fsLabel * 0.9;
    ctx.fillText(`${MARKS[i]}`, cx + Math.sin(a) * lr, pivotY - Math.cos(a) * lr);
  }

  // === NEEDLE: long, thin, uniform width — crosses down toward the bottom of this row's own
  // band, not a short stub hugging the ring. ===
  // The true pivot sits far below the visible window (this is a shallow, wide-radius sweep), so
  // a needle length expressed as a simple fraction of R (like 0.8*R) is unreliable: because R is
  // enormous here, a small fractional change already produces a pixel length far bigger than the
  // row itself — the needle would run straight through the window's bottom edge. Instead we solve
  // backwards from a DESIRED PIXEL ROW (bandBottomY) for the radius that lands the needle's base
  // exactly there, so it reaches a consistent, intentional depth regardless of how large R is.
  const needleAngle = vuToAngle(vuLevel);
  const dirX = Math.sin(needleAngle);
  const dirY = -Math.cos(needleAngle);
  const perpX = -dirY;
  const perpY = dirX;

  const ringRowHeight = R * (1 - Math.cos(-ARC_START));
  const desiredBaseY = bandBottomY - ringRowHeight * 0.1; // small margin above the band edge
  const needleBaseR = (pivotY - desiredBaseY) / Math.cos(needleAngle);
  const needleTipR = R + ringRowHeight * 0.15;
  const needleWidth = Math.max(1.3, w * 0.00175); // thin, and the SAME at base and tip — no taper

  const baseX = cx + dirX * needleBaseR;
  const baseY = pivotY + dirY * needleBaseR;
  const tipX = cx + dirX * needleTipR;
  const tipY = pivotY + dirY * needleTipR;

  ctx.fillStyle = '#060606';
  ctx.beginPath();
  ctx.moveTo(baseX + perpX * needleWidth, baseY + perpY * needleWidth);
  ctx.lineTo(tipX + perpX * needleWidth, tipY + perpY * needleWidth);
  ctx.lineTo(tipX - perpX * needleWidth, tipY - perpY * needleWidth);
  ctx.lineTo(baseX - perpX * needleWidth, baseY - perpY * needleWidth);
  ctx.closePath();
  ctx.fill();

  // Widest point of the ring — the row's true lowest pixel, used to place whatever sits below it.
  const lowestY = pivotY - Math.cos(ARC_START) * R;
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

/** The whole wide McIntosh-style window: housing, one lamp-lit glass face, both channel rows. */
function drawMeterWindow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  vuL: number, vuR: number, nowPlaying: string
) {
  const cx = x + w / 2;
  // Corner rounding: only the TOP corners are rounded (a small radius); the bottom corners stay
  // square. `[topLeft, topRight, bottomRight, bottomLeft]` is the Canvas 2D roundRect order.
  const cr = w * 0.01;
  const bezelPad = Math.min(w, h) * 0.035;
  const crHousing = cr + bezelPad * 0.5;

  // --- Solid matte-black housing ---
  ctx.fillStyle = '#060606';
  ctx.beginPath();
  ctx.roundRect(x - bezelPad, y - bezelPad, w + bezelPad * 2, h + bezelPad * 2, [crHousing, crHousing, 0, 0]);
  ctx.fill();

  drawScrews(ctx, x - bezelPad, y - bezelPad, w + bezelPad * 2, h + bezelPad * 2, Math.max(2.5, w * 0.007));

  ctx.strokeStyle = 'rgba(210,214,220,0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 2, y - 2, w + 4, h + 4, [cr + 1, cr + 1, 0, 0]);
  ctx.stroke();

  // --- Deep cobalt-blue lamp-lit glass face, shared by both rows ---
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, [cr, cr, 0, 0]);
  ctx.clip();

  // Lamp-lit base: the light comes from BELOW — darker upper half, brighter lower half — like a
  // backlit bulb behind curved glass, not a flat, evenly-lit panel.
  const base = ctx.createLinearGradient(x, y, x, y + h);
  base.addColorStop(0, '#1d4f73');
  base.addColorStop(0.55, '#2e74a3');
  base.addColorStop(1, '#5fb6e8');
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);

  // Bright lamp hotspot, low in the glass (the light source itself)
  const glow = ctx.createRadialGradient(cx, y + h * 0.95, 0, cx, y + h * 0.95, w * 0.55);
  glow.addColorStop(0, 'rgba(235,250,255,0.4)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  // Vignette: darker corners, for a convex-glass feel
  const vignette = ctx.createRadialGradient(cx, y + h * 0.4, w * 0.3, cx, y + h * 0.4, w * 0.8);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(5,20,35,0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);

  // Depth line along the bottom edge of the glass
  const depthLineY = y + h - Math.max(3, h * 0.008);
  ctx.strokeStyle = 'rgba(5,20,35,0.5)';
  ctx.lineWidth = Math.max(2, h * 0.004);
  ctx.beginPath();
  ctx.moveTo(x, depthLineY);
  ctx.lineTo(x + w, depthLineY);
  ctx.stroke();

  // Two rows, each in its own vertical band, so the long needle of one row can never run into
  // the ring of the other — only into the OTHER row's needle space, which is intentional (see
  // the needle comment in `drawRow`).
  const bandGap = h * 0.04;
  const bandH = (h - bandGap) / 2;
  const band1Top = y;
  const band2Top = band1Top + bandH + bandGap;
  const rowTopY1 = band1Top + h * 0.3;
  const rowTopY2 = band2Top + h * 0.1;

  // Fixed "MusicAssistant" title above the rings, vertically centred between the glass's top
  // edge and the top row's arc.
  ctx.font = `800 ${Math.max(21, w * 0.036)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = 'rgba(8,30,48,0.8)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MusicAssistant', cx, (y + rowTopY1) / 2);

  drawRow(ctx, x, w, rowTopY1, vuL, y + h);
  const row2 = drawRow(ctx, x, w, rowTopY2, vuR, y + h);

  // Artist – title below the bottom row, in the same dark dial ink.
  if (nowPlaying) {
    ctx.font = `600 ${Math.max(14, w * 0.027)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = 'rgba(8,30,48,0.75)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, nowPlaying, w * 0.9), cx, (row2.lowestY + (y + h)) / 2);
  }

  ctx.restore(); // end clip

  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, [cr, cr, 0, 0]);
  ctx.stroke();
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

      // One wide window holding both channels, sized to fill the available area.
      const pad = Math.min(w, h) * 0.06;
      // Matches the approved preview's glass proportions (1420×560 within a 1600×700 canvas).
      const aspect = 1420 / 560;

      let mW = (w - pad * 2) * Math.min(s.scale, 2);
      let mH = mW / aspect;
      const maxH = (h - pad * 2) * Math.min(s.scale, 2);
      if (mH > maxH) { mH = maxH; mW = mH * aspect; }

      const sx = (w - mW) / 2;
      const sy = (h - mH) / 2;

      const clL = Math.max(-20, Math.min(3, smoothedL));
      const clR = Math.max(-20, Math.min(3, smoothedR));

      // Artist – title, printed below the bottom row; left blank when nothing is playing (the
      // fixed "MusicAssistant" title above the rings already carries the branding).
      const artist = metadata?.artist?.trim();
      const title = metadata?.title?.trim();
      const nowPlaying = [artist, title].filter(Boolean).join(' – ');

      drawMeterWindow(ctx, sx, sy, mW, mH, clL, clR, nowPlaying);
    },
    dispose() {
      canvas.remove();
    },
  };
};

export default VUMeterMcIntosh;
