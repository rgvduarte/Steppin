// Frontal (rear view) analysis: rearfoot eversion (pronation), pelvic drop, knee valgus, crossover.

import { Frame, Keyframe, Metric, RearViewResult, Side, Subject } from './types';
import { cadenceMetric, level, prepare, quality, typical } from './common';
import { deg, median, meanCurve, normalise, round } from './signal';
import { visibility } from './tracks';

/** Peak rearfoot eversion thresholds, in degrees between the heel line and the shank. */
export const PRONATION = { low: 4, high: 10, severe: 14 };

export const PRONATION_PT = {
  supination: 'Supinador',
  neutral: 'Neutro',
  overpronation: 'Pronador',
} as const;

export function classifyPronation(peak: number): RearViewResult['pronation']['verdict'] {
  if (peak < PRONATION.low) return 'supination';
  if (peak > PRONATION.high) return 'overpronation';
  return 'neutral';
}

export function analyseRear(frames: Frame[], _subject: Subject, slowMotion = 0): RearViewResult {
  const p = prepare(frames, slowMotion);
  const { tr, contacts } = p;
  const sides: Side[] = ['L', 'R'];

  // Lateral direction of each leg in the image. From behind the left hip sits on the left;
  // from the front it is mirrored. Working it out per clip handles both.
  const hipL = tr.get('hip', 'L'), hipR = tr.get('hip', 'R');
  const lr = median(hipL.x.map((x, i) => x - hipR.x[i]));
  const lat: Record<Side, number> = { L: lr >= 0 ? 1 : -1, R: lr >= 0 ? -1 : 1 };
  const facingCamera = lr > 0; // left hip on the right of the image

  const tilt = (ax: number, ay: number, bx: number, by: number) => deg(Math.atan2(bx - ax, by - ay));

  /** Rearfoot angle: heel line vs shank. Positive = heel bottom kicked out = eversion (pronation). */
  const rearfoot = (s: Side, i: number) => {
    const k = tr.get('knee', s), a = tr.get('ankle', s), h = tr.get('heel', s);
    const shank = tilt(k.x[i], k.y[i], a.x[i], a.y[i]);
    const heel = tilt(a.x[i], a.y[i], h.x[i], h.y[i]);
    return (heel - shank) * lat[s];
  };

  /** Knee frontal-plane projection angle. Positive = knee falls inwards (valgus). */
  const fppa = (s: Side, i: number) => {
    const h = tr.get('hip', s), k = tr.get('knee', s), a = tr.get('ankle', s);
    const thigh = tilt(h.x[i], h.y[i], k.x[i], k.y[i]);
    const shank = tilt(k.x[i], k.y[i], a.x[i], a.y[i]);
    return (thigh - shank) * -lat[s];
  };

  // Pelvic obliquity: positive = right hip lower. Baseline removes camera roll.
  const obliq = hipL.y.map((_, i) => deg(Math.atan2(hipR.y[i] - hipL.y[i], Math.abs(hipR.x[i] - hipL.x[i]))));
  const obBase = median(obliq);

  interface StepData { side: Side; ic: number; to: number; evIc: number; evPeak: number; evPeakAt: number; drop: number; valgus: number; width: number }
  const steps: StepData[] = contacts.map((c) => {
    const s = c.side;
    const len = c.to - c.ic;
    const at = (f: number) => Math.round(c.ic + len * f);
    let evPeak = -Infinity, evPeakAt = c.ic, drop = -Infinity, valgus = -Infinity;
    for (let i = at(0.1); i <= at(0.7); i++) {
      const e = rearfoot(s, i);
      if (e > evPeak) { evPeak = e; evPeakAt = i; }
      valgus = Math.max(valgus, fppa(s, i));
    }
    for (let i = c.ic; i <= c.to; i++) {
      const d = (obliq[i] - obBase) * (s === 'L' ? 1 : -1); // contralateral side lower
      drop = Math.max(drop, d);
    }
    const mid = at(0.4);
    const hipMidX = (hipL.x[mid] + hipR.x[mid]) / 2;
    const width = ((tr.get('ankle', s).x[mid] - hipMidX) * lat[s]) / tr.hipWidth;
    return { side: s, ic: c.ic, to: c.to, evIc: rearfoot(s, c.ic), evPeak, evPeakAt, drop, valgus, width };
  });

  const per = (f: (x: StepData) => number) => {
    const bySide: Partial<Record<Side, number | null>> = {};
    for (const s of sides) {
      const v = median(steps.filter((x) => x.side === s).map(f));
      bySide[s] = Number.isFinite(v) ? round(v, 1) : null;
    }
    const all = median(steps.map(f));
    return { all: Number.isFinite(all) ? round(all, 1) : null, bySide };
  };

  const ev = per((x) => x.evPeak);
  const evIc = per((x) => x.evIc);
  const exc = per((x) => x.evPeak - x.evIc);
  const drop = per((x) => x.drop);
  const valgus = per((x) => x.valgus);
  const width = per((x) => x.width * 100);

  // Overall pronation verdict: the more pronated side decides, since that is the one to look at.
  const sideVals = sides.map((s) => ev.bySide[s]).filter((v): v is number => v != null);
  const worst = sideVals.length ? sideVals.reduce((a, b) => (Math.abs(b - 7) > Math.abs(a - 7) ? b : a)) : null;
  const verdict = worst != null ? classifyPronation(worst) : null;

  const rearfootCurve = sides.map((s) => {
    const curves = steps
      .filter((x) => x.side === s)
      .map((x) => {
        const vals = [];
        for (let i = x.ic; i <= x.to; i++) vals.push(rearfoot(s, i));
        return vals;
      })
      .filter((v) => v.length > 3 && v.every(Number.isFinite))
      .map((v) => normalise(v, 0, v.length - 1));
    return { side: s, mean: meanCurve(curves) };
  }).filter((c) => c.mean.length);

  const keyframes: Keyframe[] = sides.flatMap((s) => {
    const st = typical(steps.filter((x) => x.side === s), (x) => x.evPeak);
    return st
      ? [{
          side: s,
          t: tr.t[st.evPeakAt],
          label: `Meio do apoio · pé ${s === 'L' ? 'esquerdo' : 'direito'}`,
          pose: frames[st.evPeakAt]?.lm ?? null,
          angles: { rearfoot: rearfoot(s, st.evPeakAt), drop: st.drop, valgus: st.valgus },
        }]
      : [];
  });
  const strideTimes = contacts.filter((c) => c.side === 'L').map((c) => tr.t[c.ic]);

  const pronLevel = (v: number | null) =>
    level(v, (x) => x >= PRONATION.low && x <= PRONATION.high, (x) => x >= 0 && x <= PRONATION.severe);

  const metrics: Metric[] = [
    {
      id: 'pronation',
      range: { min: -6, max: 20, band: [PRONATION.low, PRONATION.high], bandLabel: 'neutro' },
      label: 'Pronação do retropé',
      value: worst,
      unit: '° de eversão',
      bySide: ev.bySide,
      verdict: verdict ? PRONATION_PT[verdict] : 'Sem dados',
      level: pronLevel(worst),
      note: `Quanto o calcanhar tomba para dentro em relação à canela, no pico do apoio. Começa em ${evIc.all ?? '–'}° no contacto e roda ${exc.all ?? '–'}° até ao pico.`,
      reference: `Neutro: ${PRONATION.low}° a ${PRONATION.high}°. Abaixo de ${PRONATION.low}°, supinador (pronação insuficiente). Acima de ${PRONATION.high}°, pronador.`,
    },
    cadenceMetric(p.cadence),
    {
      id: 'drop',
      range: { min: 0, max: 14, band: [0, 5] },
      label: 'Queda da anca',
      value: drop.all,
      unit: '°',
      bySide: drop.bySide,
      verdict: drop.all == null ? 'Sem dados' : drop.all <= 5 ? 'Estável' : drop.all <= 8 ? 'Moderada' : 'Acentuada',
      level: level(drop.all, (x) => x <= 5, (x) => x <= 8),
      note: 'Quanto a anca do lado no ar desce enquanto o outro pé está no chão. Valores por lado indicam o pé de apoio. Sinal de glúteo médio fraco.',
      reference: 'Referência: até 5°. Acima de 8° está ligada a dor no joelho e na banda iliotibial.',
    },
    {
      id: 'valgus',
      range: { min: -5, max: 25, band: [-5, 8] },
      label: 'Joelho para dentro',
      value: valgus.all,
      unit: '°',
      bySide: valgus.bySide,
      verdict: valgus.all == null ? 'Sem dados' : valgus.all <= 8 ? 'Alinhado' : valgus.all <= 13 ? 'Ligeiro valgo' : 'Valgo',
      level: level(valgus.all, (x) => x <= 8, (x) => x <= 13),
      note: 'Desvio do joelho para dentro da linha anca-tornozelo, visto de trás, durante o apoio.',
      reference: 'Referência: até 8°.',
    },
    {
      id: 'width',
      range: { min: -40, max: 80, band: [15, 80] },
      label: 'Largura da passada',
      value: width.all,
      unit: '% da bacia',
      bySide: width.bySide,
      verdict: width.all == null ? 'Sem dados' : width.all < 0 ? 'Pés cruzam a linha média' : width.all < 15 ? 'Base estreita' : 'Normal',
      level: level(width.all, (x) => x >= 15, (x) => x >= 0),
      note: 'Distância do pé de apoio à linha média do corpo, em percentagem da largura da bacia. Negativo: o pé aterra do outro lado da linha (cruzamento).',
      reference: 'Referência: acima de 15 %.',
    },
  ];

  const warnings: string[] = [];
  if (tr.hipWidth / tr.legLen < 0.12) warnings.push('As ancas quase se sobrepõem: este vídeo parece de lado, não de trás.');
  if (facingCamera) warnings.push('A pessoa parece estar de frente para a câmara. Os ângulos foram calculados, mas o protocolo pede o vídeo de trás.');
  warnings.push('A pronação mede-se aqui pela linha tornozelo-calcanhar do modelo de pose, sem marcadores. Serve para triagem; confirma valores extremos com um profissional.');
  const evDiff = ev.bySide.L != null && ev.bySide.R != null ? Math.abs(ev.bySide.L - ev.bySide.R) : 0;
  if (evDiff > 5) warnings.push(`Diferença de ${round(evDiff, 1)}° entre o pé esquerdo e o direito. Pode ser real ou do ângulo da câmara: confirma que estava centrada atrás de ti.`);

  const q = quality(p, ['knee', 'ankle', 'heel'], sides.filter((s) => visibility(tr, ['heel'], s) > 0), warnings);
  if (q.confidence === 'alta') q.confidence = 'média'; // markerless pronation never earns «alta»

  return {
    view: 'rear',
    quality: q,
    slowMotion: p.slow,
    cadence: round(p.cadence, 0),
    pronation: { verdict, bySide: ev.bySide },
    metrics,
    rearfootCurve,
    keyframes,
    strideTimes,
  };
}
