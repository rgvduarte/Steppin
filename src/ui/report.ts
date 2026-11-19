// Renders the gait report from the analysis results.

import type { Metric, RearViewResult, SideViewResult, Subject } from '../analysis/types';
import { buildAdvice, headline } from '../analysis/advice';
import { STRIKE_PT } from '../analysis/side';
import { PRONATION_PT } from '../analysis/rear';
import { curveChart, pronationBand, strikeStrip } from './charts';

export interface ReportInput {
  subject: Subject;
  side: SideViewResult | null;
  rear: RearViewResult | null;
  photos: { src: string; caption: string }[];
  date: Date;
  demo?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? '–' : (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');
const LEVEL_WORD = { good: 'Dentro da referência', watch: 'A observar', flag: 'A trabalhar', info: 'Informativo' } as const;

function badge(m: Metric) {
  const cls = m.level === 'flag' ? 'badge gold' : m.level === 'good' || m.level === 'info' ? 'badge dim' : 'badge';
  return `<span class="${cls}">${esc(m.verdict)}</span>`;
}

function metricCard(m: Metric) {
  const sides =
    m.bySide && (m.bySide.L != null || m.bySide.R != null)
      ? `<p class="sides">ESQ. ${num(m.bySide.L)} · DIR. ${num(m.bySide.R)}</p>`
      : '';
  return `<article class="card metric">
    <div class="head"><h3>${esc(m.label)}</h3>${badge(m)}</div>
    <p class="val">${num(m.value)}<small>${esc(m.unit)}</small></p>
    ${sides}
    <p class="sub">${esc(m.note)}</p>
    <p class="src">${esc(m.reference)} <span class="sr-only">${LEVEL_WORD[m.level]}</span></p>
  </article>`;
}

function quality(label: string, q: SideViewResult['quality']) {
  return `<article class="card">
    <div class="head"><h3>${esc(label)}</h3><span class="badge ${q.confidence === 'alta' ? '' : 'dim'}">Confiança ${q.confidence}</span></div>
    <p class="sides">${q.fps} FPS · ${q.steps} APOIOS · PESSOA EM ${Math.round(q.detectionRate * 100)} % DAS IMAGENS</p>
    ${q.warnings.length ? `<ul>${q.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="sub">Sem avisos.</p>'}
  </article>`;
}

export function renderReport(r: ReportInput): string {
  const { side, rear, subject } = r;
  const advice = buildAdvice(side, rear);
  const cad = side?.cadence ?? rear?.cadence ?? null;
  const strikeM = side?.metrics.find((m) => m.id === 'strike');
  const pronM = rear?.metrics.find((m) => m.id === 'pronation');
  const tibiaM = side?.metrics.find((m) => m.id === 'tibia');
  const dropM = rear?.metrics.find((m) => m.id === 'drop');

  const date = r.date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
  const chips = [
    subject.name || 'Corredor',
    date,
    subject.surface === 'treadmill' ? 'Passadeira' : 'Exterior',
    subject.speedKmh ? `${num(subject.speedKmh)} km/h` : '',
    subject.shoe,
    r.demo ? 'Exemplo com dados sintéticos' : '',
  ].filter(Boolean);

  const stats: string[] = [];
  if (strikeM && side?.strike.dominant)
    stats.push(`<div class="stat key"><p class="v">${esc(STRIKE_PT[side.strike.dominant])}</p><p class="l">tipo de apoio, em ${Math.round(side.strike.share[side.strike.dominant] * 100)} % dos passos</p><p class="s">Ângulo ${num(strikeM.value)}° · vista lateral</p></div>`);
  if (pronM && rear?.pronation.verdict)
    stats.push(`<div class="stat ${stats.length ? "" : "key"}"><p class="v">${esc(PRONATION_PT[rear.pronation.verdict])}</p><p class="l">pisada, ${num(pronM.value)}° de eversão do calcanhar no pico</p><p class="s">Vista de trás</p></div>`);
  if (cad) stats.push(`<div class="stat"><p class="v">${cad}<small>ppm</small></p><p class="l">passos por minuto</p><p class="s">Cadência</p></div>`);
  if (tibiaM?.value != null) stats.push(`<div class="stat"><p class="v">${num(tibiaM.value)}<small>°</small></p><p class="l">${esc(tibiaM.verdict.toLowerCase())}</p><p class="s">Tíbia no contacto</p></div>`);
  else if (dropM?.value != null) stats.push(`<div class="stat"><p class="v">${num(dropM.value)}<small>°</small></p><p class="l">queda da anca, ${esc(dropM.verdict.toLowerCase())}</p><p class="s">Vista de trás</p></div>`);

  const sidePart = side
    ? `<div class="part">
        <p class="eyebrow">Vista lateral</p>
        <h3 class="display h3">Como o pé chega ao chão</h3>
        <p class="sub">${esc(side.strike.steps.length ? `${side.strike.steps.length} apoios analisados.` : 'Não encontrei apoios suficientes.')}</p>
        ${side.strike.steps.length ? `<article class="card"><div class="head"><h3>Ângulo do pé em cada apoio</h3><span class="badge dim">${side.strike.steps.length} passos</span></div>${strikeStrip(side.strike.steps)}<div class="legend" aria-hidden="true"><span><svg width="10" height="10"><circle cx="5" cy="5" r="4.5" fill="currentColor"/></svg>Pé esquerdo</span><span><svg width="10" height="10"><circle cx="5" cy="5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>Pé direito</span></div><p class="src">Ângulo do pé no primeiro contacto, contra o pé assente. Calcanhar acima de 8°, antepé abaixo de -1,6° (Altman e Davis, 2012).</p></article>` : ''}
        <div class="grid c3" style="margin-top:20px">${side.metrics.filter((m) => m.id !== 'cadence' || !rear).map(metricCard).join('')}</div>
        ${side.kneeCurve.length ? `<article class="card" style="margin-top:20px"><div class="head"><h3>Flexão do joelho ao longo da passada</h3><span class="badge dim">Média por pé</span></div>${curveChart(side.kneeCurve, { label: 'Flexão do joelho de contacto a contacto', xLabel: 'da passada', marks: [{ at: 38, label: 'fim do apoio (aprox.)' }] })}<p class="src">0 % e 100 %: o mesmo pé a tocar no chão. O primeiro pico é a absorção do impacto; o segundo, o joelho a recolher no voo.</p></article>` : ''}
      </div>`
    : '';

  const rearPart = rear
    ? `<div class="part">
        <p class="eyebrow">Vista de trás</p>
        <h3 class="display h3">Pronação e estabilidade</h3>
        <p class="sub">${rear.quality.steps} apoios analisados.</p>
        <div class="grid c3">${rear.metrics.map(metricCard).join('')}</div>
        ${rear.rearfootCurve.length ? `<article class="card" style="margin-top:20px"><div class="head"><h3>Ângulo do calcanhar durante o apoio</h3><span class="badge dim">Média por pé</span></div>${curveChart(rear.rearfootCurve, { label: 'Eversão do calcanhar durante o apoio', xLabel: 'do apoio', band: pronationBand, bandLabel: 'NEUTRO' })}<p class="src">Positivo: o calcanhar tomba para dentro (eversão, pronação). A faixa marca o intervalo neutro no pico.</p></article>` : ''}
      </div>`
    : '';

  const photos = r.photos.length
    ? `<div class="part"><p class="eyebrow">Imagens</p><h3 class="display h3">Os momentos medidos</h3><div class="photos" style="margin-top:24px">${r.photos
        .map((p) => `<figure><img src="${p.src}" alt="${esc(p.caption)}, com o esqueleto detetado"><figcaption>${esc(p.caption)}</figcaption></figure>`)
        .join('')}</div></div>`
    : '';

  const adv = advice.length
    ? `<div class="advice">${advice
        .map((a) => `<article class="card p${a.priority}"><div class="head"><h3>${esc(a.title)}</h3><span class="badge ${a.priority === 1 ? 'gold' : 'dim'}">${a.priority === 1 ? 'Prioridade' : a.priority === 2 ? 'Importante' : 'A seguir'}</span></div><p class="sub">${esc(a.why)}</p><ul>${a.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></article>`)
        .join('')}</div>`
    : `<article class="card"><h3>Nada a corrigir com urgência</h3><p class="sub">Todos os valores medidos estão dentro das referências. Mantém o reforço de força e repete a análise daqui a uns meses ou quando mudares de sapatilhas.</p></article>`;

  return `<div class="wrap">
    <div class="report-head">
      <div>
        <p class="eyebrow">03 · Relatório</p>
        <h2 class="display h2">A tua passada</h2>
      </div>
      <div class="actions no-print" style="margin:0">
        <button class="btn" type="button" data-act="pdf">Guardar em PDF</button>
        <button class="btn ghost" type="button" data-act="json">Dados em JSON</button>
        <button class="btn ghost" type="button" data-act="new">Nova análise</button>
      </div>
    </div>
    <div class="meta">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
    <p class="lead">${esc(headline(side, rear))}</p>
    <div class="stats">${stats.join('')}</div>
    <div class="part"><p class="eyebrow">O que trabalhar</p><h3 class="display h3">Por ordem de prioridade</h3><p class="sub">Uma coisa de cada vez. Mudanças de técnica levam 6 a 12 semanas.</p>${adv}</div>
    ${sidePart}
    ${rearPart}
    ${photos}
    <div class="part"><p class="eyebrow">Qualidade da análise</p><h3 class="display h3">Quanto confiar nos números</h3><p class="sub">Medido com um modelo de pose (MediaPipe) sobre vídeo 2D, sem marcadores. Bom para triagem e para comparar antes e depois.</p>
      <div class="grid c2">${side ? quality('Vídeo de lado', side.quality) : ''}${rear ? quality('Vídeo de trás', rear.quality) : ''}</div>
    </div>
    <p class="disclaimer">Este relatório não é um diagnóstico e não substitui a avaliação de um fisioterapeuta, médico ou podologista. Com dor, procura um profissional. A pronação é um movimento normal do pé; a escolha de sapatilhas pelo tipo de pisada tem pouca evidência a prevenir lesões, o conforto ao calçar é melhor critério.</p>
  </div>`;
}
