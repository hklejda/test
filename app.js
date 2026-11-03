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
function fmtNum(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

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
function intensityWord(t, v) {
  const base = t.type === 'level' ? v / 3 : v / t.max;
  const f = base * STYLES.find(s => s.id === state.style).factor;
  if (f <= 0.34) return 'subtle';
  if (f <= 0.67) return 'moderate';
  if (f <= 1.0) return 'clearly visible';
  return 'strong, well-defined';
}

const STYLE_LINE = {
  natural: 'Overall the result must be subtle and very natural — someone who knows the person would only notice they look fresher.',
  balanced: 'Overall the result should be clearly visible but still natural and harmonious.',
  enhanced: 'Overall the result should be noticeably enhanced and well-defined, while remaining anatomically realistic.',
};

function buildPrompt() {
  if (!state.plan.size) return '';
  const groups = CATEGORIES.map(c => {
    const items = [...state.plan].filter(([id]) => byId[id].cat === c.id);
    if (!items.length) return null;
    return [`${c.name}:`, ...items.map(([id, v]) => '- ' + byId[id].prompt(intensityWord(byId[id], v), fmtNum(v)))].join('\n');
  }).filter(Boolean);

  return [
    'Photorealistic aesthetic-treatment simulation of this exact same person, as a post-treatment clinical photo.',
    'Keep identity, bone structure, skin tone, real skin texture and pores, hair, expression, pose, lighting, background and framing exactly the same.',
    'Apply ONLY the following treatments:',
    '',
    ...groups.flatMap(g => [g, '']),
    STYLE_LINE[state.style],
    'Do not add makeup, filters or beauty retouching, do not change age or ethnicity, and make no other changes. Output must look like a real unedited photograph.',
  ].join('\n');
}

function refreshPrompt(force = false) {
  if (force || !state.promptEdited) {
    $('promptText').value = buildPrompt();
    state.promptEdited = false;
  }
}

/* ================= Category tabs & filters ================= */
function renderTabs() {
  const wrap = $('catTabs');
  wrap.innerHTML = '';
  for (const c of CATEGORIES) {
    const count = [...state.plan.keys()].filter(id => byId[id].cat === c.id).length;
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
  const areas = ['All', ...new Set(TREATMENTS.filter(t => t.cat === state.cat).map(t => t.area))];
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
  const list = TREATMENTS.filter(t => t.cat === state.cat && (state.area === 'All' || t.area === state.area));
  for (const t of list) grid.appendChild(card(t));
}

function card(t) {
  const on = state.plan.has(t.id);
  const el = document.createElement('div');
  el.className = 't-card' + (on ? ' on' : '');
  el.innerHTML = `
    <div class="t-top"><span class="t-name">${t.name}</span><span class="t-check">${on ? '✓' : ''}</span></div>
    <span class="t-desc">${t.desc}</span>
    <span class="t-range">${rangeText(t)}</span>`;
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
    const items = [...state.plan].filter(([id]) => byId[id].cat === c.id);
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

  const hasPrompt = $('promptText').value.trim().length > 0;
  const key = store.get('fal_key');
  $('applyBtn').disabled = !(state.photo && hasPrompt);
  $('applyHint').textContent =
    !state.photo ? 'Add a client photo to start.' :
    !hasPrompt ? 'Select at least one treatment.' :
    !key ? 'Add your fal API key in ⚙ Settings.' :
    protectOn() && state.face === 'loading' ? 'Mapping the face… one moment.' :
    protectOn() && state.face !== 'ok' ? 'Face not mapped — turn off "Change only selected areas" or use a clearer front photo.' : '';
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
  stopCamera();
  const img = new Image();
  img.onload = () => { setPhoto(resizeToDataURL(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
  img.onerror = () => showError('Could not read that image. Try a JPG or PNG.');
  img.src = URL.createObjectURL(file);
  e.target.value = '';
});

$('cameraBtn').addEventListener('click', async () => {
  showError('');
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
  state.view = view;
  const c = $('compare');
  c.classList.toggle('side', view === 'side');
  c.classList.toggle('after', view === 'after');
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
  const { key, model } = getSettings();
  if (!key) { showError('Add your fal API key in Settings first.'); openSettings(); return; }
  if (!model) { showError('Choose a model in Settings.'); openSettings(); return; }
  const prompt = $('promptText').value.trim();
  if (!state.photo || !prompt) return;
  const protect = protectOn();
  if (protect && state.face !== 'ok') {
    showError(state.face === 'loading' ? 'Still mapping the face — try again in a moment.'
      : 'The face could not be mapped, so protection can\'t be applied. Use a clearer front photo, or turn off "Change only selected areas".');
    return;
  }

  $('applyBtn').disabled = true;
  setLoading('Sending to AI…');
  try {
    const raw = await runFal({ key, model, prompt, image: state.photo });
    let url = raw, note = '';
    if (protect) {
      setLoading('Keeping untreated areas original…');
      const result = await loadResult(raw);
      const out = await Face.protect({ original: state.photoImg, origL: state.faceL, result, ids: [...state.plan.keys()] });
      url = out.canvas.toDataURL('image/jpeg', 0.93);
      if (!out.aligned) note = 'Note: the face in the AI result was not detected, so alignment may be slightly off.';
    }
    state.versions.push({ url, raw, protect, prompt, style: state.style, model, plan: [...state.plan], time: new Date() });
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

/* ================= Init ================= */
renderStyles();
renderBuilder();
renderPlan();
refreshPrompt(true);
updateUI();
