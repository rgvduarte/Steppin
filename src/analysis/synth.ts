// Synthetic runners with known kinematics, to check the analysis end to end without video.

import { Frame, Pt } from './types';

export interface SynthOpts {
  fps?: number;
  seconds?: number;
  cadence?: number;
  strikeDeg?: number; // foot angle at initial contact (+ = toes up)
  eversionDeg?: number; // peak rearfoot eversion (rear view)
  leanDeg?: number;
  timeScale?: number; // >1 simulates a slow-motion file
  noise?: number; // px
}

const rad = (d: number) => (d * Math.PI) / 180;
const blank = (): Pt[] => Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0.1 }));

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
}

/** Two-link IK: knee position for a leg of equal thigh and shank, knee bending towards `bend` x-direction. */
function knee(hx: number, hy: number, ax: number, ay: number, seg: number, bend: number) {
  const dx = ax - hx, dy = ay - hy;
  const d = Math.min(Math.hypot(dx, dy), 2 * seg - 0.01);
  const h = Math.sqrt(Math.max(0, seg * seg - (d / 2) ** 2));
  const mx = hx + dx / 2, my = hy + dy / 2;
  const nx = -dy / Math.hypot(dx, dy), ny = dx / Math.hypot(dx, dy);
  const s = Math.sign(nx) === Math.sign(bend) ? 1 : -1;
  return { x: mx + s * nx * h, y: my + s * ny * h };
}

export function synthSide(o: SynthOpts = {}): Frame[] {
  const fps = o.fps ?? 60, secs = o.seconds ?? 10, cad = o.cadence ?? 170;
  const A = o.strikeDeg ?? 15, lean = o.leanDeg ?? 8, scale = o.timeScale ?? 1;
  const noise = rng(7);
  const stride = 120 / cad; // seconds
  const G = 800, hipX = 500, legLen = 400, seg = 172, L = 110, dir = 1;
  const stance = 0.36;
  const frames: Frame[] = [];
  const footAt = (phase: number) => {
    // returns heel, toe, ankle for a foot at stride phase 0..1 (0 = initial contact)
    const reach = 0.22 * legLen, back = 0.35 * legLen;
    let theta: number, px: number, py: number;
    if (phase < stance) {
      const u = phase / stance;
      theta = u < 0.15 ? A * (1 - u / 0.15) : u < 0.6 ? 0 : -40 * ((u - 0.6) / 0.4);
      px = hipX + dir * (reach - (reach + back) * u);
      py = G;
    } else {
      const u = (phase - stance) / (1 - stance);
      theta = -40 + (A + 40) * u;
      const startX = hipX + dir * -back, endX = hipX + dir * reach;
      px = startX + (endX - startX) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      py = G - 0.45 * legLen * Math.sin(Math.PI * u);
    }
    let hx: number, hy: number, tx: number, ty: number;
    if (theta >= 0) {
      hx = px; hy = py;
      tx = hx + dir * L * Math.cos(rad(theta)); ty = hy - L * Math.sin(rad(theta));
    } else {
      tx = px + dir * L; ty = py;
      hx = tx - dir * L * Math.cos(rad(theta)); hy = ty + L * Math.sin(rad(theta));
    }
    const ax = hx + dir * 0.22 * L, ay = hy - 0.5 * L + (ty - hy) * 0.2;
    return { hx, hy, tx, ty, ax, ay };
  };

  for (let i = 0; i < fps * secs; i++) {
    const t = i / fps;
    const lm = blank();
    const osc = 17 * Math.cos((2 * Math.PI * t * 2) / stride); // ~7 cm peak-to-peak bounce per step
    const hipY = G - legLen - 30 + osc;
    const set = (k: number, x: number, y: number) => (lm[k] = { x: x + noise() * (o.noise ?? 0), y: y + noise() * (o.noise ?? 0), v: 0.92 });
    for (const [side, off] of [['L', 0], ['R', 0.5]] as const) {
      const ph = ((t / stride + off) % 1 + 1) % 1;
      const f = footAt(ph);
      const kn = knee(hipX, hipY, f.ax, f.ay, seg, dir);
      const b = side === 'L' ? 0 : 1;
      set(23 + b, hipX, hipY);
      set(25 + b, kn.x, kn.y);
      set(27 + b, f.ax, f.ay);
      set(29 + b, f.hx, f.hy);
      set(31 + b, f.tx, f.ty);
      set(11 + b, hipX + dir * Math.sin(rad(lean)) * 300, hipY - Math.cos(rad(lean)) * 300);
    }
    frames.push({ t: t * scale, lm });
  }
  return frames;
}

export function synthRear(o: SynthOpts = {}): Frame[] {
  const fps = o.fps ?? 60, secs = o.seconds ?? 10, cad = o.cadence ?? 170, E = o.eversionDeg ?? 8;
  const stride = 120 / cad;
  const G = 800, legLen = 400, stance = 0.36;
  const hip = { L: 460, R: 540 }, lat = { L: -1, R: 1 };
  const frames: Frame[] = [];
  for (let i = 0; i < fps * secs; i++) {
    const t = i / fps;
    const lm = blank();
    const set = (k: number, x: number, y: number) => (lm[k] = { x, y, v: 0.9 });
    const hipY = G - legLen - 30;
    for (const [side, off] of [['L', 0], ['R', 0.5]] as const) {
      const b = side === 'L' ? 0 : 1;
      const ph = ((t / stride + off) % 1 + 1) % 1;
      const footX = hip[side] + lat[side] * -10; // slightly inside the hip, not crossing
      let lift = 0, ev = -2;
      if (ph < stance) {
        const u = ph / stance;
        ev = -2 + (E + 2) * Math.sin(Math.PI * Math.min(1, u / 0.8));
      } else {
        lift = 0.35 * legLen * Math.sin((Math.PI * (ph - stance)) / (1 - stance));
      }
      const heelY = G - lift, ankleY = heelY - 45;
      const ankleX = footX;
      const heelX = ankleX + lat[side] * 45 * Math.tan(rad(ev));
      set(23 + b, hip[side], hipY + (side === 'L' ? 1 : -1) * 0);
      set(25 + b, (hip[side] + ankleX) / 2, (hipY + ankleY) / 2);
      set(27 + b, ankleX, ankleY);
      set(29 + b, heelX, heelY);
      set(31 + b, ankleX, heelY - 5);
      set(11 + b, hip[side], hipY - 300);
    }
    frames.push({ t, lm });
  }
  return frames;
}
