/**
 * VU Meter (McIntosh) — a Canvas 2D visualizer. Same ballistic VU math as `VUMeter`, restyled
 * as a McIntosh-style stereo amplifier front: brushed-metal housing with corner screws,
 * deep cobalt-blue lamp-lit meter faces with a vignette and a curved-glass highlight, tapered
 * black needles, and the current Sendspin track (artist / title) printed below the meters,
 * falling back to "Music Assistant" when no track info is available.
 */
import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

// --- VU meter arc geometry (angles from vertical in radians, negative = left) ---
const ARC_START_DEG = -50;
const ARC_END_DEG = 38;
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

function pctToAngle(pct: number): number {
  return ARC_START + (pct / MAX_PCT) * ARC_SPAN;
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  cx: number, py: number, r: number,
  from: number, to: number, steps: number, isVu: boolean
) {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const v = from + (i / steps) * (to - from);
    const a = isVu ? vuToAngle(v) : pctToAngle(v);
    const x = cx + Math.sin(a) * r;
    const y = py - Math.cos(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Four small Phillips-head screws, one near each corner of the housing. */
function drawScrews(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const inset = r * 1.6;
  const positions: Array<[number, number]> = [
    [x + inset, y + inset],
    [x + w - inset, y + inset],
    [x + inset, y + h - inset],
    [x + w - inset, y + h - inset],
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
    // Slot
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(0.6, r * 0.22);
    ctx.beginPath();
    ctx.moveTo(sx - r * 0.55, sy);
    ctx.lineTo(sx + r * 0.55, sy);
    ctx.stroke();
  }
}

/** A McIntosh-style meter: brushed housing, deep lamp-lit glass face, tapered black needle. */
function drawMeterFace(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  vuLevel: number, label: string
) {
  const cx = x + w / 2;
  const pivotY = y + h * 0.85;
  const R = h * 0.62;
  const fs = Math.max(7, Math.min(w * 0.042, 18));
  const cr = w * 0.03;
  const bezelPad = w * 0.045;

  // --- Brushed-metal housing ---
  const housing = ctx.createLinearGradient(x - bezelPad, y - bezelPad, x - bezelPad, y + h + bezelPad);
  housing.addColorStop(0, '#2b2d30');
  housing.addColorStop(0.08, '#141516');
  housing.addColorStop(0.5, '#0a0a0b');
  housing.addColorStop(0.92, '#141516');
  housing.addColorStop(1, '#2b2d30');
  ctx.fillStyle = housing;
  ctx.beginPath();
  ctx.roundRect(x - bezelPad, y - bezelPad, w + bezelPad * 2, h + bezelPad * 2, cr + bezelPad * 0.6);
  ctx.fill();

  drawScrews(ctx, x - bezelPad, y - bezelPad, w + bezelPad * 2, h + bezelPad * 2, Math.max(2, w * 0.012));

  // Recessed chrome lip just outside the glass
  ctx.strokeStyle = 'rgba(210,214,220,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - 2, y - 2, w + 4, h + 4, cr + 1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - 4, y - 4, w + 8, h + 8, cr + 2);
  ctx.stroke();

  // --- Deep cobalt-blue lamp-lit glass face ---
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, cr);
  ctx.clip();

  // Base: near-black navy at the corners, rich blue through the middle
  const base = ctx.createLinearGradient(x, y, x, y + h);
  base.addColorStop(0, '#071826');
  base.addColorStop(0.5, '#0e3254');
  base.addColorStop(1, '#061420');
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);

  // Lamp glow: warm-white core fading through cyan into the blue base, sourced low/centre
  const lampX = cx;
  const lampY = pivotY - R * 0.1;
  const glow = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, R * 1.55);
  glow.addColorStop(0, 'rgba(210,240,255,0.55)');
  glow.addColorStop(0.18, 'rgba(140,215,255,0.38)');
  glow.addColorStop(0.45, 'rgba(70,165,230,0.18)');
  glow.addColorStop(0.75, 'rgba(20,80,130,0.05)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  // Vignette: darken the corners so the glow reads as sourced light, not a flat fill
  const vignette = ctx.createRadialGradient(cx, y + h * 0.42, R * 0.6, cx, y + h * 0.42, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.7, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,4,10,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);

  const red = 'hsl(353, 82%, 52%)';

  // VU label, with a faint emboss (dark stroke behind, bright fill on top)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fs * 2.1}px "Helvetica Neue", Arial, sans-serif`;
  ctx.lineWidth = Math.max(1, fs * 0.09);
  ctx.strokeStyle = 'rgba(0,10,20,0.55)';
  ctx.strokeText('VU', cx, y + h * 0.1 + 1);
  ctx.fillStyle = '#f2f9ff';
  ctx.fillText('VU', cx, y + h * 0.1);

  // === dB SCALE ===
  ctx.strokeStyle = '#061018';
  ctx.lineWidth = Math.max(1.3, w * 0.0045);
  drawArc(ctx, cx, pivotY, R, -20, 0, 60, true);

  ctx.strokeStyle = red;
  ctx.lineWidth = Math.max(1.6, w * 0.0055);
  drawArc(ctx, cx, pivotY, R, 0, 3, 30, true);

  const dbMarks = [
    { vu: -20, label: '20' }, { vu: -10, label: '10' },
    { vu: -7, label: '7' }, { vu: -5, label: '5' },
    { vu: -3, label: '3' }, { vu: -2, label: '2' },
    { vu: -1, label: '1' }, { vu: 0, label: '0' },
    { vu: 1, label: '1' }, { vu: 2, label: '2' },
    { vu: 3, label: '3' },
  ];

  const tick = R * 0.07;
  ctx.font = `bold ${fs}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const m of dbMarks) {
    const a = vuToAngle(m.vu);
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const isRed = m.vu >= 1;

    ctx.strokeStyle = isRed ? red : '#061018';
    ctx.lineWidth = Math.max(1.1, w * 0.0032);
    ctx.beginPath();
    ctx.moveTo(cx + sin * R, pivotY - cos * R);
    ctx.lineTo(cx + sin * (R - tick), pivotY - cos * (R - tick));
    ctx.stroke();

    const lr = R + fs * 0.78;
    ctx.fillStyle = isRed ? red : '#f2f9ff';
    ctx.fillText(m.label, cx + sin * lr, pivotY - cos * lr);
  }

  for (const vu of [-15, -8, -6, -4, -0.5, 0.5, 1.5, 2.5]) {
    const a = vuToAngle(vu);
    const isRed = vu > 0;
    ctx.strokeStyle = isRed ? red : '#061018';
    ctx.lineWidth = Math.max(0.5, w * 0.002);
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * R, pivotY - Math.cos(a) * R);
    ctx.lineTo(cx + Math.sin(a) * (R - tick * 0.5), pivotY - Math.cos(a) * (R - tick * 0.5));
    ctx.stroke();
  }

  ctx.font = `bold ${fs * 1.2}px "Helvetica Neue", Arial, sans-serif`;
  const symR = R + fs * 1.75;
  const minusA = vuToAngle(-16);
  ctx.fillStyle = '#f2f9ff';
  ctx.fillText('−', cx + Math.sin(minusA) * symR, pivotY - Math.cos(minusA) * symR);
  const plusA = vuToAngle(1.5);
  ctx.fillStyle = red;
  ctx.fillText('+', cx + Math.sin(plusA) * symR, pivotY - Math.cos(plusA) * symR);

  // === PERCENTAGE SCALE ===
  const pR = R * 0.8;
  const pTick = tick * 0.5;
  const pFs = fs * 0.7;

  ctx.strokeStyle = 'rgba(230,244,255,0.45)';
  ctx.lineWidth = Math.max(0.7, w * 0.002);
  drawArc(ctx, cx, pivotY, pR, 0, 100, 50, false);

  ctx.font = `${pFs}px "Helvetica Neue", Arial, sans-serif`;
  for (const pct of [0, 20, 40, 60, 80, 100]) {
    const a = pctToAngle(pct);
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    ctx.strokeStyle = 'rgba(230,244,255,0.45)';
    ctx.lineWidth = Math.max(0.5, w * 0.002);
    ctx.beginPath();
    ctx.moveTo(cx + sin * pR, pivotY - cos * pR);
    ctx.lineTo(cx + sin * (pR - pTick), pivotY - cos * (pR - pTick));
    ctx.stroke();
    ctx.fillStyle = 'rgba(230,244,255,0.5)';
    const lr = pR - pTick - pFs * 0.7;
    ctx.fillText(String(pct), cx + sin * lr, pivotY - cos * lr);
  }

  // === NEEDLE (tapered, like a real meter pointer) ===
  const needleAngle = vuToAngle(vuLevel);
  const dirX = Math.sin(needleAngle);
  const dirY = -Math.cos(needleAngle);
  const perpX = -dirY;
  const perpY = dirX;

  const needleLen = R * 1.03;
  const baseWidth = Math.max(1.8, w * 0.009);
  const tipWidth = Math.max(0.4, w * 0.0012);
  const cwLen = R * 0.13;

  const tipX = cx + dirX * needleLen;
  const tipY = pivotY + dirY * needleLen;
  const cwX = cx - dirX * cwLen;
  const cwY = pivotY - dirY * cwLen;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1.5;
  ctx.shadowOffsetY = 2;

  const needleGrad = ctx.createLinearGradient(
    cx - perpX * baseWidth, pivotY - perpY * baseWidth,
    cx + perpX * baseWidth, pivotY + perpY * baseWidth
  );
  needleGrad.addColorStop(0, '#000000');
  needleGrad.addColorStop(0.45, '#1a1a1a');
  needleGrad.addColorStop(0.55, '#000000');
  needleGrad.addColorStop(1, '#000000');
  ctx.fillStyle = needleGrad;
  ctx.beginPath();
  ctx.moveTo(cwX + perpX * baseWidth * 0.6, cwY + perpY * baseWidth * 0.6);
  ctx.lineTo(cx + perpX * baseWidth, pivotY + perpY * baseWidth);
  ctx.lineTo(tipX + perpX * tipWidth, tipY + perpY * tipWidth);
  ctx.lineTo(tipX - perpX * tipWidth, tipY - perpY * tipWidth);
  ctx.lineTo(cx - perpX * baseWidth, pivotY - perpY * baseWidth);
  ctx.lineTo(cwX - perpX * baseWidth * 0.6, cwY - perpY * baseWidth * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Counterweight
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(cwX, cwY, w * 0.011, 0, Math.PI * 2);
  ctx.fill();

  // Pivot cover (polished centre cap)
  const pivotGrad = ctx.createRadialGradient(cx - w * 0.006, pivotY - w * 0.006, 0, cx, pivotY, w * 0.024);
  pivotGrad.addColorStop(0, '#5a5a5a');
  pivotGrad.addColorStop(0.5, '#1a1a1a');
  pivotGrad.addColorStop(1, '#000000');
  ctx.fillStyle = pivotGrad;
  ctx.beginPath();
  ctx.arc(cx, pivotY, w * 0.024, 0, Math.PI * 2);
  ctx.fill();

  // Channel label
  ctx.fillStyle = 'rgba(230,244,255,0.7)';
  ctx.font = `${fs * 0.9}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, pivotY + h * 0.08);

  // --- Curved-glass highlight: a broad soft diagonal sweep plus a tighter specular streak ---
  const sweep = ctx.createLinearGradient(x, y, x + w * 0.75, y + h * 0.55);
  sweep.addColorStop(0, 'rgba(255,255,255,0.16)');
  sweep.addColorStop(0.35, 'rgba(255,255,255,0.05)');
  sweep.addColorStop(0.6, 'rgba(255,255,255,0)');
  ctx.fillStyle = sweep;
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.translate(x + w * 0.28, y + h * 0.22);
  ctx.rotate(-0.55);
  const streak = ctx.createLinearGradient(-w * 0.12, 0, w * 0.12, 0);
  streak.addColorStop(0, 'rgba(255,255,255,0)');
  streak.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  streak.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(-w * 0.12, -h * 0.55, w * 0.24, h * 1.1);
  ctx.restore();

  // Subtle dark curvature at the very top and bottom edge of the dome
  const domeShade = ctx.createLinearGradient(x, y, x, y + h);
  domeShade.addColorStop(0, 'rgba(0,0,0,0.22)');
  domeShade.addColorStop(0.12, 'rgba(0,0,0,0)');
  domeShade.addColorStop(0.9, 'rgba(0,0,0,0)');
  domeShade.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = domeShade;
  ctx.fillRect(x, y, w, h);

  ctx.restore(); // end clip

  // Glass edge
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

      // Layout two meters side-by-side
      const pad = Math.min(w, meterAreaH) * 0.07;
      const gap = Math.min(w, meterAreaH) * 0.04;
      const aspect = 1.35;

      let mW = (w - pad * 2 - gap) / 2;
      let mH = mW / aspect;
      if (mH > meterAreaH - pad * 2) { mH = meterAreaH - pad * 2; mW = mH * aspect; }

      mW *= Math.min(s.scale, 2);
      mH *= Math.min(s.scale, 2);

      const totalW = mW * 2 + gap;
      const sx = (w - totalW) / 2;
      const sy = (meterAreaH - mH) / 2;

      const clL = Math.max(-20, Math.min(3, smoothedL));
      const clR = Math.max(-20, Math.min(3, smoothedR));

      drawMeterFace(ctx, sx, sy, mW, mH, clL, 'L');
      drawMeterFace(ctx, sx + mW + gap, sy, mW, mH, clR, 'R');

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
