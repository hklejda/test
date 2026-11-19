/* ORA · price estimate
   A clinic keeps a list of filler and botox products with its own prices (Settings).
   The Plan shows an estimated total in euros from the doses chosen:
     fillers: total mL → syringes (rounded up to whole syringes by default) × price per syringe
     botox:   units × price per unit; the plan's units are Botox® (onabotulinumtoxinA) units, so
              products with different units (Dysport, Azzalure) carry a factor (≈2.5 units per Botox unit).
   Starting prices are typical Albanian clinic prices (2026: fillers from about €180 per 1 mL syringe,
   botox from about €120 per area ≈ €6 per unit). Each clinic should set its own. */

const Pricing = (() => {
  const KEY = 'ora_pricing';
  const DEFAULTS = {
    currency: 'EUR',
    roundSyringes: true,
    products: [
      { id: 'juvederm',  cat: 'filler', name: 'Juvéderm (Allergan)',    price: 250, size: 1 },
      { id: 'restylane', cat: 'filler', name: 'Restylane (Galderma)',   price: 230, size: 1 },
      { id: 'teosyal',   cat: 'filler', name: 'Teosyal RHA (Teoxane)',  price: 230, size: 1 },
      { id: 'belotero',  cat: 'filler', name: 'Belotero (Merz)',        price: 220, size: 1 },
      { id: 'saypha',    cat: 'filler', name: 'Saypha (Croma)',         price: 180, size: 1 },
      { id: 'botox',     cat: 'botox',  name: 'Botox® (Allergan)',      price: 6,   factor: 1 },
      { id: 'xeomin',    cat: 'botox',  name: 'Xeomin (Merz)',          price: 5.5, factor: 1 },
      { id: 'dysport',   cat: 'botox',  name: 'Dysport (Ipsen)',        price: 2.4, factor: 2.5 },
      { id: 'azzalure',  cat: 'botox',  name: 'Azzalure (Galderma)',    price: 2.4, factor: 2.5 },
    ],
    default: { filler: 'juvederm', botox: 'botox' },
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  let cfg = load();
  const chosen = { filler: null, botox: null };          // product picked in the Plan for this estimate

  function load() {
    try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && Array.isArray(c.products)) return c; } catch {}
    return clone(DEFAULTS);
  }
  function save(c, { sync = true } = {}) {
    cfg = c;
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
    if (sync && typeof window.onPricingSaved === 'function') window.onPricingSaved(c);
    render();
  }
  const eur = n => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  const list = cat => cfg.products.filter(p => p.cat === cat);
  const product = cat => cfg.products.find(p => p.id === (chosen[cat] || cfg.default[cat])) || list(cat)[0] || null;

  /* ---- the estimate ---- */
  function estimate(plan) {
    const sum = cat => plan.filter(([id]) => byId[id] && byId[id].cat === cat && byId[id].type === 'dose').reduce((s, [, v]) => s + v, 0);
    const mL = sum('filler'), units = sum('botox'), lines = [];
    let total = 0;
    const f = product('filler');
    if (mL > 0 && f) {
      const size = f.size || 1, syr = cfg.roundSyringes ? Math.ceil(mL / size - 1e-9) : mL / size, cost = syr * f.price;
      total += cost;
      lines.push({ cat: 'filler', product: f.name,
        qty: cfg.roundSyringes ? `${syr} syringe${syr === 1 ? '' : 's'} (${fmtN(mL)} mL)` : `${fmtN(mL)} mL`,
        unit: `${eur(f.price)} / ${size === 1 ? 'syringe' : fmtN(size) + ' mL syringe'}`, cost });
    }
    const b = product('botox');
    if (units > 0 && b) {
      const u = units * (b.factor || 1), cost = u * b.price;
      total += cost;
      lines.push({ cat: 'botox', product: b.name,
        qty: (b.factor || 1) === 1 ? `${fmtN(u)} U` : `${fmtN(u)} U (= ${fmtN(units)} Botox U)`,
        unit: `${eur(b.price)} / unit`, cost });
    }
    return { total, lines, mL, units };
  }
  const fmtN = n => String(Math.round(n * 100) / 100);

  /* ---- Plan card ---- */
  function fillPick(sel, cat) {
    const cur = product(cat);
    sel.innerHTML = list(cat).map(p => `<option value="${p.id}"${cur && p.id === cur.id ? ' selected' : ''}>${escH(p.name)}</option>`).join('');
  }
  const escH = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function render() {
    const box = document.getElementById('estimate'); if (!box || typeof state === 'undefined') return;
    const e = estimate([...state.plan]);
    box.hidden = !e.lines.length;
    document.getElementById('estTotal').textContent = eur(Math.round(e.total));
    document.getElementById('estLines').innerHTML = e.lines.map(l =>
      `<div class="est-line"><span class="el-name">${escH(l.product)}<small>${escH(l.qty)} · ${escH(l.unit)}</small></span><span class="el-cost">${eur(Math.round(l.cost))}</span></div>`).join('');
    const pf = document.getElementById('estFiller'), pb = document.getElementById('estBotox');
    pf.closest('label').hidden = !(e.mL > 0); pb.closest('label').hidden = !(e.units > 0);
    fillPick(pf, 'filler'); fillPick(pb, 'botox');
  }

  /* ---- Settings: products & prices ---- */
  let draft = null;
  function openEditor() { draft = clone(cfg); drawEditor(); }
  function drawEditor() {
    for (const cat of ['filler', 'botox']) {
      const body = document.getElementById(cat === 'filler' ? 'prodFiller' : 'prodBotox');
      body.innerHTML = '';
      draft.products.filter(p => p.cat === cat).forEach(p => {
        const row = document.createElement('div'); row.className = 'prod-row';
        row.innerHTML = `
          <label class="prod-def" title="Default"><input type="radio" name="def-${cat}" ${draft.default[cat] === p.id ? 'checked' : ''} aria-label="Use ${escH(p.name)} by default"><span></span></label>
          <input class="prod-name" value="${escH(p.name)}" aria-label="Product name" placeholder="Brand / product" />
          <span class="prod-money"><span>€</span><input class="prod-price" type="number" min="0" step="0.1" inputmode="decimal" value="${p.price}" aria-label="Price" /></span>
          <span class="prod-per">${cat === 'filler' ? 'per' : '/ unit'}</span>
          ${cat === 'filler'
            ? `<span class="prod-extra"><input class="prod-size" type="number" min="0.1" step="0.1" inputmode="decimal" value="${p.size || 1}" aria-label="Syringe size in mL" /> mL</span>`
            : `<span class="prod-extra" title="Units of this product per Botox unit (Dysport/Azzalure ≈ 2.5)">× <input class="prod-factor" type="number" min="0.1" step="0.1" inputmode="decimal" value="${p.factor || 1}" aria-label="Units per Botox unit" /></span>`}
          <button type="button" class="x" aria-label="Remove ${escH(p.name)}">×</button>`;
        row.querySelector('.prod-name').oninput = e => { p.name = e.target.value; };
        row.querySelector('.prod-price').oninput = e => { p.price = Math.max(0, parseFloat(e.target.value) || 0); };
        const sz = row.querySelector('.prod-size'); if (sz) sz.oninput = e => { p.size = Math.max(0.1, parseFloat(e.target.value) || 1); };
        const fc = row.querySelector('.prod-factor'); if (fc) fc.oninput = e => { p.factor = Math.max(0.1, parseFloat(e.target.value) || 1); };
        row.querySelector('input[type=radio]').onchange = () => { draft.default[cat] = p.id; };
        row.querySelector('.x').onclick = () => {
          draft.products = draft.products.filter(q => q !== p);
          if (draft.default[cat] === p.id) { const n = draft.products.find(q => q.cat === cat); draft.default[cat] = n ? n.id : null; }
          drawEditor();
        };
        body.appendChild(row);
      });
    }
    document.getElementById('roundSyr').checked = !!draft.roundSyringes;
  }
  function addProduct(cat) {
    const id = cat + '-' + Date.now().toString(36);
    draft.products.push(cat === 'filler' ? { id, cat, name: '', price: 200, size: 1 } : { id, cat, name: '', price: 5, factor: 1 });
    if (!draft.default[cat]) draft.default[cat] = id;
    drawEditor();
    const rows = document.querySelectorAll(`#${cat === 'filler' ? 'prodFiller' : 'prodBotox'} .prod-name`);
    rows[rows.length - 1]?.focus();
  }
  function commitEditor() {
    if (!draft) return;
    draft.roundSyringes = document.getElementById('roundSyr').checked;
    draft.products = draft.products.map(p => ({ ...p, name: p.name.trim() || (p.cat === 'filler' ? 'Filler' : 'Botulinum toxin') }));
    chosen.filler = chosen.botox = null;
    save(draft); draft = null;
  }
  function resetEditor() { draft = clone(DEFAULTS); drawEditor(); }

  /* ---- wiring ---- */
  document.getElementById('estFiller').addEventListener('change', e => { chosen.filler = e.target.value; render(); });
  document.getElementById('estBotox').addEventListener('change', e => { chosen.botox = e.target.value; render(); });
  document.getElementById('addFiller').addEventListener('click', () => addProduct('filler'));
  document.getElementById('addBotox').addEventListener('click', () => addProduct('botox'));
  document.getElementById('resetPrices').addEventListener('click', resetEditor);
  document.getElementById('settingsBtn').addEventListener('click', openEditor);
  document.getElementById('saveSettings').addEventListener('click', commitEditor);

  if (window.__oraRemotePricing && Array.isArray(window.__oraRemotePricing.products)) {
    cfg = window.__oraRemotePricing; try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {}
  }
  render();
  return {
    render, estimate, eur,
    get config() { return cfg; },
    // the account's saved prices (from the database) replace the local copy
    useRemote(c) { if (c && Array.isArray(c.products)) { save(c, { sync: false }); } },
  };
})();
