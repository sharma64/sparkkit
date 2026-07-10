'use strict';

// ---- helpers ----------------------------------------------------
const $ = (id) => document.getElementById(id);
const money = (n, cur = 'AUD') => {
  if (!Number.isFinite(n)) return '–';
  try { return n.toLocaleString('en-AU', { style: 'currency', currency: cur }); }
  catch { return `${cur} ${n.toFixed(2)}`; }
};
const monthKey = (dateStr) => (dateStr && /^\d{4}-\d{2}/.test(dateStr)) ? dateStr.slice(0, 7) : 'unknown';
const monthLabel = (key) => {
  if (key === 'unknown') return 'No date';
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CATEGORIES = [
  'Tools', 'Materials', 'Fuel', 'Vehicle', 'PPE & Workwear',
  'Food & Drink', 'Training', 'Office & Admin', 'Home Building', 'Other',
];

// ---- tab navigation ---------------------------------------------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const go = tab.dataset.go;
    document.querySelectorAll('[data-screen]').forEach((s) => (s.hidden = s.id !== go));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    window.scrollTo(0, 0);
    if (go === 'list') renderList();
    if (go === 'totals') renderTotals();
    if (go === 'scan') $('no-key-warning').hidden = !!getKey();
  });
});

// ---- storage: API key -------------------------------------------
const KEY_STORE = 'receipts.apiKey';
const getKey = () => localStorage.getItem(KEY_STORE) || '';

$('btn-save-key').addEventListener('click', () => {
  const v = $('set-key').value.trim();
  if (!v) return show('key-status', 'Paste a key first.', 'bad');
  localStorage.setItem(KEY_STORE, v);
  show('key-status', 'Key saved on this device.', 'ok');
  $('no-key-warning').hidden = true;
});
$('btn-clear-key').addEventListener('click', () => {
  localStorage.removeItem(KEY_STORE);
  $('set-key').value = '';
  show('key-status', 'Key removed.', 'ok');
});

function show(id, html, state) {
  const el = $(id);
  el.innerHTML = html;
  el.className = 'result' + (state ? ' ' + state : '');
}

// ---- storage: IndexedDB -----------------------------------------
let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sparkkit-receipts', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('receipts', { keyPath: 'id' });
    };
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}
const store = (mode) => db.transaction('receipts', mode).objectStore('receipts');
const dbPut = (r) => new Promise((res, rej) => {
  const q = store('readwrite').put(r); q.onsuccess = () => res(); q.onerror = () => rej(q.error);
});
const dbAll = () => new Promise((res, rej) => {
  const q = store('readonly').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
});
const dbDelete = (id) => new Promise((res, rej) => {
  const q = store('readwrite').delete(id); q.onsuccess = () => res(); q.onerror = () => rej(q.error);
});
const dbClear = () => new Promise((res, rej) => {
  const q = store('readwrite').clear(); q.onsuccess = () => res(); q.onerror = () => rej(q.error);
});

// ---- image processing -------------------------------------------
async function loadScaled(file, maxEdge, quality) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.toDataURL('image/jpeg', quality);
}

// ---- AI extraction ----------------------------------------------
const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    is_receipt: { type: 'boolean', description: 'False if the image is not a receipt, invoice or till docket.' },
    merchant: { type: 'string', description: 'Store or business name. Empty string if unreadable.' },
    date: { anyOf: [{ type: 'string', description: 'Purchase date, YYYY-MM-DD.' }, { type: 'null' }] },
    total: { anyOf: [{ type: 'number', description: 'Grand total paid.' }, { type: 'null' }] },
    gst: { anyOf: [{ type: 'number', description: 'GST / tax component if printed.' }, { type: 'null' }] },
    currency: { type: 'string', description: 'ISO 4217 code, e.g. AUD. Assume AUD if not shown.' },
    category: { type: 'string', enum: CATEGORIES },
    payment_method: { anyOf: [{ type: 'string', description: 'e.g. EFTPOS, Visa …1234, cash.' }, { type: 'null' }] },
    items: {
      type: 'array',
      description: 'Line items. Omit loyalty and subtotal lines.',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          amount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
        required: ['description', 'amount'],
        additionalProperties: false,
      },
    },
    notes: { anyOf: [{ type: 'string', description: 'Anything unclear or worth flagging.' }, { type: 'null' }] },
  },
  required: ['is_receipt', 'merchant', 'date', 'total', 'gst', 'currency', 'category', 'payment_method', 'items', 'notes'],
  additionalProperties: false,
};

const PROMPT =
  'Extract the data from this receipt photo. The user is an Australian electrical ' +
  'apprentice organising work expenses. Pick the category that best matches the ' +
  'purchase. If a value is not printed or not readable, use null rather than guessing.';

async function extractReceipt(imageDataUrl) {
  const b64 = imageDataUrl.split(',')[1];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': getKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      output_config: { format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (body.stop_reason === 'refusal') throw new Error('The model declined to process this image.');
  if (body.stop_reason === 'max_tokens') throw new Error('Response was cut off — try a clearer photo.');
  const text = body.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No data returned.');
  return JSON.parse(text);
}

// ---- scan flow ---------------------------------------------------
$('btn-camera').addEventListener('click', () => {
  $('file-input').setAttribute('capture', 'environment');
  $('file-input').click();
});
$('btn-gallery').addEventListener('click', () => {
  $('file-input').removeAttribute('capture');
  $('file-input').click();
});

$('file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  if (!getKey()) {
    $('no-key-warning').hidden = false;
    return show('scan-status', 'Add your API key in Settings first.', 'bad');
  }

  show('scan-status', `Processing ${files.length} photo${files.length > 1 ? 's' : ''}…`);
  const queue = $('scan-queue');
  queue.innerHTML = '';
  let saved = 0, failed = 0;

  for (const file of files) {
    const row = document.createElement('div');
    row.className = 'q-item';
    row.innerHTML = '<img alt="" /><span class="q-name"></span><span class="q-state">reading…</span>';
    queue.appendChild(row);
    const state = row.querySelector('.q-state');
    try {
      const thumb = await loadScaled(file, 240, 0.7);
      row.querySelector('img').src = thumb;
      state.textContent = 'extracting…';
      const full = await loadScaled(file, 1568, 0.85);
      const data = await extractReceipt(full);
      if (!data.is_receipt) {
        row.classList.add('fail');
        state.textContent = 'not a receipt — skipped';
        failed++;
        continue;
      }
      const record = {
        id: crypto.randomUUID(),
        added: new Date().toISOString(),
        thumb,
        merchant: data.merchant || 'Unknown merchant',
        date: data.date,
        total: data.total,
        gst: data.gst,
        currency: data.currency || 'AUD',
        category: CATEGORIES.includes(data.category) ? data.category : 'Other',
        payment_method: data.payment_method,
        items: data.items || [],
        notes: data.notes,
      };
      await dbPut(record);
      row.classList.add('done');
      row.querySelector('.q-name').textContent = record.merchant;
      state.textContent = `${money(record.total, record.currency)} ✓`;
      saved++;
    } catch (err) {
      row.classList.add('fail');
      state.textContent = err.message.slice(0, 80);
      failed++;
    }
  }

  show('scan-status',
    `<b>${saved}</b> saved` + (failed ? `, ${failed} skipped/failed` : '') +
    (saved ? ' — see the Receipts tab.' : ''),
    failed && !saved ? 'bad' : 'ok');
});

// ---- receipts list -----------------------------------------------
let cache = [];   // all receipts, refreshed on demand
let currentView = [];

async function refreshCache() {
  cache = await dbAll();
  // newest date first; undated last
  cache.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function fillSelect(sel, values, current, labelFn = (v) => v) {
  sel.innerHTML = '<option value="">All</option>' +
    values.map((v) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(labelFn(v))}</option>`).join('');
}

async function renderList() {
  await refreshCache();
  const months = [...new Set(cache.map((r) => monthKey(r.date)))];
  fillSelect($('flt-month'), months, $('flt-month').value, monthLabel);
  fillSelect($('flt-cat'), CATEGORIES.filter((c) => cache.some((r) => r.category === c)), $('flt-cat').value);

  const q = $('flt-search').value.trim().toLowerCase();
  const m = $('flt-month').value;
  const c = $('flt-cat').value;

  currentView = cache.filter((r) => {
    if (m && monthKey(r.date) !== m) return false;
    if (c && r.category !== c) return false;
    if (q) {
      const hay = [r.merchant, r.notes, r.payment_method, ...(r.items || []).map((i) => i.description)]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const total = currentView.reduce((s, r) => s + (Number.isFinite(r.total) ? r.total : 0), 0);
  $('list-count').textContent = cache.length
    ? `${currentView.length} of ${cache.length} receipts · ${money(total)}`
    : 'No receipts yet — scan one from the first tab.';

  $('receipt-list').innerHTML = currentView.length
    ? currentView.map((r) => `
        <div class="r-row" data-id="${r.id}">
          <img src="${r.thumb}" alt="" />
          <div class="r-main">
            <div class="r-merchant">${esc(r.merchant)}</div>
            <div class="r-meta">${esc(r.date || 'no date')} · ${esc(r.category)}</div>
          </div>
          <div class="r-total">${money(r.total, r.currency)}</div>
        </div>`).join('')
    : '<p class="r-empty">Nothing matches the current filters.</p>';
}

['flt-search', 'flt-month', 'flt-cat'].forEach((id) =>
  $(id).addEventListener('input', () => renderList()));

$('receipt-list').addEventListener('click', (e) => {
  const row = e.target.closest('.r-row');
  if (row) openDetail(row.dataset.id);
});

// ---- detail / edit -----------------------------------------------
let editing = null;

function openDetail(id) {
  editing = cache.find((r) => r.id === id);
  if (!editing) return;
  $('d-thumb').src = editing.thumb || '';
  $('d-merchant').value = editing.merchant || '';
  $('d-date').value = editing.date || '';
  $('d-total').value = editing.total ?? '';
  $('d-gst').value = editing.gst ?? '';
  $('d-cat').innerHTML = CATEGORIES.map((c) =>
    `<option${c === editing.category ? ' selected' : ''}>${c}</option>`).join('');
  $('d-payment').value = editing.payment_method || '';
  $('d-notes').value = editing.notes || '';
  $('d-items').innerHTML = (editing.items || []).map((i) =>
    `<div class="d-item"><span>${esc(i.description)}</span><span>${Number.isFinite(i.amount) ? money(i.amount, editing.currency) : ''}</span></div>`
  ).join('');
  $('detail').showModal();
}

const num = (v) => {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

$('d-save').addEventListener('click', async () => {
  if (!editing) return;
  Object.assign(editing, {
    merchant: $('d-merchant').value.trim() || 'Unknown merchant',
    date: $('d-date').value || null,
    total: num($('d-total').value),
    gst: num($('d-gst').value),
    category: $('d-cat').value,
    payment_method: $('d-payment').value.trim() || null,
    notes: $('d-notes').value.trim() || null,
  });
  await dbPut(editing);
  $('detail').close();
  renderList();
});

$('d-delete').addEventListener('click', async () => {
  if (!editing) return;
  if (!confirm('Delete this receipt?')) return;
  await dbDelete(editing.id);
  $('detail').close();
  renderList();
});

$('d-close').addEventListener('click', () => $('detail').close());

// ---- totals -------------------------------------------------------
async function renderTotals() {
  await refreshCache();
  const byMonth = {};
  for (const r of cache) {
    const k = monthKey(r.date);
    (byMonth[k] ||= []).push(r);
  }
  const months = Object.keys(byMonth).sort().reverse();
  const sel = $('tot-month');
  const current = months.includes(sel.value) ? sel.value : months[0] || '';
  sel.innerHTML = months.map((m) =>
    `<option value="${m}"${m === current ? ' selected' : ''}>${esc(monthLabel(m))}</option>`).join('');

  const rs = byMonth[current] || [];
  const sum = (arr, f) => arr.reduce((s, r) => s + (Number.isFinite(f(r)) ? f(r) : 0), 0);
  $('tot-spend').textContent = rs.length ? money(sum(rs, (r) => r.total)) : '–';
  $('tot-gst').textContent = rs.length ? money(sum(rs, (r) => r.gst)) : '–';
  $('tot-count').textContent = rs.length || '–';

  const catTotals = CATEGORIES
    .map((c) => [c, sum(rs.filter((r) => r.category === c), (r) => r.total)])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxCat = catTotals[0]?.[1] || 1;
  $('tot-cats').innerHTML = catTotals.map(([c, v]) => `
    <div class="bar-row">
      <span class="bar-label">${esc(c)}</span>
      <div class="bar" style="width:${Math.max(2, (v / maxCat) * 100)}%"></div>
      <span class="bar-val">${money(v)}</span>
    </div>`).join('') || '<p class="r-empty">No receipts this month.</p>';

  const maxMonth = Math.max(1, ...months.map((m) => sum(byMonth[m], (r) => r.total)));
  $('tot-months').innerHTML = months.map((m) => {
    const v = sum(byMonth[m], (r) => r.total);
    return `
      <div class="bar-row">
        <span class="bar-label">${esc(monthLabel(m))}</span>
        <div class="bar" style="width:${Math.max(2, (v / maxMonth) * 100)}%"></div>
        <span class="bar-val">${money(v)}</span>
      </div>`;
  }).join('') || '<p class="r-empty">No receipts yet.</p>';
}
$('tot-month').addEventListener('change', renderTotals);

// ---- CSV export ----------------------------------------------------
function toCSV(rows) {
  const cols = ['date', 'merchant', 'category', 'total', 'gst', 'currency', 'payment_method', 'items', 'notes'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push([
      r.date, r.merchant, r.category, r.total, r.gst, r.currency, r.payment_method,
      (r.items || []).map((i) => i.amount != null ? `${i.description} (${i.amount})` : i.description).join('; '),
      r.notes,
    ].map(cell).join(','));
  }
  return lines.join('\r\n');
}

function downloadCSV(rows, name) {
  if (!rows.length) return alert('Nothing to export.');
  const blob = new Blob(['\uFEFF' + toCSV(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('btn-export').addEventListener('click', () =>
  downloadCSV(currentView, `receipts-${new Date().toISOString().slice(0, 10)}.csv`));
$('btn-export-all').addEventListener('click', async () => {
  await refreshCache();
  downloadCSV(cache, `receipts-all-${new Date().toISOString().slice(0, 10)}.csv`);
});

// ---- danger zone ----------------------------------------------------
$('btn-wipe').addEventListener('click', async () => {
  if (!confirm('Delete ALL receipts stored on this device? Export a CSV first if you need them.')) return;
  await dbClear();
  renderList();
  alert('All receipts deleted.');
});

// ---- init -----------------------------------------------------------
openDB().then(() => {
  $('set-key').value = getKey();
  $('no-key-warning').hidden = !!getKey();
});

// ---- service worker (offline shell) ----------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
