// Turns raw per-frame landmarks into clean, filtered time series and detects foot contacts.

import { Contact, Frame, LM, Pt, Side, other } from './types';
import { fillGaps, lowpass, median, percentile } from './signal';

export type Joint = 'shoulder' | 'hip' | 'knee' | 'ankle' | 'heel' | 'toe';
const JOINTS: Joint[] = ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'];
const LOWER: Joint[] = ['knee', 'ankle', 'heel', 'toe'];

export interface Series {
  x: number[];
  y: number[];
  v: number[];
}

export interface Tracks {
  n: number;
  /** Raw media time (s) of each sample. */
  t: number[];
  /** Raw sample rate of the decoded file (frames per media second). */
  fsRaw: number;
  get(j: Joint, s: Side): Series;
  /** Share of frames with a detected person. */
  detectionRate: number;
  /** Median hip–ankle length in px (the scale for every distance). */
  legLen: number;
  /** Median horizontal distance between the hips in px. */
  hipWidth: number;
}

const VIS_MIN = 0.3;

function rawSeries(frames: Frame[], idx: number): Series {
  const x: number[] = [], y: number[] = [], v: number[] = [];
  for (const f of frames) {
    const p: Pt | undefined = f.lm?.[idx];
    const ok = p && p.v >= VIS_MIN;
    x.push(ok ? p!.x : NaN);
    y.push(ok ? p!.y : NaN);
    v.push(p ? p.v : 0);
  }
  return { x, y, v };
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/**
 * Pose models sometimes swap the left and right leg for a few frames (most often when the
 * legs cross). Keep each leg on the track that is closest to where it was in the previous frame.
 */
export function fixLegSwaps(raw: Record<string, Series>, n: number): number {
  let swaps = 0;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    let ok = true;
    for (const j of LOWER) if (!Number.isFinite(raw[`${j}L`].x[i]) || !Number.isFinite(raw[`${j}R`].x[i])) ok = false;
    if (!ok) continue;
    if (prev >= 0) {
      let same = 0, cross = 0;
      for (const j of LOWER) {
        const L = raw[`${j}L`], R = raw[`${j}R`];
        same += dist(L.x[i], L.y[i], L.x[prev], L.y[prev]) + dist(R.x[i], R.y[i], R.x[prev], R.y[prev]);
        cross += dist(L.x[i], L.y[i], R.x[prev], R.y[prev]) + dist(R.x[i], R.y[i], L.x[prev], L.y[prev]);
      }
      if (cross < same * 0.5) {
        swaps++;
        for (const j of LOWER) {
          const L = raw[`${j}L`], R = raw[`${j}R`];
          for (const k of ['x', 'y', 'v'] as const) {
            const tmp = L[k][i];
            L[k][i] = R[k][i];
            R[k][i] = tmp;
          }
        }
      }
    }
    prev = i;
  }
  return swaps;
}

export function buildTracks(frames: Frame[]): Tracks {
  const n = frames.length;
  const t = frames.map((f) => f.t);
  const dts = t.slice(1).map((x, i) => x - t[i]).filter((d) => d > 0);
  const fsRaw = dts.length ? 1 / median(dts) : 30;

  const raw: Record<string, Series> = {};
  for (const j of JOINTS) for (const s of ['L', 'R'] as Side[]) raw[`${j}${s}`] = rawSeries(frames, LM[j][s]);
  fixLegSwaps(raw, n);

  const maxGap = Math.max(2, Math.round(fsRaw * 0.12));
  const fc = Math.min(8, fsRaw / 4);
  const clean: Record<string, Series> = {};
  for (const k of Object.keys(raw)) {
    const r = raw[k];
    clean[k] = {
      x: lowpass(fillGaps(r.x, maxGap), fsRaw, fc),
      y: lowpass(fillGaps(r.y, maxGap), fsRaw, fc),
      v: r.v,
    };
  }

  const get = (j: Joint, s: Side) => clean[`${j}${s}`];
  const legs: number[] = [];
  const hips: number[] = [];
  for (let i = 0; i < n; i++) {
    for (const s of ['L', 'R'] as Side[]) {
      const h = get('hip', s), a = get('ankle', s);
      const d = dist(h.x[i], h.y[i], a.x[i], a.y[i]);
      if (Number.isFinite(d)) legs.push(d);
    }
    const w = Math.abs(get('hip', 'L').x[i] - get('hip', 'R').x[i]);
    if (Number.isFinite(w)) hips.push(w);
  }

  return {
    n,
    t,
    fsRaw,
    get,
    detectionRate: n ? frames.filter((f) => f.lm).length / n : 0,
    legLen: percentile(legs, 75) || 1,
    hipWidth: median(hips) || 1,
  };
}

/** Lowest point of the foot (max image y of heel and toe) per sample. */
export function footLow(tr: Tracks, s: Side): number[] {
  const h = tr.get('heel', s).y, t = tr.get('toe', s).y;
  return h.map((y, i) => Math.max(y, t[i]));
}

/**
 * Stride period in samples, from the autocorrelation of the vertical foot signal.
 * Works without knowing the true frame rate, so slow-motion files are handled the same way.
 */
export function stridePeriod(tr: Tracks): number | null {
  const results: number[] = [];
  for (const s of ['L', 'R'] as Side[]) {
    const y = footLow(tr, s);
    const m = y.filter(Number.isFinite);
    if (m.length < 20) continue;
    const mu = m.reduce((a, b) => a + b, 0) / m.length;
    const z = y.map((v) => (Number.isFinite(v) ? v - mu : 0));
    const maxLag = Math.floor(z.length / 2);
    const ac: number[] = [];
    for (let lag = 0; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < z.length; i++) sum += z[i] * z[i + lag];
      ac.push(sum / (z.length - lag));
    }
    // first zero crossing, then the highest peak after it
    let k = 1;
    while (k < ac.length && ac[k] > 0) k++;
    let best = -1, bestV = -Infinity;
    for (let lag = k; lag < ac.length - 1; lag++) {
      if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > bestV) {
        bestV = ac[lag];
        best = lag;
        // the first strong peak is the stride; later peaks are its multiples
        if (bestV > 0.3 * ac[0]) break;
      }
    }
    if (best > 2) results.push(best);
  }
  return results.length ? median(results) : null;
}

/**
 * Detect stance phases: the foot's lowest point stays within a small band above the local
 * ground line. The ground line is a rolling high percentile of both feet, so it follows
 * a runner moving towards or away from the camera.
 */
export function detectContacts(tr: Tracks, period: number): Contact[] {
  const lows: Record<Side, number[]> = { L: footLow(tr, 'L'), R: footLow(tr, 'R') };
  const n = tr.n;
  const half = Math.max(3, Math.round(period * 0.75));
  const ground: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
    ground.push(percentile([...lows.L.slice(a, b), ...lows.R.slice(a, b)], 95));
  }
  const band = 0.05 * tr.legLen;
  const minLen = Math.max(2, Math.round(period * 0.1));
  const maxLen = Math.round(period * 0.65);

  const out: Contact[] = [];
  for (const s of ['L', 'R'] as Side[]) {
    const y = lows[s];
    const on = y.map((v, i) => Number.isFinite(v) && Number.isFinite(ground[i]) && v >= ground[i] - band);
    let i = 0;
    while (i < n) {
      if (!on[i]) { i++; continue; }
      const st = i;
      while (i < n && on[i]) i++;
      const en = i - 1;
      const len = en - st + 1;
      if (st === 0 || en === n - 1) continue; // incomplete at the edges
      if (len < minLen || len > maxLen) continue;
      out.push({ side: s, ic: st, to: en });
    }
  }
  return out.sort((a, b) => a.ic - b.ic);
}

/** Steps per minute in media time (before slow-motion correction). */
export function rawCadence(tr: Tracks, contacts: Contact[]): number | null {
  const steps: number[] = [];
  for (let k = 1; k < contacts.length; k++) {
    if (contacts[k].side !== contacts[k - 1].side) steps.push(tr.t[contacts[k].ic] - tr.t[contacts[k - 1].ic]);
  }
  if (steps.length >= 3) return 60 / median(steps);
  const strides: number[] = [];
  for (const s of ['L', 'R'] as Side[]) {
    const c = contacts.filter((x) => x.side === s);
    for (let k = 1; k < c.length; k++) strides.push(tr.t[c[k].ic] - tr.t[c[k - 1].ic]);
  }
  return strides.length ? 120 / median(strides) : null;
}

/**
 * Slow-motion factor. A running cadence sits between ~140 and ~220 steps/min; a decoded
 * cadence far below that means the clip plays slower than real time.
 */
export function guessSlowMotion(cadenceRaw: number | null): number {
  if (!cadenceRaw) return 1;
  if (cadenceRaw >= 125) return 1;
  for (const f of [2, 4, 8, 10, 16]) if (cadenceRaw * f >= 130 && cadenceRaw * f <= 235) return f;
  return 1;
}

/** Mean visibility of the given joints over the frames where a person was found. */
export function visibility(tr: Tracks, joints: Joint[], s: Side): number {
  const vals: number[] = [];
  for (const j of joints) vals.push(...tr.get(j, s).v.filter((v) => v > 0));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

export { other };
