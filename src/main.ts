import './styles/tokens.css';
import './styles/app.css';
import { drawSkeleton, extractPose, preloadPose, snapshot, type Extracted } from './pose';
import { analyseSide } from './analysis/side';
import { analyseRear } from './analysis/rear';
import { synthRear, synthSide, withWorld } from './analysis/synth';
import type { Frame, RearViewResult, SideViewResult, Subject, View } from './analysis/types';
import { renderReport, type ReportInput } from './ui/report';
import { attachTooltips } from './ui/charts';
import { buildRunnerGlb, loadModelViewer, runnerViewer } from './ui/runner3d';
import { rearFigure, sideFigure } from './ui/figures';

interface Replay { frames: Frame[]; t0?: number; t1?: number; slow: number }
let replay: Replay | null = null;

/** Loop of whole strides: from one initial contact to the 3rd one after it. */
function loopWindow(times: number[]): { t0?: number; t1?: number } {
  if (times.length < 3) return {};
  const k = Math.min(3, times.length - 1);
  const start = Math.max(0, Math.floor((times.length - 1 - k) / 2));
  return { t0: times[start], t1: times[start + k] };
}

// ---------- the runner illustrations ----------
const demoSide = synthSide({ strikeDeg: 12, cadence: 172 });
const demoRear = synthRear({ eversionDeg: 7, cadence: 172 });
(function illustrate() {
  const s = demoSide[Math.round(120 / 172 * 60 * 0.02)]?.lm;
  const r = demoRear[Math.round(120 / 172 * 60 * 0.15)]?.lm;
  const sideIll = document.querySelector('.drop[data-view="side"] [data-ill]');
  const rearIll = document.querySelector('.drop[data-view="rear"] [data-ill]');
  if (s && sideIll) sideIll.innerHTML = sideFigure(s, 'L', 1, {}, { annotate: false, title: 'Corredor visto de lado' });
  if (r && rearIll) rearIll.innerHTML = rearFigure(r, {}, null, { annotate: false, title: 'Corredor visto de trás' });
})();

// ---------- hero mannequin ----------
function mountHero() {
  const host = document.querySelector<HTMLElement>('[data-hero]');
  if (!host) return;
  const frames = withWorld(synthSide({ strikeDeg: 10, cadence: 176, seconds: 3, fps: 60 }));
  const stride = 120 / 176;
  const glb = buildRunnerGlb(frames, { t0: 0.5, t1: 0.5 + 2 * stride });
  if (!glb) return;
  const v = runnerViewer(glb, { label: 'Boneco 3D a correr', orbit: '40deg 80deg auto', autoRotate: true, controls: false });
  host.appendChild(v);
}
const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 600));
if (!matchMedia('(max-width: 720px)').matches) idle(() => { mountHero(); });

function mountReplay(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>('[data-replay]');
  if (!stage || !replay) return;
  const glb = buildRunnerGlb(replay.frames, replay);
  if (!glb) return;
  stage.querySelector('.stage-empty')?.remove();
  const v = runnerViewer(glb, { label: 'Réplica 3D da tua corrida', orbit: '35deg 78deg auto' }) as HTMLElement & { timeScale: number };
  stage.prepend(v);
  stage.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b) return;
    b.parentElement!.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (b.dataset.speed) v.timeScale = parseFloat(b.dataset.speed);
    if (b.dataset.orbit) v.setAttribute('camera-orbit', b.dataset.orbit);
  });
}

const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector(s) as T;
const files: Partial<Record<View, File>> = {};
let abort: AbortController | null = null;
let last: ReportInput | null = null;

// ---------- uploads ----------
document.querySelectorAll<HTMLLabelElement>('.drop').forEach((drop) => {
  const view = drop.dataset.view as View;
  const input = $<HTMLInputElement>('input', drop);
  const ill = $('[data-ill]', drop);
  const status = $('[data-status]', drop);
  const clear = $<HTMLButtonElement>('.clear', drop);

  const set = (f: File | null) => {
    if (f && !f.type.startsWith('video/') && !/\.(mov|mp4|m4v|webm)$/i.test(f.name)) {
      showError('Esse ficheiro não parece um vídeo. Usa MP4 ou MOV.');
      return;
    }
    hideError();
    ill.querySelector('video')?.remove();
    if (f) {
      files[view] = f;
      const v = document.createElement('video');
      v.src = URL.createObjectURL(f);
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      v.autoplay = true;
      ill.replaceChildren(v);
      ill.style.height = 'auto';
      status.textContent = `${(f.size / 1e6).toFixed(1).replace('.', ',')} MB`;
      status.className = 'badge';
      drop.classList.add('has');
      clear.hidden = false;
      preloadPose();
    } else {
      delete files[view];
      input.value = '';
      status.textContent = 'Por carregar';
      status.className = 'badge dim';
      drop.classList.remove('has');
      clear.hidden = true;
      ill.innerHTML = drop.dataset.ill ?? '';
      ill.style.height = '';
    }
    $<HTMLButtonElement>('#run').disabled = !files.side && !files.rear;
  };
  drop.dataset.ill = ill.innerHTML;
  input.addEventListener('change', () => set(input.files?.[0] ?? null));
  clear.addEventListener('click', (e) => { e.preventDefault(); set(null); input.click(); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) set(f);
  });
});

function subject(): Subject {
  const n = (id: string) => {
    const v = parseFloat(($<HTMLInputElement>(id).value || '').replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  };
  return {
    name: $<HTMLInputElement>('#f-name').value.trim(),
    heightCm: n('#f-height'),
    speedKmh: n('#f-speed'),
    shoe: $<HTMLInputElement>('#f-shoe').value.trim(),
    surface: $<HTMLSelectElement>('#f-surface').value as Subject['surface'],
  };
}

// ---------- progress ----------
function setBar(key: string, f: number) {
  const bar = $(`[data-bar="${key}"]`);
  $<HTMLElement>('i', bar).style.width = `${Math.round(f * 100)}%`;
  $(`[data-pct="${key}"]`).textContent = `${Math.round(f * 100)} %`;
  document.querySelectorAll('.bar').forEach((b) => b.classList.remove('active'));
  if (f < 1) bar.classList.add('active');
}
const msg = (s: string) => ($('#msg').textContent = s);
function showError(s: string) { const e = $('#error'); e.textContent = s; e.hidden = false; }
function hideError() { $('#error').hidden = true; }

// ---------- run ----------
async function run() {
  hideError();
  const subj = subject();
  const slow = parseInt($<HTMLSelectElement>('#f-slow').value, 10) || 0;
  const prog = $('#progress');
  prog.hidden = false;
  $('[data-row="side"]').hidden = !files.side;
  $('[data-row="rear"]').hidden = !files.rear;
  ['model', 'side', 'rear'].forEach((k) => setBar(k, 0));
  $<HTMLButtonElement>('#run').disabled = true;
  abort = new AbortController();

  try {
    msg('A carregar o modelo de pose (cerca de 9 MB, só da primeira vez).');
    setBar('model', 0.3);
    let side: SideViewResult | null = null, rear: RearViewResult | null = null;
    const photos: ReportInput['photos'] = [];
    const extracted: Partial<Record<View, Extracted>> = {};

    for (const view of ['side', 'rear'] as View[]) {
      const f = files[view];
      if (!f) continue;
      msg(view === 'side' ? 'A seguir o corpo no vídeo de lado, imagem a imagem.' : 'A seguir o corpo no vídeo de trás, imagem a imagem.');
      const live = $<HTMLCanvasElement>('#live');
      const ex = await extractPose(f, (p) => { setBar('model', 1); setBar(view, p); }, {
        signal: abort.signal,
        onFrame: (video, frame, i) => {
          if (i % 3) return;
          const sc = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          live.width = Math.round(video.videoWidth * sc);
          live.height = Math.round(video.videoHeight * sc);
          const g = live.getContext('2d')!;
          g.filter = 'grayscale(1) brightness(.7)';
          g.drawImage(video, 0, 0, live.width, live.height);
          g.filter = 'none';
          drawSkeleton(g, frame.lm, sc, null, live.width);
        },
      });
      extracted[view] = ex;
      if (ex.frames.filter((x) => x.lm).length < 20) throw new Error(`Não encontrei ninguém no vídeo ${view === 'side' ? 'de lado' : 'de trás'}. Confirma que o corpo inteiro está no enquadramento.`);
      if (view === 'side') side = analyseSide(ex.frames, subj, slow);
      else rear = analyseRear(ex.frames, subj, slow);
    }

    msg('A preparar as imagens, o boneco 3D e o relatório.');
    const src3d = extracted.side && side ? { ex: extracted.side, times: side.strideTimes, slow: side.slowMotion } : extracted.rear && rear ? { ex: extracted.rear, times: rear.strideTimes, slow: rear.slowMotion } : null;
    replay = src3d ? { frames: src3d.ex.frames, slow: src3d.slow, ...loopWindow(src3d.times) } : null;
    for (const [view, res] of [['side', side], ['rear', rear]] as const) {
      const ex = extracted[view];
      if (!ex || !res) continue;
      for (const k of res.keyframes) {
        try { photos.push({ src: await snapshot(ex.video, k.t, ex.frames, k.side), caption: k.label }); } catch { /* skip */ }
      }
      URL.revokeObjectURL(ex.video.src);
    }

    show({ subject: subj, side, rear, photos, date: new Date() });
  } catch (e) {
    const err = e as Error;
    if (err.name !== 'AbortError') showError(err.message || 'Algo correu mal na análise.');
  } finally {
    prog.hidden = true;
    $<HTMLButtonElement>('#run').disabled = !files.side && !files.rear;
    abort = null;
  }
}

function show(input: ReportInput) {
  last = input;
  const sec = $('#relatorio');
  sec.innerHTML = renderReport(input);
  sec.hidden = false;
  sec.querySelectorAll<HTMLElement>('.chart').forEach(attachTooltips);
  void loadModelViewer().then(() => mountReplay(sec));
  sec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

$('#relatorio').addEventListener('click', (e) => {
  const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act === 'pdf') window.print();
  if (act === 'new') { $('#relatorio').hidden = true; $('#videos').scrollIntoView(); }
  if (act === 'json' && last) {
    const { photos: _p, ...data } = last;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `steppin-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
});

// Print on paper: light theme for the PDF.
addEventListener('beforeprint', () => $('#relatorio').classList.add('paper'));
addEventListener('afterprint', () => $('#relatorio').classList.remove('paper'));

$('#run').addEventListener('click', run);
$('#cancel').addEventListener('click', () => abort?.abort());
$('#demo').addEventListener('click', () => {
  const subj: Subject = { name: 'Exemplo', heightCm: 178, speedKmh: 11.5, shoe: '', surface: 'treadmill' };
  const sf = withWorld(synthSide({ strikeDeg: 15, cadence: 158, noise: 1 }));
  const side = analyseSide(sf, subj);
  replay = { frames: sf, slow: 1, ...loopWindow(side.strideTimes) };
  show({
    subject: subj,
    side,
    rear: analyseRear(synthRear({ eversionDeg: 12, cadence: 158 }), subj),
    photos: [],
    date: new Date(),
    demo: true,
  });
});
