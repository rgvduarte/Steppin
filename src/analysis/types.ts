/** One pose landmark in pixel coordinates (x right, y down) with MediaPipe visibility 0–1. */
export interface Pt {
  x: number;
  y: number;
  v: number;
}

/** One analysed video frame. `lm` is null when no person was detected. */
export interface Frame {
  /** Media time in seconds, as decoded from the file (before any slow-motion correction). */
  t: number;
  lm: Pt[] | null;
  /** MediaPipe world landmarks: metres, origin between the hips, y down. */
  w?: Pt3[] | null;
}

export interface Pt3 {
  x: number;
  y: number;
  z: number;
  v: number;
}

/** A measured moment: the raw landmarks of that frame and the angles drawn on it. */
export interface Keyframe {
  side: Side;
  t: number;
  label: string;
  pose: Pt[] | null;
  angles: Record<string, number | null>;
}

export type Side = 'L' | 'R';
export type View = 'side' | 'rear';

/** MediaPipe Pose landmark indices used by the analysis. */
export const LM = {
  nose: 0,
  shoulder: { L: 11, R: 12 },
  hip: { L: 23, R: 24 },
  knee: { L: 25, R: 26 },
  ankle: { L: 27, R: 28 },
  heel: { L: 29, R: 30 },
  toe: { L: 31, R: 32 },
} as const;

export const other = (s: Side): Side => (s === 'L' ? 'R' : 'L');

/** A detected ground contact of one foot. Indices refer to the frame array. */
export interface Contact {
  side: Side;
  ic: number; // initial contact frame
  to: number; // toe-off frame (last stance frame)
}

export type Level = 'good' | 'watch' | 'flag' | 'info';

export interface Metric {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  /** Per-side values when the metric is bilateral. */
  bySide?: Partial<Record<Side, number | null>>;
  /** Short verdict shown in the badge, e.g. «Calcanhar», «Neutra». */
  verdict: string;
  level: Level;
  /** One sentence: what the number means and the reference range. */
  note: string;
  reference: string;
  /** Axis for the range bar and the band that counts as the reference. */
  range?: { min: number; max: number; band: [number, number]; bandLabel?: string };
}

export interface Quality {
  fps: number;
  frames: number;
  detectionRate: number;
  meanVisibility: number;
  steps: number;
  confidence: 'alta' | 'média' | 'baixa';
  warnings: string[];
}

export interface StrikeStep {
  side: Side;
  t: number;
  angle: number;
  type: 'rearfoot' | 'midfoot' | 'forefoot';
}

export interface Curve {
  side: Side;
  /** Mean value at 0..100 % of the normalised window. */
  mean: number[];
}

export interface SideViewResult {
  view: 'side';
  quality: Quality;
  slowMotion: number;
  cadence: number | null;
  strike: {
    dominant: 'rearfoot' | 'midfoot' | 'forefoot' | null;
    share: Record<'rearfoot' | 'midfoot' | 'forefoot', number>;
    steps: StrikeStep[];
  };
  metrics: Metric[];
  kneeCurve: Curve[];
  /** Representative initial contacts, for snapshots and annotated figures. */
  keyframes: Keyframe[];
  /** +1 when the runner moves to the right of the image. */
  facing: 1 | -1;
  /** Media times of successive initial contacts of one foot (a clean loop for the 3D replay). */
  strideTimes: number[];
}

export interface RearViewResult {
  view: 'rear';
  quality: Quality;
  slowMotion: number;
  cadence: number | null;
  pronation: {
    verdict: 'supination' | 'neutral' | 'overpronation' | null;
    bySide: Partial<Record<Side, number | null>>;
  };
  metrics: Metric[];
  rearfootCurve: Curve[];
  keyframes: Keyframe[];
  strideTimes: number[];
}

export interface Subject {
  name: string;
  heightCm: number | null;
  speedKmh: number | null;
  shoe: string;
  surface: 'treadmill' | 'overground';
}
