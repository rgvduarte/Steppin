// Builds an animated 3D mannequin (a .glb) from MediaPipe world landmarks, for <model-viewer>.
// Each bone is a unit cylinder node animated in translation, rotation and scale; each joint a
// sphere node animated in translation. No skinning: simple, robust and small.

import type { Frame, Pt3 } from '../analysis/types';
import { fillGaps, lowpass, median } from '../analysis/signal';

type V3 = [number, number, number];
type Tone = 'light' | 'grey';

interface BoneDef { a: number | 'head' | 'neck' | 'pelvis'; b: number | 'head' | 'neck' | 'pelvis'; r: number; tone: Tone }
interface JointDef { p: number | 'head'; r: number; tone: Tone }

// MediaPipe indices: odd = left, even = right. Left side light, right side grey.
const BONES: BoneDef[] = [
  { a: 'neck', b: 'pelvis', r: 0.075, tone: 'light' },
  { a: 11, b: 12, r: 0.045, tone: 'light' },
  { a: 23, b: 24, r: 0.055, tone: 'light' },
  { a: 'neck', b: 'head', r: 0.035, tone: 'light' },
  { a: 11, b: 13, r: 0.04, tone: 'light' }, { a: 13, b: 15, r: 0.033, tone: 'light' },
  { a: 12, b: 14, r: 0.04, tone: 'grey' }, { a: 14, b: 16, r: 0.033, tone: 'grey' },
  { a: 23, b: 25, r: 0.062, tone: 'light' }, { a: 25, b: 27, r: 0.046, tone: 'light' },
  { a: 27, b: 29, r: 0.03, tone: 'light' }, { a: 29, b: 31, r: 0.03, tone: 'light' }, { a: 27, b: 31, r: 0.028, tone: 'light' },
  { a: 24, b: 26, r: 0.062, tone: 'grey' }, { a: 26, b: 28, r: 0.046, tone: 'grey' },
  { a: 28, b: 30, r: 0.03, tone: 'grey' }, { a: 30, b: 32, r: 0.03, tone: 'grey' }, { a: 28, b: 32, r: 0.028, tone: 'grey' },
];
const JOINTS: JointDef[] = [
  { p: 'head', r: 0.105, tone: 'light' },
  { p: 11, r: 0.05, tone: 'light' }, { p: 12, r: 0.05, tone: 'grey' },
  { p: 13, r: 0.04, tone: 'light' }, { p: 14, r: 0.04, tone: 'grey' },
  { p: 15, r: 0.036, tone: 'light' }, { p: 16, r: 0.036, tone: 'grey' },
  { p: 23, r: 0.062, tone: 'light' }, { p: 24, r: 0.062, tone: 'grey' },
  { p: 25, r: 0.054, tone: 'light' }, { p: 26, r: 0.054, tone: 'grey' },
  { p: 27, r: 0.044, tone: 'light' }, { p: 28, r: 0.044, tone: 'grey' },
  { p: 29, r: 0.032, tone: 'light' }, { p: 30, r: 0.032, tone: 'grey' },
  { p: 31, r: 0.03, tone: 'light' }, { p: 32, r: 0.03, tone: 'grey' },
];
const USED = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

// ---------- geometry ----------
function cylinder(seg = 18) {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c, -0.5, s, c, 0.5, s);
    nor.push(c, 0, s, c, 0, s);
  }
  for (let i = 0; i < seg; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  return { pos, nor, idx };
}
function sphere(w = 20, h = 14) {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let j = 0; j <= h; j++) {
    const v = (j / h) * Math.PI;
    for (let i = 0; i <= w; i++) {
      const u = (i / w) * Math.PI * 2;
      const x = Math.sin(v) * Math.cos(u), y = Math.cos(v), z = Math.sin(v) * Math.sin(u);
      pos.push(x, y, z);
      nor.push(x, y, z);
    }
  }
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const a = j * (w + 1) + i, b = a + w + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  return { pos, nor, idx };
}

// ---------- maths ----------
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
/** Quaternion turning +Y onto direction d. */
function quatY(d: V3): [number, number, number, number] {
  const l = len(d) || 1;
  const x = d[0] / l, y = d[1] / l, z = d[2] / l;
  if (y > 0.999999) return [0, 0, 0, 1];
  if (y < -0.999999) return [1, 0, 0, 0];
  const ax: V3 = [z, 0, -x];
  const al = len(ax);
  const ang = Math.acos(Math.max(-1, Math.min(1, y)));
  const s = Math.sin(ang / 2) / al;
  return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)];
}

// ---------- glb writer ----------
class Bin {
  parts: Uint8Array[] = [];
  length = 0;
  views: object[] = [];
  accessors: object[] = [];
  add(data: Float32Array | Uint16Array, target?: number) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const offset = this.length;
    this.parts.push(bytes);
    this.length += bytes.byteLength;
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.parts.push(new Uint8Array(pad)); this.length += pad; }
    this.views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    return this.views.length - 1;
  }
  accessor(data: Float32Array | Uint16Array, type: 'SCALAR' | 'VEC3' | 'VEC4', target?: number, minmax = false) {
    const view = this.add(data, target);
    const comps = type === 'SCALAR' ? 1 : type === 'VEC3' ? 3 : 4;
    const acc: Record<string, unknown> = {
      bufferView: view,
      componentType: data instanceof Uint16Array ? 5123 : 5126,
      count: data.length / comps,
      type,
    };
    if (minmax) {
      const min = new Array(comps).fill(Infinity), max = new Array(comps).fill(-Infinity);
      for (let i = 0; i < data.length; i++) {
        const c = i % comps;
        min[c] = Math.min(min[c], data[i]);
        max[c] = Math.max(max[c], data[i]);
      }
      acc.min = min;
      acc.max = max;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }
  concat() {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.byteLength; }
    return out;
  }
}

export interface RunnerOptions {
  /** Media time window to loop (ideally initial contact to initial contact). */
  t0?: number;
  t1?: number;
  /** Slow-motion factor: media seconds per real second. */
  slow?: number;
}

/** Turn world-landmark frames into an animated .glb. Returns null when there is too little data. */
export function buildRunnerGlb(frames: Frame[], opts: RunnerOptions = {}): ArrayBuffer | null {
  const slow = opts.slow ?? 1;
  let sel = frames.filter((f) => f.w && (opts.t0 == null || f.t >= opts.t0) && (opts.t1 == null || f.t <= opts.t1));
  if (sel.length < 8) sel = frames.filter((f) => f.w);
  if (sel.length < 8) return null;
  // keep the file small: at most ~240 samples
  const stepN = Math.max(1, Math.ceil(sel.length / 240));
  sel = sel.filter((_, i) => i % stepN === 0);
  const n = sel.length;
  const times = sel.map((f) => (f.t - sel[0].t) / slow);
  const fs = n > 1 ? (n - 1) / (times[n - 1] || 1) : 30;

  // Clean every coordinate series. Convert to glTF axes: x right, y up, z towards the camera.
  const series: Record<number, V3[]> = {};
  for (const i of USED) {
    const get = (k: 'x' | 'y' | 'z', sign: number) =>
      lowpass(fillGaps(sel.map((f) => { const p: Pt3 | undefined = f.w?.[i]; return p && p.v > 0.2 ? p[k] * sign : NaN; }), 6), fs, Math.min(8, fs / 4));
    const xs = get('x', 1), ys = get('y', -1), zs = get('z', -1);
    series[i] = xs.map((x, k) => [x, ys[k], zs[k]]);
  }
  // Fill anything still missing with the series median, so no NaN reaches the file.
  for (const i of USED)
    for (let c = 0; c < 3; c++) {
      const m = median(series[i].map((v) => v[c])) || 0;
      for (const v of series[i]) if (!Number.isFinite(v[c])) v[c] = m;
    }
  // Ground at the lowest foot point, so the shadow sits under the feet.
  const footY = [29, 30, 31, 32].flatMap((i) => series[i].map((v) => v[1]));
  const ground = Math.min(...footY.filter(Number.isFinite)) - 0.012;
  for (const i of USED) for (const v of series[i]) v[1] -= ground;

  const at = (p: BoneDef['a'] | JointDef['p'], k: number): V3 => {
    if (p === 'head') return mid(series[7][k], series[8][k]);
    if (p === 'neck') return mid(series[11][k], series[12][k]);
    if (p === 'pelvis') return mid(series[23][k], series[24][k]);
    return series[p][k];
  };

  const bin = new Bin();
  const geo = { cyl: cylinder(), sph: sphere() };
  const prim = (g: { pos: number[]; nor: number[]; idx: number[] }) => ({
    POSITION: bin.accessor(new Float32Array(g.pos), 'VEC3', 34962, true),
    NORMAL: bin.accessor(new Float32Array(g.nor), 'VEC3', 34962),
    indices: bin.accessor(new Uint16Array(g.idx), 'SCALAR', 34963),
  });
  const cylA = prim(geo.cyl), sphA = prim(geo.sph);
  const mat = { light: 0, grey: 1 } as const;
  const meshes = [
    { primitives: [{ attributes: { POSITION: cylA.POSITION, NORMAL: cylA.NORMAL }, indices: cylA.indices, material: mat.light }] },
    { primitives: [{ attributes: { POSITION: cylA.POSITION, NORMAL: cylA.NORMAL }, indices: cylA.indices, material: mat.grey }] },
    { primitives: [{ attributes: { POSITION: sphA.POSITION, NORMAL: sphA.NORMAL }, indices: sphA.indices, material: mat.light }] },
    { primitives: [{ attributes: { POSITION: sphA.POSITION, NORMAL: sphA.NORMAL }, indices: sphA.indices, material: mat.grey }] },
  ];

  const input = bin.accessor(new Float32Array(times), 'SCALAR', undefined, true);
  const nodes: object[] = [];
  const samplers: object[] = [];
  const channels: object[] = [];
  const animate = (node: number, path: 'translation' | 'rotation' | 'scale', data: Float32Array, type: 'VEC3' | 'VEC4') => {
    samplers.push({ input, output: bin.accessor(data, type), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node, path } });
  };

  for (const b of BONES) {
    const T = new Float32Array(n * 3), R = new Float32Array(n * 4), S = new Float32Array(n * 3);
    let prev: number[] | null = null;
    for (let k = 0; k < n; k++) {
      const A = at(b.a, k), B = at(b.b, k);
      const d = sub(B, A), m = mid(A, B);
      let q = quatY(d);
      if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
      prev = q;
      T.set(m, k * 3);
      R.set(q, k * 4);
      S.set([b.r, Math.max(0.001, len(d)), b.r], k * 3);
    }
    // rest pose = first frame, so the viewer frames the body before the animation starts
    nodes.push({ mesh: b.tone === 'light' ? 0 : 1, translation: Array.from(T.slice(0, 3)), rotation: Array.from(R.slice(0, 4)), scale: Array.from(S.slice(0, 3)) });
    const id = nodes.length - 1;
    animate(id, 'translation', T, 'VEC3');
    animate(id, 'rotation', R, 'VEC4');
    animate(id, 'scale', S, 'VEC3');
  }
  for (const j of JOINTS) {
    const T = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) T.set(at(j.p, k), k * 3);
    nodes.push({ mesh: j.tone === 'light' ? 2 : 3, scale: [j.r, j.r, j.r] });
    // translation is animated on a parent so the static scale stays on the child
    const child = nodes.length - 1;
    nodes.push({ children: [child], translation: Array.from(T.slice(0, 3)) });
    animate(nodes.length - 1, 'translation', T, 'VEC3');
  }
  const top = nodes.map((_, i) => i).filter((i) => !(nodes as { children?: number[] }[]).some((nd) => nd.children?.includes(i)));
  nodes.push({ name: 'runner', children: top });

  const json = {
    asset: { version: '2.0', generator: 'Steppin' },
    scene: 0,
    scenes: [{ nodes: [nodes.length - 1] }],
    nodes,
    meshes,
    materials: [
      { name: 'light', pbrMetallicRoughness: { baseColorFactor: [0.93, 0.93, 0.94, 1], metallicFactor: 0, roughnessFactor: 0.42 } },
      { name: 'grey', pbrMetallicRoughness: { baseColorFactor: [0.32, 0.32, 0.34, 1], metallicFactor: 0, roughnessFactor: 0.5 } },
    ],
    animations: [{ name: 'run', samplers, channels }],
    accessors: bin.accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: bin.length }],
  };

  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (enc.length % 4)) % 4;
  const jsonChunk = new Uint8Array(enc.length + jpad).fill(0x20);
  jsonChunk.set(enc);
  const binData = bin.concat();
  const total = 12 + 8 + jsonChunk.length + 8 + binData.length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20, jsonChunk.length).set(jsonChunk);
  dv.setUint32(20 + jsonChunk.length, binData.length, true);
  dv.setUint32(24 + jsonChunk.length, 0x004e4942, true);
  new Uint8Array(out, 28 + jsonChunk.length).set(binData);
  return out;
}

let loading: Promise<unknown> | null = null;
/** Load the <model-viewer> web component on demand (it brings three.js, ~1 MB). */
export const loadModelViewer = () => (loading ??= import('@google/model-viewer'));

/** A <model-viewer> element playing the runner. */
export function runnerViewer(glb: ArrayBuffer, opts: { label: string; orbit?: string; autoRotate?: boolean; controls?: boolean }) {
  void loadModelViewer();
  const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  const el = document.createElement('model-viewer');
  el.setAttribute('src', url);
  el.setAttribute('alt', opts.label);
  el.setAttribute('autoplay', '');
  el.setAttribute('animation-name', 'run');
  el.setAttribute('shadow-intensity', '1.1');
  el.setAttribute('shadow-softness', '0.7');
  el.setAttribute('exposure', '1.05');
  el.setAttribute('environment-image', 'neutral');
  el.setAttribute('interaction-prompt', 'none');
  el.setAttribute('camera-orbit', opts.orbit ?? '35deg 78deg auto');
  el.setAttribute('disable-zoom', '');
  if (opts.controls !== false) el.setAttribute('camera-controls', '');
  if (opts.autoRotate) { el.setAttribute('auto-rotate', ''); el.setAttribute('rotation-per-second', '12deg'); el.setAttribute('auto-rotate-delay', '0'); }
  return el;
}
