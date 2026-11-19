// Runs MediaPipe Pose Landmarker over every frame of a video file, in the browser.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Frame } from './analysis/types';

const BASE = import.meta.env.BASE_URL;
let landmarker: Promise<PoseLandmarker> | null = null;

function load(): Promise<PoseLandmarker> {
  if (!landmarker) {
    landmarker = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
      const make = (delegate: 'GPU' | 'CPU') =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${BASE}mediapipe/pose_landmarker_full.task`, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        return await make('GPU');
      } catch {
        return await make('CPU');
      }
    })();
    landmarker.catch(() => (landmarker = null));
  }
  return landmarker;
}

/** Start downloading the model early, while the person fills the form. */
export const preloadPose = () => void load().catch(() => {});

export interface Extracted {
  frames: Frame[];
  width: number;
  height: number;
  duration: number;
  video: HTMLVideoElement;
}

const once = (el: HTMLMediaElement, ev: string) =>
  new Promise<void>((res, rej) => {
    const ok = () => { cleanup(); res(); };
    const ko = () => { cleanup(); rej(new Error('O browser não consegue ler este vídeo. Experimenta exportar em MP4 (H.264).')); };
    const cleanup = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', ko); };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener('error', ko, { once: true });
  });

/** Estimate the decoded frame interval by playing a moment of the clip. */
async function frameInterval(video: HTMLVideoElement): Promise<number> {
  const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback;
  if (typeof rvfc !== 'function') return 1 / 30;
  const times: number[] = [];
  await new Promise<void>((resolve) => {
    const stop = setTimeout(resolve, 1500);
    const cb = (_: number, meta: { mediaTime: number }) => {
      times.push(meta.mediaTime);
      if (times.length >= 14) { clearTimeout(stop); resolve(); return; }
      video.requestVideoFrameCallback(cb);
    };
    video.requestVideoFrameCallback(cb);
    video.playbackRate = 0.5;
    video.play().catch(() => resolve());
  });
  video.pause();
  const d = times.slice(1).map((t, i) => t - times[i]).filter((x) => x > 0.0005).sort((a, b) => a - b);
  // the smallest common gap is one frame; dropped frames only make gaps longer
  const dt = d.length ? d[Math.floor(d.length * 0.25)] : 1 / 30;
  return Math.min(1 / 15, Math.max(1 / 1000, dt));
}

/**
 * Decode the clip frame by frame (seek, wait, detect). Slower than real-time playback but
 * deterministic: no dropped frames, whatever the device.
 */
export async function extractPose(
  file: File,
  onProgress: (fraction: number) => void,
  opts: { maxSeconds?: number; signal?: AbortSignal; onFrame?: (video: HTMLVideoElement, frame: Frame, index: number) => void } = {},
): Promise<Extracted> {
  const pose = await load();
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = URL.createObjectURL(file);
  await once(video, 'loadeddata');

  const dt = await frameInterval(video);
  const duration = video.duration;
  const maxSeconds = opts.maxSeconds ?? 20;
  // a long clip: analyse its middle (the steadiest part of a treadmill run)
  const span = Math.min(duration, maxSeconds);
  const start = Math.max(0, (duration - span) / 2);
  const end = start + span;
  const frames: Frame[] = [];
  const W = video.videoWidth, H = video.videoHeight;

  let ts = 0;
  for (let t = start + dt / 2; t < end; t += dt) {
    if (opts.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    video.currentTime = t;
    await once(video, 'seeked');
    ts += Math.max(1, Math.round(dt * 1000));
    const res = pose.detectForVideo(video, ts);
    const lm = res.landmarks?.[0];
    const wl = res.worldLandmarks?.[0];
    const frame: Frame = {
      t: video.currentTime,
      lm: lm ? lm.map((p) => ({ x: p.x * W, y: p.y * H, v: p.visibility ?? 1 })) : null,
      w: wl ? wl.map((p, i) => ({ x: p.x, y: p.y, z: p.z, v: lm?.[i]?.visibility ?? 1 })) : null,
    };
    frames.push(frame);
    onProgress((t - start) / span);
    opts.onFrame?.(video, frame, frames.length);
  }
  onProgress(1);
  return { frames, width: W, height: H, duration, video };
}

/** Draw one frame of the clip with the skeleton over it, as a JPEG data URL. */
export async function snapshot(video: HTMLVideoElement, t: number, frames: Frame[], highlight: 'L' | 'R' | null): Promise<string> {
  video.currentTime = t;
  await once(video, 'seeked');
  const W = video.videoWidth, H = video.videoHeight;
  const scale = Math.min(1, 900 / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const g = c.getContext('2d')!;
  g.filter = 'grayscale(1) contrast(1.05)';
  g.drawImage(video, 0, 0, c.width, c.height);
  g.filter = 'none';

  let f = frames[0];
  for (const fr of frames) if (Math.abs(fr.t - t) < Math.abs(f.t - t)) f = fr;
  if (f?.lm) drawSkeleton(g, f.lm, scale, highlight, c.width);
  return c.toDataURL('image/jpeg', 0.85);
}

/** Draw the detected skeleton over a canvas that holds the frame. */
export function drawSkeleton(g: CanvasRenderingContext2D, lm: Frame['lm'], scale: number, highlight: 'L' | 'R' | null, width: number) {
  if (!lm) return;
  {
    const f = { lm };
    const c = { width };
    const P = (i: number) => [f.lm![i].x * scale, f.lm![i].y * scale] as const;
    const bones: [number, number, 'L' | 'R' | 'C'][] = [
      [11, 12, 'C'], [23, 24, 'C'], [11, 23, 'L'], [12, 24, 'R'],
      [23, 25, 'L'], [25, 27, 'L'], [27, 29, 'L'], [29, 31, 'L'], [27, 31, 'L'],
      [24, 26, 'R'], [26, 28, 'R'], [28, 30, 'R'], [30, 32, 'R'], [28, 32, 'R'],
    ];
    g.lineCap = 'round';
    const lw = Math.max(2, c.width / 260);
    for (const [a, b, s] of bones) {
      const hot = s === highlight || (!highlight && s !== 'C');
      g.strokeStyle = hot ? '#ffffff' : 'rgba(244,244,245,0.55)';
      g.lineWidth = hot ? lw * 1.6 : lw;
      g.beginPath();
      g.moveTo(...P(a));
      g.lineTo(...P(b));
      g.stroke();
    }
    for (const i of [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) {
      const [x, y] = P(i);
      g.fillStyle = '#0b0b0c';
      g.beginPath(); g.arc(x, y, lw * 1.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = highlight && (i % 2 === 1) === (highlight === 'L') ? '#ffffff' : '#8a8a8e';
      g.beginPath(); g.arc(x, y, lw, 0, Math.PI * 2); g.fill();
    }
  }
}
