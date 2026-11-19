// Turns measured findings into a short, prioritised list of things to work on.

import { Metric, RearViewResult, SideViewResult } from './types';

export interface Advice {
  priority: 1 | 2 | 3;
  title: string;
  why: string;
  how: string[];
}

const n = (v: number | null | undefined) => (v == null ? '–' : String(v).replace('.', ','));
const find = (ms: Metric[] | undefined, id: string) => ms?.find((m) => m.id === id);

export function buildAdvice(side: SideViewResult | null, rear: RearViewResult | null): Advice[] {
  const out: Advice[] = [];
  const s = side?.metrics;
  const r = rear?.metrics;

  const cadence = find(s, 'cadence') ?? find(r, 'cadence');
  const tibia = find(s, 'tibia');
  const reach = find(s, 'reach');
  const overstride = tibia?.level === 'flag' || reach?.level === 'flag' || (tibia?.level === 'watch' && reach?.level !== 'good');

  if (overstride || cadence?.level === 'flag' || cadence?.level === 'watch') {
    const target = cadence?.value ? Math.round((cadence.value * 1.07) / 2) * 2 : null;
    out.push({
      priority: overstride ? 1 : 2,
      title: overstride ? 'Aterrar com o pé mais perto do corpo' : 'Subir a cadência',
      why: overstride
        ? `O pé chega ao chão à frente do corpo (tíbia a ${n(tibia?.value)}°), o que trava cada passo e carrega o joelho e a tíbia.`
        : `A cadência de ${cadence?.value} passos/min é baixa para corrida fácil.`,
      how: [
        target ? `Sobe a cadência 5 a 10 %: corre com um metrónomo a ${target} batidas/min, 2 a 3 vezes por semana.` : 'Sobe a cadência 5 a 10 % com um metrónomo.',
        'Pensa em pousar o pé por baixo da anca, não à frente. Passos mais curtos, não mais rápidos.',
        'Drills: skipping baixo e corrida com passos curtos, 4 × 20 m antes do treino.',
      ],
    });
  }

  const strike = find(s, 'strike');
  if (side?.strike.dominant === 'rearfoot' && overstride) {
    out.push({
      priority: 2,
      title: 'Calcanhar com o pé esticado à frente',
      why: 'Atacar de calcanhar é comum e não é um problema por si. Junto com overstride, o impacto chega mais seco à perna.',
      how: [
        'Não forces a mudança para a ponta do pé. Corrige primeiro a cadência e onde o pé aterra; o ângulo de ataque baixa sozinho.',
        'Se mudares o apoio, faz a transição em 8 a 12 semanas: a carga passa do joelho para o tendão de Aquiles e para a barriga da perna.',
      ],
    });
  } else if (side?.strike.dominant === 'forefoot' && strike) {
    out.push({
      priority: 3,
      title: 'Apoio de antepé',
      why: 'Apoio na parte da frente do pé. Poupa o joelho e pede mais ao Aquiles e à barriga da perna.',
      how: ['Mantém o reforço da barriga da perna: elevações de calcanhar numa perna, 3 × 15, 3 vezes por semana.'],
    });
  }

  const kneeIc = find(s, 'kneeIc');
  if (kneeIc?.level === 'flag') {
    out.push({
      priority: 2,
      title: 'Joelho esticado no contacto',
      why: `O joelho chega ao chão quase em extensão (${n(kneeIc.value)}°), sem margem para amortecer.`,
      how: ['Os mesmos ajustes do overstride resolvem isto quase sempre: passos mais curtos, pé por baixo do corpo.'],
    });
  }

  const kneePeak = find(s, 'kneePeak');
  if (kneePeak && kneePeak.level !== 'good' && kneePeak.value != null) {
    out.push(
      kneePeak.value < 35
        ? { priority: 3, title: 'Passada rígida', why: `O joelho dobra pouco no apoio (${n(kneePeak.value)}°).`, how: ['Trabalho de força excêntrica: agachamento búlgaro lento, 3 × 8 por perna.', 'Saltos baixos e suaves no lugar, a aterrar em silêncio.'] }
        : { priority: 3, title: 'O corpo afunda no apoio', why: `O joelho dobra muito no apoio (${n(kneePeak.value)}°), sinal de pouca rigidez na perna.`, how: ['Pliometria: saltos à corda e saltos de tornozelo, 3 × 30 s.', 'Reforço de quadricípite e barriga da perna.'] },
    );
  }

  const osc = find(s, 'osc');
  if (osc?.level === 'flag' || osc?.level === 'watch') {
    out.push({
      priority: 3,
      title: 'Muito salto vertical',
      why: `A anca sobe e desce ${n(osc.value)} ${osc.unit} por passo. Energia que vai para cima e não para a frente.`,
      how: ['Pensa em correr «para a frente, não para cima». Subir a cadência costuma reduzir a oscilação.'],
    });
  }

  const trunk = find(s, 'trunk');
  if (trunk && trunk.level !== 'good' && trunk.value != null) {
    out.push({
      priority: 3,
      title: trunk.value < 3 ? 'Tronco direito ou para trás' : 'Tronco muito inclinado',
      why: `O tronco está a ${n(trunk.value)}° da vertical.`,
      how: trunk.value < 3
        ? ['Inclina ligeiramente o corpo inteiro a partir dos tornozelos, como se fosses cair para a frente.']
        : ['Inclina a partir dos tornozelos, não da cintura. Reforço do core: pranchas e dead bug, 3 × 40 s.'],
    });
  }

  const pron = rear?.pronation.verdict;
  if (pron === 'overpronation') {
    out.push({
      priority: 2,
      title: 'Pronação acentuada',
      why: `O calcanhar tomba para dentro além do normal (${n(find(r, 'pronation')?.value)}°). Pode carregar a tíbia, o joelho e a fáscia plantar.`,
      how: [
        'Reforço do pé e da anca: short foot (encurtar o arco sem dobrar os dedos), 3 × 10; elevações de calcanhar com bola entre os calcanhares.',
        'Calçado: um modelo de estabilidade é uma opção se tiveres queixas. Sem dor, o conforto ao calçar é melhor critério do que o tipo de pisada.',
      ],
    });
  } else if (pron === 'supination') {
    out.push({
      priority: 2,
      title: 'Pouca pronação (supinador)',
      why: `O calcanhar quase não roda para dentro (${n(find(r, 'pronation')?.value)}°). O pé absorve pouco o impacto e carrega a parte de fora.`,
      how: [
        'Mobilidade do tornozelo: alongamento da barriga da perna contra a parede, 3 × 30 s por perna.',
        'Calçado neutro e com amortecimento. Evita modelos de estabilidade, que travam ainda mais a pronação.',
      ],
    });
  }

  const drop = find(r, 'drop');
  const valgus = find(r, 'valgus');
  if (drop?.level === 'flag' || drop?.level === 'watch' || valgus?.level === 'flag' || valgus?.level === 'watch') {
    out.push({
      priority: drop?.level === 'flag' || valgus?.level === 'flag' ? 1 : 2,
      title: 'Controlo da anca e do joelho',
      why: [
        drop && drop.level !== 'good' ? `a anca do lado no ar cai ${n(drop.value)}°` : '',
        valgus && valgus.level !== 'good' ? `o joelho vai para dentro ${n(valgus.value)}°` : '',
      ].filter(Boolean).join(' e ').replace(/^./, (c) => c.toUpperCase()) + '. É a combinação mais ligada a dor no joelho em corredores.',
      how: [
        'Glúteo médio: ponte lateral com abdução, 3 × 10 por lado; monster walk com elástico, 3 × 15 m.',
        'Agachamento numa perna em frente ao espelho, joelho alinhado com o 2.º dedo do pé, 3 × 8.',
        '2 a 3 sessões por semana, 6 semanas, e repete a análise.',
      ],
    });
  }

  const width = find(r, 'width');
  if (width?.level === 'flag') {
    out.push({
      priority: 2,
      title: 'Os pés cruzam a linha média',
      why: 'Cada pé aterra do lado do outro, como numa corda bamba. Aumenta a carga na banda iliotibial e na tíbia.',
      how: ['Imagina uma linha no chão entre os pés e corre com um pé de cada lado dela.', 'Reforço do glúteo médio, como acima.'],
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

export function headline(side: SideViewResult | null, rear: RearViewResult | null): string {
  const bits: string[] = [];
  const strike = side?.metrics.find((m) => m.id === 'strike');
  if (strike && side?.strike.dominant) bits.push(`apoio de ${strike.verdict.toLowerCase()}`);
  const pron = rear?.metrics.find((m) => m.id === 'pronation');
  if (pron && rear?.pronation.verdict) bits.push(rear.pronation.verdict === 'neutral' ? 'pisada neutra' : pron.verdict.toLowerCase());
  const cad = side?.cadence ?? rear?.cadence;
  if (cad) bits.push(`${cad} passos por minuto`);
  if (!bits.length) return 'Sem dados suficientes para um resumo.';
  const s = bits.join(', ').replace(/, ([^,]*)$/, ' e $1');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}
