// Sagittal (side view) analysis: foot strike, overstride, knee, trunk, bounce, cadence.

import { Frame, Metric, Side, SideViewResult, StrikeStep, Subject } from './types';
import { cadenceMetric, kneeFlex, level, prepare, quality, typical } from './common';
import { deg, median, meanCurve, normalise, round } from './signal';
import { visibility } from './tracks';

/** Foot-strike angle thresholds (Altman & Davis 2012, calibrated to the flat foot). */
export const STRIKE = { rear: 8, fore: -1.6 };

export function classifyStrike(a: number): StrikeStep['type'] {
  if (a > STRIKE.rear) return 'rearfoot';
  if (a < STRIKE.fore) return 'forefoot';
  return 'midfoot';
}

export const STRIKE_PT: Record<StrikeStep['type'], string> = {
  rearfoot: 'Calcanhar',
  midfoot: 'Médio-pé',
  forefoot: 'Antepé',
};

export function analyseSide(frames: Frame[], subject: Subject, slowMotion = 0): SideViewResult {
  const p = prepare(frames, slowMotion);
  const { tr, contacts } = p;
  const sides: Side[] = ['L', 'R'];

  // Running direction in the image: toes point forward.
  let dsum = 0;
  for (const s of sides) {
    const h = tr.get('heel', s), t = tr.get('toe', s);
    for (let i = 0; i < tr.n; i++) if (Number.isFinite(t.x[i] - h.x[i])) dsum += t.x[i] - h.x[i];
  }
  const dir = dsum >= 0 ? 1 : -1;

  // Which legs can we trust? The far leg is partly hidden in a side view.
  const footVis: Record<Side, number> = {
    L: visibility(tr, ['ankle', 'heel', 'toe'], 'L'),
    R: visibility(tr, ['ankle', 'heel', 'toe'], 'R'),
  };
  const bestVis = Math.max(footVis.L, footVis.R);
  const trusted = sides.filter((s) => footVis[s] >= Math.max(0.5, bestVis - 0.15));
  const use = trusted.length ? trusted : [footVis.L >= footVis.R ? 'L' : 'R' as Side];

  const footAngle = (s: Side, i: number) => {
    const h = tr.get('heel', s), t = tr.get('toe', s);
    return deg(Math.atan2(h.y[i] - t.y[i], (t.x[i] - h.x[i]) * dir));
  };
  const hipMidX = (i: number) => (tr.get('hip', 'L').x[i] + tr.get('hip', 'R').x[i]) / 2;
  const hipMidY = (i: number) => (tr.get('hip', 'L').y[i] + tr.get('hip', 'R').y[i]) / 2;

  // Flat-foot offset per side: foot angle in mid-stance, where the sole is on the ground.
  const offset: Record<Side, number> = { L: 0, R: 0 };
  for (const s of sides) {
    const mids: number[] = [];
    for (const c of contacts.filter((x) => x.side === s)) {
      const a = Math.round(c.ic + (c.to - c.ic) * 0.4), b = Math.round(c.ic + (c.to - c.ic) * 0.6);
      for (let i = a; i <= b; i++) mids.push(footAngle(s, i));
    }
    const m = median(mids);
    offset[s] = Number.isFinite(m) ? Math.max(-15, Math.min(15, m)) : 0;
  }

  interface StepData {
    side: Side; ic: number; to: number;
    fsa: number; tibia: number; reach: number; kneeIc: number; kneePeak: number; contactMs: number;
  }
  const steps: StepData[] = contacts.map((c) => {
    const s = c.side;
    const k = tr.get('knee', s), a = tr.get('ankle', s), h = tr.get('heel', s);
    let kneePeak = -Infinity;
    for (let i = c.ic; i <= c.to; i++) kneePeak = Math.max(kneePeak, kneeFlex(tr, s, i));
    return {
      side: s,
      ic: c.ic,
      to: c.to,
      fsa: footAngle(s, c.ic) - offset[s],
      tibia: deg(Math.atan2((a.x[c.ic] - k.x[c.ic]) * dir, a.y[c.ic] - k.y[c.ic])),
      reach: ((h.x[c.ic] - hipMidX(c.ic)) * dir) / tr.legLen,
      kneeIc: kneeFlex(tr, s, c.ic),
      kneePeak,
      contactMs: (c.to - c.ic + 1) * p.dt * 1000,
    };
  });
  const usedSteps = steps.filter((x) => use.includes(x.side));

  const per = (f: (x: StepData) => number) => {
    const bySide: Partial<Record<Side, number | null>> = {};
    for (const s of sides) {
      const v = median(steps.filter((x) => x.side === s).map(f));
      bySide[s] = Number.isFinite(v) ? v : null;
    }
    const all = median(usedSteps.map(f));
    return { all: Number.isFinite(all) ? all : null, bySide };
  };

  // Foot strike
  const strikeSteps: StrikeStep[] = usedSteps.map((x) => ({
    side: x.side,
    t: tr.t[x.ic],
    angle: x.fsa,
    type: classifyStrike(x.fsa),
  }));
  const share = { rearfoot: 0, midfoot: 0, forefoot: 0 };
  for (const st of strikeSteps) share[st.type] += 1 / strikeSteps.length;
  const dominant = strikeSteps.length
    ? (Object.entries(share).sort((a, b) => b[1] - a[1])[0][0] as StrikeStep['type'])
    : null;

  const fsa = per((x) => x.fsa);
  const tibia = per((x) => x.tibia);
  const reach = per((x) => x.reach * 100);
  const kneeIc = per((x) => x.kneeIc);
  const kneePeak = per((x) => x.kneePeak);
  const contact = per((x) => x.contactMs);

  // Trunk lean over the whole clip.
  const lean: number[] = [];
  for (let i = 0; i < tr.n; i++) {
    const sx = (tr.get('shoulder', 'L').x[i] + tr.get('shoulder', 'R').x[i]) / 2;
    const sy = (tr.get('shoulder', 'L').y[i] + tr.get('shoulder', 'R').y[i]) / 2;
    lean.push(deg(Math.atan2((sx - hipMidX(i)) * dir, hipMidY(i) - sy)));
  }
  const trunk = median(lean);

  // Vertical oscillation of the pelvis, per step.
  const osc: number[] = [];
  const allC = contacts;
  for (let k = 1; k < allC.length; k++) {
    const a = allC[k - 1].ic, b = allC[k].ic;
    if (b - a < 3) continue;
    const ys = [];
    for (let i = a; i <= b; i++) ys.push(hipMidY(i));
    osc.push((Math.max(...ys) - Math.min(...ys)) / tr.legLen);
  }
  const oscRel = median(osc);
  const legCm = subject.heightCm ? subject.heightCm * 0.46 : null;
  const oscCm = legCm && Number.isFinite(oscRel) ? oscRel * legCm : null;

  // Knee curve over a full stride (initial contact to the next one of the same foot).
  const kneeCurve = sides.map((s) => {
    const cs = contacts.filter((x) => x.side === s);
    const curves: number[][] = [];
    for (let k = 1; k < cs.length; k++) {
      const a = cs[k - 1].ic, b = cs[k].ic;
      const vals = [];
      for (let i = a; i <= b; i++) vals.push(kneeFlex(tr, s, i));
      if (vals.every(Number.isFinite) && b - a > 4) curves.push(normalise(vals, 0, vals.length - 1));
    }
    return { side: s, mean: meanCurve(curves) };
  }).filter((c) => c.mean.length);

  const keyframes = use.flatMap((s) => {
    const st = typical(steps.filter((x) => x.side === s), (x) => x.fsa);
    return st ? [{ side: s, t: tr.t[st.ic], label: `Contacto inicial · pé ${s === 'L' ? 'esquerdo' : 'direito'}` }] : [];
  });

  const r1 = (x: number | null) => round(x, 1);
  const bySide1 = (b: Partial<Record<Side, number | null>>) => ({ L: r1(b.L ?? null), R: r1(b.R ?? null) });

  const metrics: Metric[] = [
    {
      id: 'strike',
      label: 'Tipo de apoio',
      value: r1(fsa.all),
      unit: '°',
      bySide: bySide1(fsa.bySide),
      verdict: dominant ? STRIKE_PT[dominant] : 'Sem dados',
      level: 'info',
      note: `Ângulo do pé no primeiro contacto, medido contra o pé assente. Positivo: a ponta vem levantada (calcanhar). ${
        strikeSteps.length ? `Calcanhar ${Math.round(share.rearfoot * 100)} %, médio-pé ${Math.round(share.midfoot * 100)} %, antepé ${Math.round(share.forefoot * 100)} % dos apoios.` : ''
      }`,
      reference: `Calcanhar acima de ${STRIKE.rear}°, antepé abaixo de ${STRIKE.fore}°. Nenhum é errado por si: o que pesa é onde o pé aterra.`,
    },
    cadenceMetric(p.cadence),
    {
      id: 'tibia',
      label: 'Ângulo da tíbia no contacto',
      value: r1(tibia.all),
      unit: '°',
      bySide: bySide1(tibia.bySide),
      verdict: tibia.all == null ? 'Sem dados' : tibia.all <= 8 ? 'Pé por baixo do corpo' : tibia.all <= 12 ? 'Ligeiro overstride' : 'Overstride',
      level: level(tibia.all, (x) => x <= 8, (x) => x <= 12),
      note: 'Inclinação da canela quando o pé toca no chão. Positivo: o tornozelo está à frente do joelho, o pé aterra à frente do corpo e trava.',
      reference: 'Referência: 0° a 8°. Acima de 12° é overstride claro.',
    },
    {
      id: 'reach',
      label: 'Calcanhar à frente da anca',
      value: r1(reach.all),
      unit: '% da perna',
      bySide: bySide1(reach.bySide),
      verdict: reach.all == null ? 'Sem dados' : reach.all <= 25 ? 'Curto' : reach.all <= 35 ? 'Longo' : 'Muito longo',
      level: level(reach.all, (x) => x <= 25, (x) => x <= 35),
      note: 'Distância horizontal entre o calcanhar e a anca no contacto, em percentagem do comprimento da perna.',
      reference: 'Referência: até 25 %.',
    },
    {
      id: 'kneeIc',
      label: 'Joelho no contacto',
      value: r1(kneeIc.all),
      unit: '° de flexão',
      bySide: bySide1(kneeIc.bySide),
      verdict: kneeIc.all == null ? 'Sem dados' : kneeIc.all < 10 ? 'Em extensão' : kneeIc.all < 15 ? 'Pouco fletido' : kneeIc.all <= 30 ? 'Fletido' : 'Muito fletido',
      level: level(kneeIc.all, (x) => x >= 15 && x <= 30, (x) => x >= 10),
      note: 'Flexão do joelho no primeiro contacto. Joelho esticado à chegada passa o impacto direto para a articulação.',
      reference: 'Referência: 15° a 30°.',
    },
    {
      id: 'kneePeak',
      label: 'Flexão máxima do joelho no apoio',
      value: r1(kneePeak.all),
      unit: '°',
      bySide: bySide1(kneePeak.bySide),
      verdict: kneePeak.all == null ? 'Sem dados' : kneePeak.all < 35 ? 'Rígido' : kneePeak.all <= 52 ? 'Normal' : 'Afundado',
      level: level(kneePeak.all, (x) => x >= 35 && x <= 52, (x) => x >= 30 && x <= 58),
      note: 'Quanto o joelho dobra a meio do apoio, a absorver a carga.',
      reference: 'Referência: 35° a 52°.',
    },
    {
      id: 'trunk',
      label: 'Inclinação do tronco',
      value: r1(trunk),
      unit: '°',
      verdict: !Number.isFinite(trunk) ? 'Sem dados' : trunk < 3 ? 'Direito ou para trás' : trunk <= 12 ? 'Ligeiramente à frente' : 'Muito à frente',
      level: level(Number.isFinite(trunk) ? trunk : null, (x) => x >= 3 && x <= 12, (x) => x >= 0 && x <= 16),
      note: 'Ângulo entre a linha anca-ombro e a vertical. Positivo: tronco à frente.',
      reference: 'Referência: 3° a 12°, a partir dos tornozelos e não da cintura.',
    },
    oscCm != null
      ? {
          id: 'osc',
          label: 'Oscilação vertical',
          value: r1(oscCm),
          unit: 'cm',
          verdict: oscCm <= 8 ? 'Baixa' : oscCm <= 10 ? 'Moderada' : 'Alta',
          level: level(oscCm, (x) => x <= 8, (x) => x <= 10),
          note: 'Quanto a anca sobe e desce em cada passo. Estimativa a partir da altura que indicaste.',
          reference: 'Referência: 6 a 8 cm em corrida fácil.',
        }
      : {
          id: 'osc',
          label: 'Oscilação vertical',
          value: r1(Number.isFinite(oscRel) ? oscRel * 100 : null),
          unit: '% da perna',
          verdict: !Number.isFinite(oscRel) ? 'Sem dados' : oscRel <= 0.1 ? 'Baixa' : oscRel <= 0.125 ? 'Moderada' : 'Alta',
          level: level(Number.isFinite(oscRel) ? oscRel : null, (x) => x <= 0.1, (x) => x <= 0.125),
          note: 'Quanto a anca sobe e desce em cada passo, em percentagem do comprimento da perna. Indica a altura para ver em cm.',
          reference: 'Referência: até 10 % (cerca de 8 cm).',
        },
    {
      id: 'contact',
      label: 'Tempo de contacto',
      value: round(contact.all, 0),
      unit: 'ms',
      bySide: { L: round(contact.bySide.L ?? null, 0), R: round(contact.bySide.R ?? null, 0) },
      verdict: contact.all == null ? 'Sem dados' : contact.all <= 260 ? 'Curto' : contact.all <= 300 ? 'Médio' : 'Longo',
      level: 'info',
      note: `Quanto tempo o pé fica no chão. Depende muito da velocidade. Precisão de ±${Math.round(p.dt * 1000)} ms com este vídeo.`,
      reference: 'Referência: 200 a 300 ms em corrida fácil.',
    },
  ];

  const warnings: string[] = [];
  const hipRatio = tr.hipWidth / tr.legLen;
  if (hipRatio > 0.3) warnings.push('As ancas aparecem muito afastadas: este vídeo parece de frente ou de trás, não de lado.');
  if (use.length === 1) warnings.push(`Só o pé ${use[0] === 'L' ? 'esquerdo' : 'direito'} está bem visível; o outro fica tapado. Para os dois lados, grava também a passar no sentido contrário.`);

  return {
    view: 'side',
    quality: quality(p, ['hip', 'knee', 'ankle', 'heel', 'toe'], use, warnings),
    slowMotion: p.slow,
    cadence: round(p.cadence, 0),
    strike: { dominant, share, steps: strikeSteps },
    metrics,
    kneeCurve,
    keyframes,
  };
}

