// Aesthetic Preview — simulate filler treatments with a fal.ai image-edit model.
// Plain JS, no build step, no libraries.

/* ---------- Treatments ---------- */
// unit "mL" = filler volume. unit "level" = non-volume effect (0 = off).
const TREATMENTS = [
  { id: 'lips', name: 'Lips', unit: 'mL', max: 3, step: 0.5,
    desc: 'Volume and definition',
    prompt: (w, v) => `Lips: ${w} increase in lip volume, as from ${v} mL of hyaluronic acid filler. Keep a natural shape and proportions, softly defined lip border, no lipstick, no change to lip color.` },
  { id: 'cheeks', name: 'Cheeks', unit: 'mL', max: 4, step: 0.5,
    desc: 'Midface lift and cheekbone projection',
    prompt: (w, v) => `Cheeks: ${w} midface volume and cheekbone projection, as from ${v} mL of filler in total. Slight lift of the midface, smooth natural contour.` },
  { id: 'chin', name: 'Chin', unit: 'mL', max: 3, step: 0.5,
    desc: 'Projection and profile balance',
    prompt: (w, v) => `Chin: ${w} chin projection and definition, as from ${v} mL of filler. Better balance with the nose and lips, natural shape.` },
  { id: 'jawline', name: 'Jawline', unit: 'mL', max: 6, step: 1,
    desc: 'Sharper jaw contour',
    prompt: (w, v) => `Jawline: ${w} jawline definition, as from ${v} mL of filler. Cleaner, more defined jaw contour from the angle of the jaw to the chin.` },
  { id: 'nasolabial', name: 'Nasolabial folds', unit: 'mL', max: 2, step: 0.5,
    desc: 'Soften smile lines nose → mouth',
    prompt: (w, v) => `Nasolabial folds: ${w} softening of the lines from the nose to the corners of the mouth, as from ${v} mL of filler. Keep natural skin texture.` },
  { id: 'marionette', name: 'Marionette lines', unit: 'mL', max: 2, step: 0.5,
    desc: 'Soften lines below mouth corners',
    prompt: (w, v) => `Marionette lines: ${w} softening of the lines running down from the corners of the mouth, as from ${v} mL of filler. Slightly lifted mouth corners.` },
  { id: 'tearTrough', name: 'Under-eye (tear trough)', unit: 'mL', max: 2, step: 0.5,
    desc: 'Fill hollows under the eyes',
    prompt: (w, v) => `Under-eye tear troughs: ${w} filling of the hollows under the eyes, as from ${v} mL of filler. Smoother transition from lower eyelid to cheek.` },
  { id: 'doubleChin', name: 'Double chin reduction', unit: 'level', max: 3, step: 1,
    labels: ['Off', 'Light', 'Moderate', 'Strong'],
    desc: 'Reduce fat under the chin',
    prompt: (w) => `Under the chin: ${w} reduction of submental fat (double chin). Cleaner angle between neck and jaw.` },
  { id: 'eyeBright', name: 'Eye brightening', unit: 'level', max: 3, step: 1,
    labels: ['Off', 'Light', 'Moderate', 'Strong'],
    desc: 'Reduce dark circles, rested look',
    prompt: (w) => `Eyes: ${w} brightening — reduce dark circles and under-eye shadows for a more rested look. Keep iris color, eye shape and eyelashes unchanged.` },
];

const state = {
  values: Object.fromEntries(TREATMENTS.map(t => [t.id, 0])),
  photo: null,      // data URL of the original (resized)
  result: null,     // URL of the generated image
  promptEdited: false,
  stream: null,
};

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);

function intensityWord(value, max) {
  const f = value / max;
  if (f <= 0.34) return 'subtle';
  if (f <= 0.67) return 'moderate';
  return 'pronounced but still natural-looking';
}

function displayValue(t, v) {
  if (t.unit === 'level') return t.labels[v];
  return v === 0 ? '—' : `${v} mL`;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

function showError(msg) {
  const el = $('error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

/* ---------- Prompt ---------- */
function buildPrompt() {
  const lines = TREATMENTS
    .filter(t => state.values[t.id] > 0)
    .map(t => '- ' + t.prompt(intensityWord(state.values[t.id], t.max), state.values[t.id]));

  if (!lines.length) return '';

  return [
    'Photorealistic aesthetic-treatment simulation of this exact same person.',
    'Keep their identity, facial structure, skin tone, skin texture and pores, hair, expression, pose, lighting, background and camera framing exactly the same.',
    'Apply ONLY these changes:',
    ...lines,
    'Do not add makeup, do not retouch or smooth the skin, do not change age, and make no other changes. The result must look like a real, unedited photograph.',
  ].join('\n');
}

function refreshPrompt(force = false) {
  if (force || !state.promptEdited) {
    $('promptText').value = buildPrompt();
    state.promptEdited = false;
  }
}

/* ---------- Treatment UI ---------- */
function renderTreatments() {
  const wrap = $('treatments');
  wrap.innerHTML = '';
  for (const t of TREATMENTS) {
    const card = document.createElement('div');
    card.className = 't-card';
    card.innerHTML = `
      <span class="t-name">${t.name}</span>
      <span class="t-val" id="val-${t.id}"></span>
      <span class="t-desc">${t.desc}${t.unit === 'mL' ? ` · up to ${t.max} mL` : ''}</span>
      <input type="range" min="0" max="${t.max}" step="${t.step}" value="0" aria-label="${t.name}" />`;
    const input = card.querySelector('input');
    input.addEventListener('input', () => {
      state.values[t.id] = Number(input.value);
      updateCard(t, card);
      updateSummary();
      refreshPrompt();
    });
    t._card = card; t._input = input;
    updateCard(t, card);
    wrap.appendChild(card);
  }
}

function updateCard(t, card) {
  const v = state.values[t.id];
  card.querySelector('.t-val').textContent = displayValue(t, v);
  card.classList.toggle('active', v > 0);
}

function updateSummary() {
  const ml = TREATMENTS.filter(t => t.unit === 'mL').reduce((s, t) => s + state.values[t.id], 0);
  const areas = TREATMENTS.filter(t => state.values[t.id] > 0).length;
  $('totalMl').textContent = `${ml} mL`;
  $('areaCount').textContent = areas;
  updateApply();
}

function updateApply() {
  const hasPrompt = $('promptText').value.trim().length > 0;
  $('applyBtn').disabled = !(state.photo && hasPrompt);
}

/* ---------- Photo: upload / camera ---------- */
function resizeToDataURL(source, w, h, maxSide = 1024) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = $('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

function setPhoto(dataUrl) {
  state.photo = dataUrl;
  state.result = null;
  $('stage').classList.remove('empty');
  $('placeholder').hidden = true;
  $('compare').hidden = true;
  $('singleImg').src = dataUrl;
  $('singleImg').hidden = false;
  $('downloadBtn').hidden = true;
  $('resetBtn').hidden = false;
  showError('');
  updateApply();
}

$('fileInput').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  stopCamera();
  const img = new Image();
  img.onload = () => {
    setPhoto(resizeToDataURL(img, img.naturalWidth, img.naturalHeight));
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => showError('Could not read that image. Try a JPG or PNG.');
  img.src = URL.createObjectURL(file);
  e.target.value = '';
});

$('cameraBtn').addEventListener('click', async () => {
  showError('');
  if (!navigator.mediaDevices?.getUserMedia) {
    showError('Camera is not available in this browser. Use Upload instead.');
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1600 } },
      audio: false,
    });
    const v = $('video');
    v.srcObject = state.stream;
    v.hidden = false;
    $('placeholder').hidden = true;
    $('singleImg').hidden = true;
    $('compare').hidden = true;
    $('snapBtn').hidden = false;
    $('cancelCamBtn').hidden = false;
  } catch (err) {
    showError('Camera access was blocked or failed: ' + err.message);
  }
});

$('snapBtn').addEventListener('click', () => {
  const v = $('video');
  if (!v.videoWidth) return;
  // Draw mirrored so the photo matches what the user saw in the preview.
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0); ctx.scale(-1, 1);
  ctx.drawImage(v, 0, 0);
  const data = resizeToDataURL(c, c.width, c.height);
  stopCamera();
  setPhoto(data);
});

$('cancelCamBtn').addEventListener('click', () => {
  stopCamera();
  if (state.photo) $('singleImg').hidden = false;
  else $('placeholder').hidden = false;
});

function stopCamera() {
  state.stream?.getTracks().forEach(t => t.stop());
  state.stream = null;
  $('video').hidden = true;
  $('snapBtn').hidden = true;
  $('cancelCamBtn').hidden = true;
}

$('resetBtn').addEventListener('click', () => {
  state.photo = null; state.result = null;
  $('singleImg').hidden = true; $('compare').hidden = true;
  $('placeholder').hidden = false; $('stage').classList.add('empty');
  $('downloadBtn').hidden = true; $('resetBtn').hidden = true;
  updateApply();
});

/* ---------- Before / after ---------- */
function showCompare(before, after) {
  $('beforeImg').src = before;
  $('afterImg').src = after;
  $('singleImg').hidden = true;
  $('compare').hidden = false;
  setSplit(50);
  $('compareRange').value = 50;
}
function setSplit(p) {
  $('beforeImg').style.clipPath = `inset(0 ${100 - p}% 0 0)`;
  $('divider').style.left = p + '%';
}
$('compareRange').addEventListener('input', e => setSplit(Number(e.target.value)));

/* ---------- fal.ai ---------- */
function getSettings() {
  const model = store.get('fal_model') || 'fal-ai/nano-banana-2/edit';
  const custom = store.get('fal_custom_model') || '';
  return {
    key: store.get('fal_key') || '',
    model: model === 'custom' ? custom.trim() : model,
  };
}

async function readError(res) {
  let text = await res.text();
  try {
    const j = JSON.parse(text);
    text = j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : (j.message || text);
  } catch { /* not JSON */ }
  return `fal error ${res.status}: ${text}`.slice(0, 600);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runFal({ key, model, prompt, image }) {
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };

  // 1. Submit to the queue
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, image_urls: [image], num_images: 1 }),
  });
  if (!submit.ok) throw new Error(await readError(submit));
  const { status_url, response_url } = await submit.json();

  // 2. Poll status (up to ~3 minutes)
  const started = Date.now();
  while (Date.now() - started < 180000) {
    await sleep(1500);
    const s = await fetch(status_url, { headers });
    if (!s.ok) throw new Error(await readError(s));
    const st = await s.json();
    if (st.status === 'COMPLETED') break;
    if (st.status === 'IN_QUEUE') setLoading(`In queue${st.queue_position != null ? ` (#${st.queue_position})` : ''}…`);
    else setLoading('Generating…');
  }

  // 3. Fetch result
  const r = await fetch(response_url, { headers });
  if (!r.ok) throw new Error(await readError(r));
  const out = await r.json();
  const url = out.images?.[0]?.url || out.image?.url;
  if (!url) throw new Error('The model returned no image. Response: ' + JSON.stringify(out).slice(0, 300));
  return url;
}

function setLoading(text) {
  $('loading').hidden = !text;
  if (text) $('loadingText').textContent = text;
}

$('applyBtn').addEventListener('click', async () => {
  showError('');
  const { key, model } = getSettings();
  if (!key) { showError('Add your fal API key in Settings first.'); $('settings').showModal(); return; }
  if (!model) { showError('Choose a model in Settings.'); return; }
  const prompt = $('promptText').value.trim();
  if (!state.photo || !prompt) return;

  $('applyBtn').disabled = true;
  setLoading('Sending to AI…');
  try {
    const url = await runFal({ key, model, prompt, image: state.photo });
    state.result = url;
    showCompare(state.photo, url);
    const dl = $('downloadBtn');
    dl.href = url; dl.hidden = false;
  } catch (err) {
    const msg = err.message === 'Failed to fetch'
      ? 'Network error reaching fal. Check your connection, key and that the model ID is correct.'
      : err.message;
    showError(msg);
  } finally {
    setLoading('');
    updateApply();
  }
});

/* ---------- Prompt box / clear ---------- */
$('promptText').addEventListener('input', () => { state.promptEdited = true; updateApply(); });
$('resetPromptBtn').addEventListener('click', () => { refreshPrompt(true); updateApply(); });
$('clearBtn').addEventListener('click', () => {
  for (const t of TREATMENTS) {
    state.values[t.id] = 0; t._input.value = 0; updateCard(t, t._card);
  }
  refreshPrompt(true);
  updateSummary();
});

/* ---------- Settings ---------- */
function syncCustomField() {
  $('customWrap').hidden = $('modelSelect').value !== 'custom';
}
$('settingsBtn').addEventListener('click', () => {
  $('keyInput').value = store.get('fal_key') || '';
  $('modelSelect').value = store.get('fal_model') || 'fal-ai/nano-banana-2/edit';
  $('customModel').value = store.get('fal_custom_model') || '';
  syncCustomField();
  $('settings').showModal();
});
$('modelSelect').addEventListener('change', syncCustomField);
$('saveSettings').addEventListener('click', () => {
  store.set('fal_key', $('keyInput').value.trim());
  store.set('fal_model', $('modelSelect').value);
  store.set('fal_custom_model', $('customModel').value.trim());
});

/* ---------- Init ---------- */
renderTreatments();
updateSummary();
refreshPrompt(true);
