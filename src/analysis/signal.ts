// Small numeric helpers: gap filling, zero-phase low-pass filtering, statistics.

export const deg = (rad: number) => (rad * 180) / Math.PI;

export function median(a: number[]): number {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function percentile(a: number[], p: number): number {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const i = Math.min(v.length - 1, Math.max(0, (p / 100) * (v.length - 1)));
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}

export const mean = (a: number[]) => {
  const v = a.filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};

/** Linear interpolation over NaN gaps up to `maxGap` samples; longer gaps stay NaN. */
export function fillGaps(a: number[], maxGap: number): number[] {
  const out = a.slice();
  let i = 0;
  while (i < out.length) {
    if (Number.isFinite(out[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < out.length && !Number.isFinite(out[i])) i++;
    const end = i; // first finite after the gap, or length
    const len = end - start;
    if (len > maxGap) continue;
    const a0 = start > 0 ? out[start - 1] : NaN;
    const a1 = end < out.length ? out[end] : NaN;
    for (let k = start; k < end; k++) {
      if (Number.isFinite(a0) && Number.isFinite(a1)) out[k] = a0 + ((a1 - a0) * (k - start + 1)) / (len + 1);
      else if (Number.isFinite(a0)) out[k] = a0;
      else if (Number.isFinite(a1)) out[k] = a1;
    }
  }
  return out;
}

/**
 * Zero-phase 2nd-order Butterworth low-pass (forward and backward), the usual filter
 * for kinematic data. NaN runs are left in place and filtering restarts after them.
 */
export function lowpass(a: number[], fs: number, fc: number): number[] {
  if (!(fc > 0) || fc >= fs / 2.05) return a.slice();
  const w = Math.tan((Math.PI * fc) / fs);
  const k1 = Math.SQRT2 * w;
  const k2 = w * w;
  const b0 = k2 / (1 + k1 + k2);
  const b1 = 2 * b0;
  const b2 = b0;
  const a1 = (2 * (k2 - 1)) / (1 + k1 + k2);
  const a2 = (1 - k1 + k2) / (1 + k1 + k2);

  const run = (x: number[]) => {
    const y = new Array<number>(x.length);
    let x1 = x[0], x2 = x[0], y1 = x[0], y2 = x[0];
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      y[i] = yi;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    }
    return y;
  };

  const out = a.slice();
  let i = 0;
  while (i < a.length) {
    if (!Number.isFinite(a[i])) { i++; continue; }
    const s = i;
    while (i < a.length && Number.isFinite(a[i])) i++;
    const seg = a.slice(s, i);
    if (seg.length < 6) continue;
    // pad with reflected samples to tame edge transients
    const pad = Math.min(seg.length - 1, Math.round(fs / fc));
    const head = seg.slice(1, pad + 1).reverse().map((v) => 2 * seg[0] - v);
    const tail = seg.slice(-pad - 1, -1).reverse().map((v) => 2 * seg[seg.length - 1] - v);
    const padded = [...head, ...seg, ...tail];
    const f = run(run(padded).reverse()).reverse();
    for (let k = 0; k < seg.length; k++) out[s + k] = f[pad + k];
  }
  return out;
}

/** Resample samples a[i0..i1] (inclusive) to n points over 0..100 %. */
export function normalise(a: number[], i0: number, i1: number, n = 51): number[] {
  const out: number[] = [];
  const span = i1 - i0;
  for (let k = 0; k < n; k++) {
    const x = i0 + (span * k) / (n - 1);
    const lo = Math.floor(x);
    const hi = Math.min(i1, Math.ceil(x));
    const f = x - lo;
    out.push(a[lo] + (a[hi] - a[lo]) * f);
  }
  return out;
}

export function meanCurve(curves: number[][]): number[] {
  if (!curves.length) return [];
  const n = curves[0].length;
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(median(curves.map((c) => c[k])));
  return out;
}

export const round = (x: number | null | undefined, d = 0) =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;
