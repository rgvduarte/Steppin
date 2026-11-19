// Annotated 2D figures drawn from the landmarks of a measured frame: the runner as a capsule
// mannequin, with the measured angles drawn on the body. Pure SVG, so they print sharp.

import type { Metric, Pt, Side } from '../analysis/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : (Math.round(v * 10) / 10).toString().replace('.', ','));
type P2 = { x: number; y: number };

function fit(pose: Pt[], idx: number[], W: number, H: number, pad: number, flip: boolean) {
  const pts = idx.map((i) => pose[i]).filter((p) => p && Number.isFinite(p.x));
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const s = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1));
  const ox = (W - (maxX - minX) * s) / 2, oy = (H - (maxY - minY) * s) / 2;
  return (i: number): P2 => {
    const p = pose[i];
    const x = (p.x - minX) * s + ox;
    return { x: flip ? W - x : x, y: (p.y - minY) * s + oy };
  };
}

function arc(c: P2, r: number, a0: number, a1: number) {
  // angles in radians, SVG coordinates (y down)
  const p0 = { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) };
  const p1 = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) };
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
}
const ang = (a: P2, b: P2) => Math.atan2(b.y - a.y, b.x - a.x);
const line = (a: P2, b: P2, cls: string, extra = '') => `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="${cls}" ${extra}/>`;

function label(x: number, y: number, title: string, value: string, anchor: 'start' | 'end' = 'start') {
  return `<g class="fig-label"><text x="${x}" y="${y}" text-anchor="${anchor}" class="fig-k">${esc(title.toUpperCase())}</text><text x="${x}" y="${y + 25}" text-anchor="${anchor}" class="fig-v" dy="0">${esc(value)}</text></g>`;
}

const LIMBS: [number, number][] = [[11, 13], [13, 15], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31]];
const mirror = (i: number) => (i % 2 ? i + 1 : i - 1);

function body(P: (i: number) => P2, near: Side, opts: { arms?: boolean } = {}) {
  const nearOdd = near === 'L';
  const limbs = (odd: boolean, cls: string) =>
    LIMBS.filter(([a]) => opts.arms !== false || a > 16)
      .map(([a, b]) => (odd ? [a, b] : [mirror(a), mirror(b)]))
      .map(([a, b]) => line(P(a), P(b), cls, 'stroke-linecap="round"'))
      .join('');
  const sh = { x: (P(11).x + P(12).x) / 2, y: (P(11).y + P(12).y) / 2 };
  const hp = { x: (P(23).x + P(24).x) / 2, y: (P(23).y + P(24).y) / 2 };
  const head = P(0);
  const hr = Math.max(9, Math.hypot(sh.x - hp.x, sh.y - hp.y) * 0.2);
  const hc = { x: head.x + (sh.x - head.x) * 0.15, y: head.y + (sh.y - head.y) * 0.15 };
  return `
    <g class="fig-far">${limbs(!nearOdd, 'fig-limb')}</g>
    ${line(sh, hp, 'fig-torso', 'stroke-linecap="round"')}
    ${line(P(11), P(12), 'fig-limb', 'stroke-linecap="round"')}
    ${line(P(23), P(24), 'fig-limb', 'stroke-linecap="round"')}
    <circle cx="${hc.x.toFixed(1)}" cy="${hc.y.toFixed(1)}" r="${hr.toFixed(1)}" class="fig-head"/>
    <g class="fig-near">${limbs(nearOdd, 'fig-limb')}</g>
    ${[25, 27, 29, 31].map((i) => (nearOdd ? i : i + 1)).map((i) => `<circle cx="${P(i).x.toFixed(1)}" cy="${P(i).y.toFixed(1)}" r="4" class="fig-joint"/>`).join('')}`;
}

/** Side view at initial contact: tibia, knee, foot and trunk angles drawn on the body. */
export function sideFigure(pose: Pt[], side: Side, facing: 1 | -1, a: Record<string, number | null>, opts: { annotate?: boolean; title?: string } = {}) {
  const W = 480, H = 420;
  const ann0 = opts.annotate !== false;
  const BW = ann0 ? W - 150 : W;
  const P0 = fit(pose, [0, 11, 12, 15, 16, 23, 24, 27, 28, 29, 30, 31, 32], BW, H, 40, facing < 0);
  const P = (i: number) => P0(i);
  const k = side === 'L' ? 0 : 1;
  const hip = P(23 + k), knee = P(25 + k), ankle = P(27 + k), heel = P(29 + k), toe = P(31 + k);
  const ground = Math.max(P(29).y, P(30).y, P(31).y, P(32).y) + 3;
  let ann = '';
  if (opts.annotate !== false) {
    const up = -Math.PI / 2;
    const rT = Math.hypot(knee.x - ankle.x, knee.y - ankle.y) * 0.55;
    ann += line(ankle, { x: ankle.x, y: ankle.y - rT * 1.25 }, 'fig-ref');
    ann += `<path d="${arc(ankle, rT * 0.8, up, ang(ankle, knee))}" class="fig-arc"/>`;
    // knee: angle between thigh extension and shank
    const ext = { x: knee.x + (knee.x - hip.x) * 0.7, y: knee.y + (knee.y - hip.y) * 0.7 };
    ann += line(knee, ext, 'fig-ref');
    ann += `<path d="${arc(knee, 26, ang(knee, ext), ang(knee, ankle))}" class="fig-arc"/>`;
    // trunk vs vertical, through the hips
    const sh = { x: (P(11).x + P(12).x) / 2, y: (P(11).y + P(12).y) / 2 };
    const hp = { x: (P(23).x + P(24).x) / 2, y: (P(23).y + P(24).y) / 2 };
    const tl = Math.hypot(sh.x - hp.x, sh.y - hp.y);
    ann += line(hp, { x: hp.x, y: hp.y - tl }, 'fig-ref');
    ann += `<path d="${arc(hp, tl * 0.45, up, ang(hp, sh))}" class="fig-arc"/>`;
    // foot vs ground
    ann += line(heel, { x: heel.x + (toe.x > heel.x ? 1 : -1) * Math.hypot(toe.x - heel.x, toe.y - heel.y) * 1.3, y: heel.y }, 'fig-ref');
    const lx = W - 14;
    const rows: [string, string][] = [['Tronco', `${f1(a.trunk)}°`], ['Joelho', `${f1(a.knee)}°`], ['Tíbia', `${f1(a.tibia)}°`], ['Pé no contacto', `${f1(a.fsa)}°`]];
    rows.forEach(([t, v], i) => (ann += label(lx, 40 + i * 92, t, v, 'end')));
    ann += `<line x1="${BW + 8}" x2="${BW + 8}" y1="24" y2="${H - 30}" class="fig-sep"/>`;
  }
  return `<svg class="figure" viewBox="0 0 ${ann0 ? W : BW} ${H}" role="img" aria-label="${esc(opts.title ?? 'Postura no contacto inicial')}">
    <line x1="10" x2="${BW - 10}" y1="${ground}" y2="${ground}" class="fig-ground"/>
    ${body(P, side)}
    <g class="fig-ann">${ann}</g>
  </svg>`;
}

/** Rear view at mid-stance: heel angle on each foot and the pelvis line. */
export function rearFigure(pose: Pt[], a: Partial<Record<Side, number | null>>, drop: number | null, opts: { annotate?: boolean; title?: string } = {}) {
  const W = 440, H = 420;
  const P = fit(pose, [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30], W, H, 50, false);
  const ground = Math.max(P(29).y, P(30).y) + 4;
  let ann = '';
  const legs = (['L', 'R'] as Side[]).map((s) => {
    const k = s === 'L' ? 0 : 1;
    return `${line(P(23 + k), P(25 + k), 'fig-limb', 'stroke-linecap="round"')}${line(P(25 + k), P(27 + k), 'fig-limb', 'stroke-linecap="round"')}${line(P(27 + k), P(29 + k), 'fig-limb fig-heel', 'stroke-linecap="round"')}<circle cx="${P(25 + k).x}" cy="${P(25 + k).y}" r="4" class="fig-joint"/><circle cx="${P(27 + k).x}" cy="${P(27 + k).y}" r="4" class="fig-joint"/>`;
  });
  if (opts.annotate !== false) {
    for (const s of ['L', 'R'] as Side[]) {
      const k = s === 'L' ? 0 : 1;
      const kn = P(25 + k), an = P(27 + k), he = P(29 + k);
      const dx = an.x - kn.x, dy = an.y - kn.y;
      const L = Math.hypot(dx, dy) * 0.42;
      const ext = { x: an.x + (dx / Math.hypot(dx, dy)) * L, y: an.y + (dy / Math.hypot(dx, dy)) * L };
      ann += line(an, ext, 'fig-ref');
      ann += `<path d="${arc(an, Math.max(16, Math.hypot(he.x - an.x, he.y - an.y) * 0.9), ang(an, ext), ang(an, he))}" class="fig-arc"/>`;
      const left = an.x < W / 2;
      ann += label(left ? 12 : W - 12, ground - 64, `Pé ${s === 'L' ? 'esq.' : 'dir.'}`, `${f1(a[s])}°`, left ? 'start' : 'end');
    }
    const hl = P(23), hr = P(24);
    ann += line({ x: hl.x - 26, y: (hl.y + hr.y) / 2 }, { x: hr.x + 26, y: (hl.y + hr.y) / 2 }, 'fig-ref');
    ann += label(W - 12, 30, 'Queda da anca', `${f1(drop)}°`, 'end');
  }
  const sh = { x: (P(11).x + P(12).x) / 2, y: (P(11).y + P(12).y) / 2 };
  const hp = { x: (P(23).x + P(24).x) / 2, y: (P(23).y + P(24).y) / 2 };
  const hr = Math.max(10, Math.hypot(sh.x - hp.x, sh.y - hp.y) * 0.2);
  return `<svg class="figure" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title ?? 'Pernas vistas de trás a meio do apoio')}">
    <line x1="10" x2="${W - 10}" y1="${ground}" y2="${ground}" class="fig-ground"/>
    ${line(sh, hp, 'fig-torso', 'stroke-linecap="round"')}
    ${line(P(11), P(12), 'fig-limb', 'stroke-linecap="round"')}
    ${line(P(23), P(24), 'fig-limb', 'stroke-linecap="round"')}
    <circle cx="${sh.x}" cy="${sh.y - hr * 1.6}" r="${hr}" class="fig-head"/>
    ${legs.join('')}
    <g class="fig-ann">${ann}</g>
  </svg>`;
}

/** Range bar: the reference band, the measured value and, when bilateral, each foot. */
export function rangeBar(m: Metric) {
  if (!m.range || m.value == null) return '';
  const { min, max, band } = m.range;
  const W = 300, H = 40, pad = 6;
  const x = (v: number) => pad + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (W - 2 * pad);
  const b0 = x(band[0]), b1 = x(band[1]);
  const sides = (['L', 'R'] as Side[])
    .map((s) => (m.bySide?.[s] != null ? `<line x1="${x(m.bySide[s]!)}" x2="${x(m.bySide[s]!)}" y1="12" y2="24" class="rb-side"/>` : ''))
    .join('');
  const out = m.value < min || m.value > max;
  return `<svg class="rangebar" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${m.label}: ${f1(m.value)} ${m.unit}, referência ${f1(band[0])} a ${f1(band[1])}`)}">
    <rect x="${pad}" y="15" width="${W - 2 * pad}" height="6" rx="3" class="rb-track"/>
    <rect x="${b0}" y="15" width="${Math.max(2, b1 - b0)}" height="6" rx="3" class="rb-band"/>
    ${sides}
    <circle cx="${x(m.value)}" cy="18" r="6.5" class="rb-dot${out ? ' out' : ''}"/>
    <text x="${pad}" y="38" class="rb-t">${f1(min)}</text>
    <text x="${(b0 + b1) / 2}" y="38" text-anchor="middle" class="rb-t rb-mid">${esc(m.range.bandLabel ?? `${f1(band[0])} a ${f1(band[1])}`)}</text>
    <text x="${W - pad}" y="38" text-anchor="end" class="rb-t">${f1(max)}</text>
  </svg>`;
}
