import './styles/tokens.css';
import './styles/app.css';
import { extractPose, preloadPose, snapshot, type Extracted } from './pose';
import { analyseSide } from './analysis/side';
import { analyseRear } from './analysis/rear';
import { synthRear, synthSide } from './analysis/synth';
import type { RearViewResult, SideViewResult, Subject, View } from './analysis/types';
import { renderReport, type ReportInput } from './ui/report';
import { attachTooltips } from './ui/charts';

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
      const ex = await extractPose(f, (p) => { setBar('model', 1); setBar(view, p); }, { signal: abort.signal });
      extracted[view] = ex;
      if (ex.frames.filter((x) => x.lm).length < 20) throw new Error(`Não encontrei ninguém no vídeo ${view === 'side' ? 'de lado' : 'de trás'}. Confirma que o corpo inteiro está no enquadramento.`);
      if (view === 'side') side = analyseSide(ex.frames, subj, slow);
      else rear = analyseRear(ex.frames, subj, slow);
    }

    msg('A preparar as imagens e o relatório.');
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
  show({
    subject: subj,
    side: analyseSide(synthSide({ strikeDeg: 15, cadence: 158, noise: 1 }), subj),
    rear: analyseRear(synthRear({ eversionDeg: 12, cadence: 158 }), subj),
    photos: [],
    date: new Date(),
    demo: true,
  });
});
