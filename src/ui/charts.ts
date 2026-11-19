// Small hand-built SVG charts. Two series at most (left/right foot): solid vs dashed lines,
// filled vs hollow dots, always with a legend and direct labels, never colour alone.

import type { Curve, StrikeStep } from '../analysis/types';
import { STRIKE } from '../analysis/side';
import { PRONATION } from '../analysis/rear';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');
const SIDE = { L: 'Esquerdo', R: 'Direito' } as const;

export function legend(): string {
  return `<div class="legend" aria-hidden="true">
    <span><svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke="currentColor" stroke-width="2"/><circle cx="11" cy="5" r="4" fill="currentColor"/></svg>Pé esquerdo</span>
    <span><svg width="22" height="10"><line x1="1" y1="5" x2="21" y2="5" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/><circle cx="11" cy="5" r="3.5" fill="var(--surface-default)" stroke="currentColor" stroke-width="1.5"/></svg>Pé direito</span>
  </div>`;
}

/** Foot-strike angle of every step on one axis, with the three zones labelled. */
export function strikeStrip(steps: StrikeStep[]): string {
  const W = 640, H = 120, pad = 16;
  const lo = Math.min(-15, ...steps.map((s) => s.angle)) - 2;
  const hi = Math.max(25, ...steps.map((s) => s.angle)) + 2;
  const x = (v: number) => pad + ((v - lo) / (hi - lo)) * (W - 2 * pad);
  const xr = x(STRIKE.rear), xf = x(STRIKE.fore);
  const jitter = (i: number) => ((i * 37) % 11) - 5;
  const dots = steps
    .map((s, i) => {
      const cy = (s.side === 'L' ? 50 : 76) + jitter(i) * 0.8;
      const tip = `${SIDE[s.side]} · ${fmt(s.angle)}° · ${s.t.toFixed(2).replace('.', ',')} s`;
      return s.side === 'L'
        ? `<circle cx="${x(s.angle)}" cy="${cy}" r="5" fill="currentColor" data-tip="${esc(tip)}"><title>${esc(tip)}</title></circle>`
        : `<circle cx="${x(s.angle)}" cy="${cy}" r="4.5" fill="var(--surface-default)" stroke="currentColor" stroke-width="1.6" data-tip="${esc(tip)}"><title>${esc(tip)}</title></circle>`;
    })
    .join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ângulo do pé no contacto em cada passo">
    <rect x="${pad}" y="34" width="${xf - pad}" height="56" rx="10" fill="currentColor" fill-opacity=".05"/>
    <rect x="${xf + 2}" y="34" width="${xr - xf - 4}" height="56" rx="10" fill="currentColor" fill-opacity=".1"/>
    <rect x="${xr}" y="34" width="${W - pad - xr}" height="56" rx="10" fill="currentColor" fill-opacity=".05"/>
    <text x="${pad + 8}" y="24">ANTEPÉ</text>
    <text x="${(xf + xr) / 2}" y="24" text-anchor="middle">MÉDIO-PÉ</text>
    <text x="${W - pad - 8}" y="24" text-anchor="end">CALCANHAR</text>
    <line class="axis" x1="${pad}" x2="${W - pad}" y1="98" y2="98"/>
    ${[-10, 0, 10, 20].filter((v) => v > lo && v < hi).map((v) => `<text x="${x(v)}" y="114" text-anchor="middle">${v}°</text>`).join('')}
    ${dots}
  </svg></div>`;
}

/** Mean curve per side over 0–100 % of a window, optional reference band. */
export function curveChart(
  curves: Curve[],
  opts: { label: string; xLabel: string; band?: [number, number]; bandLabel?: string; marks?: { at: number; label: string }[] },
): string {
  if (!curves.length) return '';
  const W = 640, H = 260, l = 44, r = 16, t = 16, b = 34;
  const all = curves.flatMap((c) => c.mean).filter(Number.isFinite);
  let lo = Math.min(...all, opts.band?.[0] ?? Infinity), hi = Math.max(...all, opts.band?.[1] ?? -Infinity);
  const padv = (hi - lo) * 0.12 || 5;
  lo -= padv; hi += padv;
  const step = hi - lo > 60 ? 20 : hi - lo > 24 ? 10 : 5;
  const x = (p: number) => l + (p / 100) * (W - l - r);
  const y = (v: number) => t + (1 - (v - lo) / (hi - lo)) * (H - t - b);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const path = (c: Curve) => c.mean.map((v, i) => `${i ? 'L' : 'M'}${x((i / (c.mean.length - 1)) * 100).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const ends = curves.map((c) => y(c.mean[c.mean.length - 1]) - 8);
  if (ends.length === 2 && Math.abs(ends[0] - ends[1]) < 14) {
    const mid = (ends[0] + ends[1]) / 2;
    ends[0] = mid - 7; ends[1] = mid + 7;
  }
  const lines = curves
    .map((c, k) => `<path d="${path(c)}" fill="none" stroke="currentColor" stroke-width="2" ${c.side === 'R' ? 'stroke-dasharray="6 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>
      <text x="${W - r - 4}" y="${ends[k]}" text-anchor="end">${SIDE[c.side].toUpperCase()}</text>`)
    .join('');
  const hover = curves[0].mean
    .map((_, i, arr) => {
      const p = (i / (arr.length - 1)) * 100;
      const vals = curves.map((c) => `${SIDE[c.side]} ${fmt(c.mean[i])}°`).join(' · ');
      const tip = `${Math.round(p)} % · ${vals}`;
      return i % 2 === 0 ? `<rect x="${x(p) - 6}" y="${t}" width="12" height="${H - t - b}" fill="transparent" data-tip="${esc(tip)}"/>` : '';
    })
    .join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">
    ${ticks.map((v) => `<line class="grid-l" x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l - 8}" y="${y(v) + 4}" text-anchor="end">${v}°</text>`).join('')}
    ${opts.band ? `<rect x="${l}" y="${y(opts.band[1])}" width="${W - l - r}" height="${y(opts.band[0]) - y(opts.band[1])}" fill="currentColor" fill-opacity=".08"/><text x="${l + 8}" y="${y(opts.band[1]) + 14}">${esc(opts.bandLabel ?? '')}</text>` : ''}
    ${(opts.marks ?? []).map((m) => `<line x1="${x(m.at)}" x2="${x(m.at)}" y1="${t}" y2="${H - b}" stroke="currentColor" stroke-opacity=".3" stroke-dasharray="2 4"/><text x="${x(m.at) + 6}" y="${t + 12}">${esc(m.label)}</text>`).join('')}
    <line class="axis" x1="${l}" x2="${W - r}" y1="${H - b}" y2="${H - b}"/>
    ${[0, 25, 50, 75, 100].map((p) => `<text x="${x(p)}" y="${H - b + 18}" text-anchor="middle">${p} %</text>`).join('')}
    <text x="${W - r}" y="${H - 2}" text-anchor="end">${esc(opts.xLabel)}</text>
    ${lines}${hover}
  </svg></div>${legend()}`;
}

export const pronationBand: [number, number] = [PRONATION.low, PRONATION.high];

/** One tooltip for every [data-tip] inside a root. */
export function attachTooltips(root: HTMLElement) {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  root.style.position = 'relative';
  root.appendChild(tip);
  root.addEventListener('pointermove', (e) => {
    const el = (e.target as Element).closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    const rb = root.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    tip.textContent = el.getAttribute('data-tip');
    tip.style.left = `${eb.left + eb.width / 2 - rb.left}px`;
    tip.style.top = `${eb.top - rb.top}px`;
    tip.hidden = false;
  });
  root.addEventListener('pointerleave', () => (tip.hidden = true));
}
