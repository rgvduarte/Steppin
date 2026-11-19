import { describe, expect, it } from 'vitest';
import { analyseSide } from '../src/analysis/side';
import { analyseRear } from '../src/analysis/rear';
import { buildAdvice, headline } from '../src/analysis/advice';
import { fillGaps, lowpass, median } from '../src/analysis/signal';
import { Subject } from '../src/analysis/types';
import { synthRear, synthSide } from '../src/analysis/synth';

const subject: Subject = { name: 'Teste', heightCm: 175, speedKmh: 12, shoe: '', surface: 'treadmill' };
const metric = (ms: { id: string; value: number | null }[], id: string) => ms.find((m) => m.id === id)?.value;

describe('signal', () => {
  it('fills short gaps and leaves long ones', () => {
    expect(fillGaps([1, NaN, 3], 2)).toEqual([1, 2, 3]);
    expect(fillGaps([1, NaN, NaN, NaN, 5], 2).slice(1, 4).every(Number.isNaN)).toBe(true);
  });
  it('low-pass keeps a slow sine and removes fast noise', () => {
    const fs = 60;
    const x = Array.from({ length: 300 }, (_, i) => Math.sin((2 * Math.PI * 2 * i) / fs) + 0.3 * Math.sin((2 * Math.PI * 25 * i) / fs));
    const y = lowpass(x, fs, 6);
    const err = y.slice(30, 270).map((v, i) => Math.abs(v - Math.sin((2 * Math.PI * 2 * (i + 30)) / fs)));
    expect(median(err)).toBeLessThan(0.08);
  });
});

describe('side view', () => {
  it('finds cadence and a heel strike', () => {
    const r = analyseSide(synthSide({ strikeDeg: 16, cadence: 170 }), subject);
    expect(r.cadence).toBeGreaterThan(163);
    expect(r.cadence).toBeLessThan(177);
    expect(r.strike.dominant).toBe('rearfoot');
    expect(metric(r.metrics, 'strike')!).toBeGreaterThan(9);
    expect(r.quality.steps).toBeGreaterThan(20);
    expect(metric(r.metrics, 'trunk')!).toBeCloseTo(8, 0);
  });

  it('classifies a midfoot and a forefoot strike', () => {
    expect(analyseSide(synthSide({ strikeDeg: 3 }), subject).strike.dominant).toBe('midfoot');
    expect(analyseSide(synthSide({ strikeDeg: -12 }), subject).strike.dominant).toBe('forefoot');
  });

  it('corrects a slow-motion file to real time', () => {
    const r = analyseSide(synthSide({ fps: 240, seconds: 4, cadence: 176, timeScale: 8 }), subject);
    expect(r.slowMotion).toBe(8);
    expect(r.cadence).toBeGreaterThan(168);
    expect(r.cadence).toBeLessThan(184);
    expect(r.quality.fps).toBe(240);
  });

  it('survives landmark noise', () => {
    const r = analyseSide(synthSide({ strikeDeg: 16, noise: 2 }), subject);
    expect(r.strike.dominant).toBe('rearfoot');
    expect(r.cadence).toBeGreaterThan(160);
  });
});

describe('rear view', () => {
  it('reads neutral, overpronation and supination', () => {
    const n = analyseRear(synthRear({ eversionDeg: 7 }), subject);
    expect(n.pronation.verdict).toBe('neutral');
    expect(metric(n.metrics, 'pronation')!).toBeGreaterThan(5);
    expect(metric(n.metrics, 'pronation')!).toBeLessThan(9);
    expect(analyseRear(synthRear({ eversionDeg: 15 }), subject).pronation.verdict).toBe('overpronation');
    expect(analyseRear(synthRear({ eversionDeg: 1 }), subject).pronation.verdict).toBe('supination');
  });

  it('reports no crossover for feet under the hips', () => {
    const r = analyseRear(synthRear({}), subject);
    expect(metric(r.metrics, 'width')!).toBeGreaterThan(15);
    expect(r.quality.confidence).not.toBe('alta');
  });
});

describe('advice', () => {
  it('builds a headline and advice from both views', () => {
    const s = analyseSide(synthSide({ strikeDeg: 16 }), subject);
    const r = analyseRear(synthRear({ eversionDeg: 15 }), subject);
    expect(headline(s, r)).toMatch(/calcanhar/);
    expect(buildAdvice(s, r).some((a) => /Pronação/.test(a.title))).toBe(true);
  });
});
