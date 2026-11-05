// Aesthetic Preview — treatment visualization with a fal.ai image-edit model.
// Plain JS, no build step. Catalog lives in data.js.

const $ = id => document.getElementById(id);
const byId = Object.fromEntries(TREATMENTS.map(t => [t.id, t]));
const catById = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

const state = {
  plan: new Map(),        // treatment id → dose (number) or level (1–3)
  cat: 'filler',
  area: 'All',
  style: 'balanced',
  photo: null,            // resized data URL
  versions: [],           // { url, plan: [[id,val]], style, prompt, time }
  current: -1,
  view: 'compare',
  promptEdited: false,
  stream: null,
  photoImg: null,         // HTMLImageElement of the original
  faceL: null,            // face landmarks of the original (pixel coords)
  face: 'none',           // none | loading | ok | missing | error
  showAreas: false,
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

/* ================= Formatting ================= */
function fmtNum(n) { return String(Math.round(n * 100) / 100); }

function doseText(t, v) {
  if (t.type === 'level') return LEVELS[v];
  return `${fmtNum(v)} ${catById[t.cat].unit}`;
}

function rangeText(t) {
  if (t.type === 'level') return 'Light · Medium · Intensive';
  const u = catById[t.cat].unit;
  return `Typical ${fmtNum(t.min)}–${fmtNum(t.max)} ${u}`;
}

/* ================= Prompt ================= */
// 0.4 … 1.0 depending on dose/level, times the result-style factor.
function strength(t, v) {
  // Dose treatments: effect grows with the actual amount (0.5 mL vs 1 mL is a clear step).
  const base = t.type === 'level'
    ? [0, 0.45, 0.72, 1][v]
    : Math.pow(v / t.max, 0.75);
  return base * STYLES.find(s => s.id === state.style).factor;
}

// k(n, cap): scale percentage n by strength, round to 5, keep within [10, cap].
function scaler(f) {
  return (n, cap = 95) => Math.max(10, Math.min(cap, Math.round((n * f) / 5) * 5));
}

const aiItems = () => CATEGORIES.flatMap(c => [...state.plan].filter(([id]) => byId[id].cat === c.id && !Warp.isShape(id)));
const shapeItems = () => [...state.plan].filter(([id]) => Warp.isShape(id));

function buildPrompt() {
  const items = aiItems();
  if (!items.length) return '';
  const lines = items.map(([id, v], i) => `${i + 1}. ${byId[id].prompt(scaler(strength(byId[id], v)))}`);
  const hasSkin = items.some(([id]) => byId[id].cat === 'skin');
  const hasShape = items.some(([id]) => byId[id].cat !== 'skin');   // botox lines etc.

  return [
    `Using the provided photo of this person, make ONLY the following ${lines.length > 1 ? lines.length + ' changes' : 'change'}. ` +
      'Each change must be clearly visible when the before and after photos are compared side by side; do not return the photo unchanged.',
    '',
    ...lines,
    '',
    ...(hasShape ? ['Do not add makeup, highlighter, contour, blush or lighting effects. Keep the skin color, brightness and lighting the same as in the original photo.', ''] : []),
    'Keep everything else exactly the same: the same person and identity, eyes, eye color, nose, mouth, hair, expression, ' +
      'head position, camera angle, framing, lighting, colors, background and clothing — except where a change above requires it.',
    hasSkin
      ? 'Keep the same skin tone, brightness, color and lighting as the original — no whitening, no shine, no oily or glossy skin. Photorealistic result with real skin texture and pores (no airbrushed or plastic look), no makeup, no filters.'
      : 'Do not retouch or smooth the skin. Photorealistic result, no makeup, no filters.',
  ].join('\n');
}

function refreshPrompt(force = false) {
  if (force || !state.promptEdited) {
    $('promptText').value = buildPrompt();
    state.promptEdited = false;
  }
  $('promptText').placeholder = shapeItems().length
    ? 'No AI needed: the selected treatments are shape changes, done by precise face reshaping (instant, free).'
    : '';
}

/* ================= Category tabs & filters ================= */
function renderTabs() {
  const wrap = $('catTabs');
  wrap.innerHTML = '';
  for (const c of CATEGORIES) {
    const count = [...state.plan.keys()].filter(id => byId[id].cat === c.id && (!state.live || Warp.isShape(id))).length;
    const b = document.createElement('button');
    b.className = 'cat-tab' + (c.id === state.cat ? ' on' : '');
    b.setAttribute('role', 'tab');
    b.innerHTML = `<span class="ic">${c.icon}</span><span class="nm">${c.short}</span>${count ? `<span class="ct">${count}</span>` : ''}`;
    b.onclick = () => { state.cat = c.id; state.area = 'All'; renderBuilder(); };
    wrap.appendChild(b);
  }
  $('catBlurb').textContent = catById[state.cat].name + ' — ' + catById[state.cat].blurb;
}

function renderAreaFilter() {
  const areas = ['All', ...new Set(TREATMENTS.filter(t => t.cat === state.cat && (!state.live || Warp.isShape(t.id))).map(t => t.area))];
  const wrap = $('areaFilter');
  wrap.innerHTML = '';
  if (areas.length <= 2) return;
  for (const a of areas) {
    const b = document.createElement('button');
    b.className = 'chip' + (a === state.area ? ' on' : '');
    b.textContent = a;
    b.onclick = () => { state.area = a; renderAreaFilter(); renderGrid(); };
    wrap.appendChild(b);
  }
}

/* ================= Treatment cards ================= */
function renderGrid() {
  const grid = $('treatGrid');
  grid.innerHTML = '';
  const list = TREATMENTS.filter(t => t.cat === state.cat && (state.area === 'All' || t.area === state.area)
    && (!state.live || Warp.isShape(t.id)));                 // Live: only treatments that run without AI
  for (const t of list) grid.appendChild(card(t));
}

function card(t) {
  const on = state.plan.has(t.id);
  const el = document.createElement('div');
  el.className = 't-card' + (on ? ' on' : '');
  el.innerHTML = `
    <div class="t-top"><span class="t-name">${t.name}</span><span class="t-check">${on ? '✓' : ''}</span></div>
    <span class="t-desc">${t.desc}</span>
    <span class="t-range">${rangeText(t)} · ${Warp.isFilter(t.id) ? 'filter · no AI' : Warp.isShape(t.id) ? 'reshape · no AI' : 'AI'}</span>`;
  if (on) {
    el.querySelector('.t-top').onclick = () => toggle(t.id);
    el.querySelector('.t-check').title = 'Remove';
  } else {
    el.onclick = () => toggle(t.id);
  }

  if (on) {
    const v = state.plan.get(t.id);
    const ctrl = document.createElement('div');
    if (t.type === 'dose') {
      ctrl.className = 'ctrl';
      ctrl.innerHTML = `<button aria-label="Less">−</button><span class="val">${doseText(t, v)}</span><button aria-label="More">+</button>`;
      const [minus, , plus] = ctrl.children;
      minus.onclick = e => { e.stopPropagation(); setVal(t.id, Math.max(t.min, round(v - t.step))); };
      plus.onclick = e => { e.stopPropagation(); setVal(t.id, Math.min(t.max, round(v + t.step))); };
    } else {
      ctrl.className = 'lvl';
      for (let i = 1; i <= 3; i++) {
        const b = document.createElement('button');
        b.textContent = LEVELS[i];
        if (i === v) b.className = 'on';
        b.onclick = e => { e.stopPropagation(); setVal(t.id, i); };
        ctrl.appendChild(b);
      }
    }
    ctrl.addEventListener('click', e => e.stopPropagation());
    el.appendChild(ctrl);
  }
  return el;
}

const round = n => Math.round(n * 100) / 100;

function toggle(id) {
  if (state.plan.has(id)) state.plan.delete(id);
  else state.plan.set(id, byId[id].def);
  changed();
}
function setVal(id, v) { state.plan.set(id, v); changed(); }

function renderBuilder() { renderTabs(); renderAreaFilter(); renderGrid(); }

/* ================= Plan panel ================= */
function renderPlan() {
  const wrap = $('planList');
  wrap.innerHTML = '';
  for (const c of CATEGORIES) {
    const items = [...state.plan].filter(([id]) => byId[id].cat === c.id && (!state.live || Warp.isShape(id)));
    if (!items.length) continue;
    const g = document.createElement('div');
    g.className = 'plan-group';
    g.innerHTML = `<h3>${c.icon} ${c.name}</h3>`;
    for (const [id, v] of items) {
      const t = byId[id];
      const row = document.createElement('div');
      row.className = 'plan-item';
      row.innerHTML = `<span class="pi-name">${t.name} <span class="pi-area">· ${t.area}</span></span>
        <span class="pi-dose">${doseText(t, v)}</span><button class="x" aria-label="Remove ${t.name}">×</button>`;
      row.querySelector('.x').onclick = () => { state.plan.delete(id); changed(); };
      g.appendChild(row);
    }
    wrap.appendChild(g);
  }
  $('planEmpty').hidden = state.plan.size > 0;

  const sum = cat => [...state.plan].filter(([id]) => byId[id].cat === cat).reduce((s, [, v]) => s + v, 0);
  $('totFiller').textContent = `${fmtNum(sum('filler'))} mL`;
  $('totBotox').textContent = `${fmtNum(sum('botox'))} U`;
  $('totCount').textContent = state.plan.size;
}

function renderStyles() {
  const seg = $('styleSeg');
  seg.innerHTML = '';
  for (const s of STYLES) {
    const b = document.createElement('button');
    b.textContent = s.name;
    if (s.id === state.style) b.className = 'on';
    b.onclick = () => { state.style = s.id; renderStyles(); refreshPrompt(); };
    seg.appendChild(b);
  }
  $('styleHint').textContent = STYLES.find(s => s.id === state.style).hint;
}

function changed() {
  if (state.live) liveStatus('ok');
  renderBuilder();
  renderPlan();
  refreshPrompt();
  updateUI();
  if (state.showAreas) renderAreas();
}

/* ================= Steps / apply state ================= */
function updateUI() {
  const step = !state.photo ? 1 : state.versions.length ? 3 : 2;
  [1, 2, 3].forEach(i => {
    const li = $('step' + i);
    li.classList.toggle('active', i === step);
    li.classList.toggle('done', i < step);
  });

  const needAI = aiItems().length > 0, needFace = shapeItems().length > 0 || (needAI && protectOn());
  const hasPrompt = $('promptText').value.trim().length > 0;
  const key = store.get('fal_key');
  $('applyBtn').disabled = !(state.photo && state.plan.size && (!needAI || hasPrompt) && (!needFace || state.face === 'ok'));
  $('applyHint').textContent =
    !state.photo ? 'Add a client photo to start.' :
    !state.plan.size ? 'Select at least one treatment.' :
    needFace && state.face === 'loading' ? 'Mapping the face… one moment.' :
    needFace && state.face !== 'ok' ? 'Face not mapped — use a clear, front-facing photo.' :
    needAI && !key ? 'Add your fal API key in ⚙ Settings (needed for skin & line treatments).' :
    !needAI ? 'Shape treatments only — no AI needed, instant and free.' : '';
  $('areasBtn').disabled = !(state.face === 'ok' && state.plan.size);
  $('applyBtn').textContent = state.versions.length ? '✨ Generate new version' : '✨ Generate preview';
}

function showError(msg) { $('error').textContent = msg || ''; $('error').hidden = !msg; }
function setLoading(text) { $('loading').hidden = !text; if (text) $('loadingText').textContent = text; }

/* ================= Photo: upload / camera ================= */
function resizeToDataURL(source, w, h, maxSide = 1280) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = $('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92);
}

function setPhoto(dataUrl) {
  state.photo = dataUrl;
  state.versions = []; state.current = -1;
  $('placeholder').hidden = true;
  $('compare').hidden = true;
  $('singleImg').src = dataUrl; $('singleImg').hidden = false;
  ['downloadBtn', 'printBtn', 'viewToggle', 'historyWrap'].forEach(id => $(id).hidden = true);
  $('resetBtn').hidden = false;
  showError('');
  renderHistory();
  setAreas(false);
  updateUI();
  mapFace(dataUrl);
}

/* ================= Face mapping ================= */
const protectOn = () => $('protectToggle').checked;

function loadImage(src, cors = false) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

function setFaceStatus(kind, text) {
  state.face = kind;
  const el = $('faceStatus');
  el.hidden = !text;
  el.className = 'face-status' + (kind === 'ok' ? ' ok' : kind === 'missing' || kind === 'error' ? ' warn' : '');
  el.textContent = text || '';
  updateUI();
}

async function mapFace(dataUrl) {
  state.faceL = null;
  setFaceStatus('loading', '⏳ Mapping face…');
  try {
    const img = await loadImage(dataUrl);
    if (state.photo !== dataUrl) return;            // photo changed meanwhile
    state.photoImg = img;
    const L = await Face.detect(img);
    if (state.photo !== dataUrl) return;
    if (!L) { setFaceStatus('missing', '⚠ No face found. Use a clear, front-facing photo.'); return; }
    state.faceL = L;
    setFaceStatus('ok', '✓ Face mapped — only the selected areas will change');
    if (state.autoGenerate) {                         // captured from Live: show the result right away
      state.autoGenerate = false;
      if (state.plan.size && !aiItems().length && !$('applyBtn').disabled) $('applyBtn').click();
      else if (aiItems().length) showError('Photo captured. Click "Generate" to apply the skin & wrinkle (AI) treatments too.');
    }
    if (state.showAreas) renderAreas();
  } catch (err) {
    console.error(err);
    setFaceStatus('error', '⚠ Face mapping could not load (check internet). You can turn protection off to continue.');
  }
}

/* ---------- Area preview ---------- */
function renderAreas() {
  const ids = [...state.plan.keys()];
  if (!state.faceL || !ids.length) { setAreas(false); return; }
  const { naturalWidth: w, naturalHeight: h } = state.photoImg;
  const mask = Face.buildMask(ids, [state.faceL], w, h);
  $('areaImg').src = Face.tint(state.photoImg, mask).toDataURL('image/jpeg', 0.85);
  $('areaImg').hidden = false;
}

function setAreas(on) {
  state.showAreas = on;
  $('areasBtn').classList.toggle('on', on);
  $('areasBtn').textContent = on ? '👁 Hide areas' : '👁 Show areas';
  if (on) renderAreas(); else $('areaImg').hidden = true;
}
$('areasBtn').addEventListener('click', () => setAreas(!state.showAreas));
$('protectToggle').addEventListener('change', updateUI);

$('fileInput').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (state.live) stopLive();
  stopCamera();
  const img = new Image();
  img.onload = () => { setPhoto(resizeToDataURL(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
  img.onerror = () => showError('Could not read that image. Try a JPG or PNG.');
  img.src = URL.createObjectURL(file);
  e.target.value = '';
});

$('cameraBtn').addEventListener('click', async () => {
  showError('');
  if (state.live) stopLive();
  if (!navigator.mediaDevices?.getUserMedia) { showError('Camera not available in this browser — use Upload.'); return; }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1440 }, height: { ideal: 1800 } }, audio: false,
    });
    $('video').srcObject = state.stream;
    ['video', 'camGuide', 'snapBtn', 'cancelCamBtn'].forEach(id => $(id).hidden = false);
    ['placeholder', 'singleImg', 'compare', 'areaImg'].forEach(id => $(id).hidden = true);
  } catch (err) {
    showError('Camera access was blocked or failed: ' + err.message);
  }
});

$('snapBtn').addEventListener('click', () => {
  const v = $('video');
  if (!v.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0); ctx.scale(-1, 1);   // match mirrored preview
  ctx.drawImage(v, 0, 0);
  const data = resizeToDataURL(c, c.width, c.height);
  stopCamera();
  setPhoto(data);
});

$('cancelCamBtn').addEventListener('click', () => {
  stopCamera();
  if (state.current >= 0) $('compare').hidden = false;
  else if (state.photo) $('singleImg').hidden = false;
  else $('placeholder').hidden = false;
});

function stopCamera() {
  state.stream?.getTracks().forEach(t => t.stop());
  state.stream = null;
  ['video', 'camGuide', 'snapBtn', 'cancelCamBtn'].forEach(id => $(id).hidden = true);
}

$('resetBtn').addEventListener('click', () => {
  state.photo = null; state.versions = []; state.current = -1; state.faceL = null; state.photoImg = null;
  setAreas(false);
  setFaceStatus('none', '');
  ['singleImg', 'compare', 'downloadBtn', 'printBtn', 'viewToggle', 'historyWrap', 'resetBtn'].forEach(id => $(id).hidden = true);
  $('placeholder').hidden = false;
  updateUI();
});

/* ================= Result view ================= */
function showVersion(i) {
  state.current = i;
  const v = state.versions[i];
  $('beforeImg').src = state.photo;
  $('afterImg').src = v.url;
  $('rawViewBtn').hidden = !(v.protect && v.raw);
  $('singleImg').hidden = true;
  $('compare').hidden = false;
  setView(state.view);
  setSplit(50); $('compareRange').value = 50;
  $('downloadBtn').href = v.url;
  ['downloadBtn', 'printBtn', 'viewToggle'].forEach(id => $(id).hidden = false);
  setAreas(false);
  renderHistory();
}

function setSplit(p) {
  $('beforeImg').style.clipPath = `inset(0 ${100 - p}% 0 0)`;
  $('divider').style.left = p + '%';
}
$('compareRange').addEventListener('input', e => setSplit(Number(e.target.value)));

function setView(view) {
  const v = state.versions[state.current];
  if (view === 'raw' && !(v && v.protect)) view = 'compare';
  state.view = view;
  if (v) $('afterImg').src = view === 'raw' ? v.raw : v.url;
  $('compare').querySelector('.tag-r').textContent = view === 'raw' ? 'Raw AI' : 'After';
  const c = $('compare');
  c.classList.toggle('side', view === 'side');
  c.classList.toggle('after', view === 'after' || view === 'raw');
  if (view === 'compare') setSplit(Number($('compareRange').value));
  $('viewToggle').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
}
$('viewToggle').addEventListener('click', e => { const v = e.target.dataset?.view; if (v) setView(v); });

function renderHistory() {
  const strip = $('history');
  strip.innerHTML = '';
  $('historyWrap').hidden = state.versions.length < 1;
  state.versions.forEach((v, i) => {
    const b = document.createElement('button');
    if (i === state.current) b.className = 'on';
    b.title = v.plan.map(([id, val]) => `${byId[id].name} ${doseText(byId[id], val)}`).join(', ');
    b.innerHTML = `<img src="${v.url}" alt="Version ${i + 1}" /><span>V${i + 1}</span>`;
    b.onclick = () => showVersion(i);
    strip.appendChild(b);
  });
}

/* ================= fal.ai ================= */
function getSettings() {
  const model = store.get('fal_model') || 'fal-ai/nano-banana-2/edit';
  return {
    key: store.get('fal_key') || '',
    model: model === 'custom' ? (store.get('fal_custom_model') || '').trim() : model,
  };
}

async function readError(res) {
  let text = await res.text();
  try {
    const j = JSON.parse(text);
    text = j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : (j.message || text);
  } catch { /* not JSON */ }
  if (res.status === 401 || res.status === 403) text = 'Invalid or unauthorized API key. ' + text;
  return `fal error ${res.status}: ${text}`.slice(0, 600);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runFal({ key, model, prompt, image }) {
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };

  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST', headers,
    body: JSON.stringify({ prompt, image_urls: [image], num_images: 1 }),
  });
  if (!submit.ok) throw new Error(await readError(submit));
  const { status_url, response_url } = await submit.json();

  const started = Date.now();
  let done = false;
  while (Date.now() - started < 180000) {
    await sleep(1500);
    const s = await fetch(status_url, { headers });
    if (!s.ok) throw new Error(await readError(s));
    const st = await s.json();
    if (st.status === 'COMPLETED') { done = true; break; }
    setLoading(st.status === 'IN_QUEUE'
      ? `In queue${st.queue_position != null ? ` · position ${st.queue_position + 1}` : ''}…`
      : 'Applying treatments…');
  }
  if (!done) throw new Error('The model took too long (over 3 minutes). Please try again.');

  const r = await fetch(response_url, { headers });
  if (!r.ok) throw new Error(await readError(r));
  const out = await r.json();
  const url = out.images?.[0]?.url || out.image?.url;
  if (!url) throw new Error('The model returned no image. Response: ' + JSON.stringify(out).slice(0, 300));
  return url;
}

// Load the model's image so its pixels can be read (needs CORS).
async function loadResult(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const img = await loadImage(obj);
    return img;
  } catch {
    return loadImage(url, true);
  }
}

$('applyBtn').addEventListener('click', async () => {
  showError('');
  const ai = aiItems(), shape = shapeItems();
  if (!state.photo || !state.plan.size) return;
  const protect = protectOn();
  const { key, model } = getSettings();
  const prompt = $('promptText').value.trim();

  if (ai.length && !key) { showError('Add your fal API key in Settings first (needed for skin & line treatments).'); openSettings(); return; }
  if (ai.length && !model) { showError('Choose a model in Settings.'); openSettings(); return; }
  if ((shape.length || (ai.length && protect)) && state.face !== 'ok') {
    showError(state.face === 'loading' ? 'Still mapping the face — try again in a moment.'
      : 'The face could not be mapped. Use a clear, front-facing photo with good light.');
    return;
  }

  $('applyBtn').disabled = true;
  try {
    let base = state.photoImg, raw = null, note = '';

    // 1) Skin & line treatments → AI (only inside their areas when protection is on)
    if (ai.length) {
      setLoading('Sending to AI…');
      raw = await runFal({ key, model, prompt, image: state.photo });
      const result = await loadResult(raw);
      if (protect) {
        setLoading('Keeping untreated areas original…');
        const out = await Face.protect({ original: state.photoImg, origL: state.faceL, result, ids: ai.map(([id]) => id) });
        base = out.canvas;
        if (!out.aligned) note = 'Note: the face in the AI result was not detected, so alignment may be slightly off.';
      } else {
        base = result;
      }
    }

    // 2) Shape treatments → precise reshaping on the face landmarks
    if (shape.length) {
      setLoading('Reshaping…');
      await new Promise(r => setTimeout(r, 30));      // let the spinner paint
      const L = (!ai.length || protect) ? state.faceL : (await Face.detect(base)) || state.faceL;
      base = Warp.apply(base, L, shape.map(([id, v]) => [id, strength(byId[id], v)]));
    }

    const url = (base instanceof HTMLCanvasElement ? base : toCanvas(base)).toDataURL('image/jpeg', 0.93);
    state.versions.push({ url, raw, protect: !!raw && protect, prompt: ai.length ? prompt : '', style: state.style,
      model: ai.length ? model : 'reshape', plan: [...state.plan], time: new Date() });
    showVersion(state.versions.length - 1);
    if (note) showError(note);
    if (window.innerWidth < 960) $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(err.message === 'Failed to fetch'
      ? 'Network error reaching fal. Check your connection, API key and model ID.'
      : err.message);
  } finally {
    setLoading('');
    updateUI();
  }
});

function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

/* ================= Report ================= */
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

$('printBtn').addEventListener('click', () => {
  const v = state.versions[state.current];
  if (!v) return;
  const clinic = store.get('clinic_name') || '';
  const client = $('clientName').value.trim();
  const style = STYLES.find(s => s.id === v.style).name;
  $('rMeta').textContent = [clinic, client && `Client: ${client}`, v.time.toLocaleDateString(), `Style: ${style}`]
    .filter(Boolean).join(' · ');
  $('rBefore').src = state.photo;
  $('rAfter').src = v.url;
  $('rTable').innerHTML = '<tr><th>Category</th><th>Treatment</th><th>Area</th><th>Dose / intensity</th></tr>' +
    v.plan.map(([id, val]) => {
      const t = byId[id];
      return `<tr><td>${esc(catById[t.cat].name)}</td><td>${esc(t.name)}</td><td>${esc(t.area)}</td><td>${esc(doseText(t, val))}</td></tr>`;
    }).join('');
  // wait for the result image to load before printing
  const img = $('rAfter');
  if (img.complete) window.print(); else img.onload = () => { img.onload = null; window.print(); };
});

/* ================= Prompt box / clear ================= */
$('promptText').addEventListener('input', () => { state.promptEdited = true; updateUI(); });
$('resetPromptBtn').addEventListener('click', () => { refreshPrompt(true); updateUI(); });
$('clearBtn').addEventListener('click', () => { state.plan.clear(); state.promptEdited = false; changed(); });

/* ================= Settings ================= */
function openSettings() {
  $('keyInput').value = store.get('fal_key') || '';
  $('modelSelect').value = store.get('fal_model') || 'fal-ai/nano-banana-2/edit';
  $('customModel').value = store.get('fal_custom_model') || '';
  $('clinicInput').value = store.get('clinic_name') || '';
  $('customWrap').hidden = $('modelSelect').value !== 'custom';
  $('settings').showModal();
}
$('settingsBtn').addEventListener('click', openSettings);
$('modelSelect').addEventListener('change', () => { $('customWrap').hidden = $('modelSelect').value !== 'custom'; });
$('saveSettings').addEventListener('click', () => {
  store.set('fal_key', $('keyInput').value.trim());
  store.set('fal_model', $('modelSelect').value);
  store.set('fal_custom_model', $('customModel').value.trim());
  store.set('clinic_name', $('clinicInput').value.trim());
  setTimeout(updateUI, 0);
});

/* ================= Live preview ================= */
const LIVE_UI = ['liveCanvas', 'liveBadge', 'liveCaptureBtn', 'liveHoldBtn', 'liveExitBtn', 'liveNote'];

function liveStatus(kind) {
  const el = $('liveStatus');
  const text = kind === 'loading' ? 'Starting face tracking…'
    : kind === 'noface' ? 'Face not found — look at the camera'
    : !state.plan.size ? 'Select treatments on the right to see them live'
    : !shapeItems().length ? 'Select a treatment on the right (AI treatments are hidden in Live)'
    : '';
  el.hidden = !text;
  if (text && el.textContent !== text) el.textContent = text;
}

async function startLive() {
  showError('');
  if (!Live.supported) { showError('Live preview needs a browser with WebGL2 (recent Chrome, Safari, Edge or Firefox). Use Camera or Upload instead.'); return; }
  if (!navigator.mediaDevices?.getUserMedia) { showError('Camera not available in this browser — use Upload.'); return; }
  stopCamera();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
  } catch (err) {
    showError('Camera access was blocked or failed: ' + err.message);
    return;
  }
  const v = $('video');
  v.srcObject = state.stream;
  await v.play().catch(() => {});
  if (v.videoWidth) $('stage').style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;   // frame follows the camera shape
  state.live = true;
  ['placeholder', 'singleImg', 'compare', 'areaImg', 'video', 'camGuide', 'snapBtn', 'cancelCamBtn',
   'viewToggle', 'downloadBtn', 'printBtn', 'resetBtn', 'faceStatus'].forEach(id => $(id).hidden = true);
  LIVE_UI.forEach(id => $(id).hidden = false);
  $('liveBtn').hidden = true;
  state.area = 'All'; renderBuilder(); renderPlan();
  try {
    await Live.start({
      video: v, canvas: $('liveCanvas'),
      getItems: () => shapeItems().map(([id, val]) => [id, strength(byId[id], val)]),
      onStatus: liveStatus,
    });
  } catch (err) {
    console.error(err);
    stopLive();
    showError('Live preview could not start (' + err.message + '). Use Camera or Upload instead.');
  }
}

function stopLive(restoreView = true) {
  Live.stop();
  state.live = false;
  state.stream?.getTracks().forEach(t => t.stop());
  state.stream = null;
  $('video').srcObject = null;
  LIVE_UI.concat('liveStatus').forEach(id => $(id).hidden = true);
  $('stage').style.aspectRatio = '';
  renderBuilder(); renderPlan();
  $('liveBtn').hidden = false;
  if (!restoreView) return;
  if (state.current >= 0) { $('compare').hidden = false; ['viewToggle', 'downloadBtn', 'printBtn'].forEach(id => $(id).hidden = false); }
  else if (state.photo) $('singleImg').hidden = false;
  else $('placeholder').hidden = false;
  if (state.photo) { $('resetBtn').hidden = false; $('faceStatus').hidden = !$('faceStatus').textContent; }
}

$('liveBtn').addEventListener('click', startLive);
$('liveExitBtn').addEventListener('click', () => stopLive());
$('liveCaptureBtn').addEventListener('click', () => {
  const frame = Live.captureFrame();
  const data = resizeToDataURL(frame, frame.width, frame.height);
  stopLive(false);
  state.autoGenerate = true;
  setPhoto(data);
});
const hold = on => { Live.setBypass(on); $('liveHoldBtn').classList.toggle('on', on); $('liveHoldBtn').textContent = on ? 'Before (release for after)' : 'Hold to see before'; };
$('liveHoldBtn').addEventListener('pointerdown', e => { e.preventDefault(); hold(true); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('liveHoldBtn').addEventListener(ev, () => hold(false)));

/* ================= Init ================= */
renderStyles();
renderBuilder();
renderPlan();
refreshPrompt(true);
updateUI();
