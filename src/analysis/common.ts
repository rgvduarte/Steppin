import { Contact, Frame, Level, Metric, Quality, Side } from './types';
import { Joint, Tracks, buildTracks, detectContacts, guessSlowMotion, rawCadence, stridePeriod, visibility } from './tracks';
import { deg, median } from './signal';

export interface Prepared {
  tr: Tracks;
  contacts: Contact[];
  slow: number;
  /** Real seconds per sample. */
  dt: number;
  cadence: number | null;
  period: number | null;
}

/** slowMotion: 0 = detect automatically, otherwise the known factor. */
export function prepare(frames: Frame[], slowMotion: number): Prepared {
  const tr = buildTracks(frames);
  const period = stridePeriod(tr);
  const contacts = period ? detectContacts(tr, period) : [];
  const raw = rawCadence(tr, contacts);
  const slow = slowMotion > 0 ? slowMotion : guessSlowMotion(raw);
  return {
    tr,
    contacts,
    slow,
    dt: 1 / (tr.fsRaw * slow),
    cadence: raw ? raw * slow : null,
    period,
  };
}

export const angleAt = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
  // interior angle at b, degrees
  const ux = ax - bx, uy = ay - by, vx = cx - bx, vy = cy - by;
  return deg(Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy));
};

/** Knee flexion: 0° = straight leg. */
export function kneeFlex(tr: Tracks, s: Side, i: number): number {
  const h = tr.get('hip', s), k = tr.get('knee', s), a = tr.get('ankle', s);
  return 180 - angleAt(h.x[i], h.y[i], k.x[i], k.y[i], a.x[i], a.y[i]);
}

export function level(v: number | null, good: (x: number) => boolean, watch: (x: number) => boolean): Level {
  if (v == null || !Number.isFinite(v)) return 'info';
  if (good(v)) return 'good';
  if (watch(v)) return 'watch';
  return 'flag';
}

export function cadenceMetric(c: number | null): Metric {
  const v = c != null ? Math.round(c) : null;
  return {
    id: 'cadence',
    label: 'Cadência',
    value: v,
    unit: 'passos/min',
    verdict: v == null ? 'Sem dados' : v >= 165 ? 'Boa' : v >= 155 ? 'Baixa' : 'Muito baixa',
    level: level(v, (x) => x >= 165, (x) => x >= 155),
    note:
      'Passos por minuto, os dois pés. Uma cadência baixa costuma vir com passadas longas e mais carga no joelho; sobe com a velocidade.',
    reference: 'Referência: 165 a 185 em corrida fácil.',
  };
}

export function quality(
  p: Prepared,
  joints: Joint[],
  sides: Side[],
  extraWarnings: string[] = [],
): Quality {
  const fpsCapture = p.tr.fsRaw * p.slow;
  const vis = Math.max(...sides.map((s) => visibility(p.tr, joints, s)));
  const steps = p.contacts.length;
  const det = p.tr.detectionRate;
  const warnings = [...extraWarnings];
  if (fpsCapture < 50) warnings.push(`Vídeo a ${Math.round(fpsCapture)} fps. O contacto do pé dura poucos centésimos: grava a 120 fps ou mais (câmara lenta) para ângulos de contacto fiáveis.`);
  if (det < 0.8) warnings.push(`Só encontrei a pessoa em ${Math.round(det * 100)} % das imagens. Corpo inteiro no enquadramento, boa luz e fundo liso ajudam.`);
  if (vis < 0.6) warnings.push('Os pés e os tornozelos estão pouco visíveis. Calções ou leggings curtas, meias de cor contrastante e luz frontal ajudam.');
  if (steps < 6) warnings.push(`Só detetei ${steps} apoios. Grava pelo menos 10 segundos de corrida estável.`);
  if (p.slow > 1) warnings.push(`O vídeo está em câmara lenta (×${p.slow}). Corrigi os tempos para o tempo real.`);

  let confidence: Quality['confidence'] = 'média';
  if (fpsCapture >= 100 && det >= 0.9 && vis >= 0.7 && steps >= 10) confidence = 'alta';
  if (fpsCapture < 25 || det < 0.6 || vis < 0.45 || steps < 4) confidence = 'baixa';

  return {
    fps: Math.round(fpsCapture),
    frames: p.tr.n,
    detectionRate: det,
    meanVisibility: vis,
    steps,
    confidence,
    warnings,
  };
}

/** The contact whose value is closest to the side's median (a typical step, not an outlier). */
export function typical<T>(items: T[], val: (x: T) => number): T | null {
  const vals = items.map(val).filter(Number.isFinite);
  if (!vals.length) return null;
  const m = median(vals);
  let best: T | null = null, bd = Infinity;
  for (const it of items) {
    const d = Math.abs(val(it) - m);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}
