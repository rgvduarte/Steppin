// Copies the MediaPipe WASM runtime into public/ and downloads the pose model once,
// so the app runs fully offline from its own origin (no CDN at runtime).
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDst = join(root, 'public/mediapipe/pose_landmarker_full.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDst, { recursive: true });
  cpSync(wasmSrc, wasmDst, { recursive: true });
  console.log('[steppin] wasm runtime copied');
}

if (!existsSync(modelDst) || statSync(modelDst).size < 1_000_000) {
  mkdirSync(dirname(modelDst), { recursive: true });
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
    console.log('[steppin] pose model downloaded');
  } catch (err) {
    console.warn(`[steppin] could not download the pose model (${err.message}).`);
    console.warn(`[steppin] download it by hand from ${MODEL_URL} to ${modelDst}`);
  }
}
