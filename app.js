'use strict';

// ---- helpers ----------------------------------------------------
const $ = (id) => document.getElementById(id);
const num = (id) => {
  const v = parseFloat($(id).value.replace(/,/g, '').trim());
  return Number.isFinite(v) ? v : null;
};
const fmt = (n, d = 2) => {
  if (!Number.isFinite(n)) return '–';
  const r = Math.round(n * 10 ** d) / 10 ** d;
  return r.toLocaleString('en-AU', { maximumFractionDigits: d });
};
const show = (id, html, state) => {
  const el = $(id);
  el.innerHTML = html;
  el.className = 'result' + (state ? ' ' + state : '');
};

// ---- tab navigation ---------------------------------------------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const go = tab.dataset.go;
    document.querySelectorAll('[data-screen]').forEach((s) => (s.hidden = s.id !== go));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    window.scrollTo(0, 0);
  });
});

// ---- Ohm's law / power wheel ------------------------------------
function calcOhms() {
  let V = num('ohm-v'), I = num('ohm-i'), R = num('ohm-r'), P = num('ohm-p');
  const known = [V, I, R, P].filter((x) => x !== null).length;
  if (known < 2) return show('ohm-result', 'Enter any two values.', 'bad');

  // Derive V & I first from whatever pair is given, then the rest.
  for (let pass = 0; pass < 3; pass++) {
    if (V === null && I !== null && R !== null) V = I * R;
    if (V === null && P !== null && I !== null) V = P / I;
    if (V === null && P !== null && R !== null) V = Math.sqrt(P * R);
    if (I === null && V !== null && R !== null) I = V / R;
    if (I === null && P !== null && V !== null) I = P / V;
    if (I === null && P !== null && R !== null) I = Math.sqrt(P / R);
    if (R === null && V !== null && I !== null) R = V / I;
    if (P === null && V !== null && I !== null) P = V * I;
  }
  if ([V, I, R, P].some((x) => x === null || !Number.isFinite(x)))
    return show('ohm-result', 'That combination can’t be solved — check your inputs.', 'bad');

  $('ohm-v').value = fmt(V, 3);
  $('ohm-i').value = fmt(I, 3);
  $('ohm-r').value = fmt(R, 3);
  $('ohm-p').value = fmt(P, 3);
  show('ohm-result',
    `<b>${fmt(V, 2)} V</b> · <b>${fmt(I, 3)} A</b> · <b>${fmt(R, 2)} Ω</b> · <b>${fmt(P, 2)} W</b>`,
    'ok');
}

// ---- Voltage drop solver (any 3 -> 4th) -------------------------
function calcVdrop() {
  const solveFor = $('vd-solve').value;
  const vd = num('vd-vd'), I = num('vd-i'), L = num('vd-l'), k = num('vd-k');
  const nominal = num('vd-nominal');
  const limitPct = num('vd-limit');

  let result, label, unit;
  if (solveFor === 'vd') {
    if (I === null || L === null || k === null) return need('vd-result');
    result = (L * I * k) / 1000; label = 'Voltage drop'; unit = 'V';
    $('vd-vd').value = fmt(result, 2);
  } else if (solveFor === 'i') {
    if (vd === null || L === null || k === null || L * k === 0) return need('vd-result');
    result = (vd * 1000) / (L * k); label = 'Current'; unit = 'A';
    $('vd-i').value = fmt(result, 2);
  } else if (solveFor === 'l') {
    if (vd === null || I === null || k === null || I * k === 0) return need('vd-result');
    result = (vd * 1000) / (I * k); label = 'Route length'; unit = 'm';
    $('vd-l').value = fmt(result, 2);
  } else {
    if (vd === null || I === null || L === null || I * L === 0) return need('vd-result');
    result = (vd * 1000) / (I * L); label = 'Required mV/A/m'; unit = 'mV/A/m';
    $('vd-k').value = fmt(result, 3);
  }

  // Drop voltage available for a % check (either the solved one or the entered one)
  const dropV = solveFor === 'vd' ? result : vd;
  let extra = '';
  if (dropV !== null && nominal) {
    const pct = (dropV / nominal) * 100;
    const pass = limitPct === null || pct <= limitPct;
    extra = `\nDrop = ${fmt(pct, 2)}% of ${fmt(nominal, 0)}V — ` +
      (pass ? `<span class="tag-ok">within ${fmt(limitPct, 1)}%</span>` : `<span class="tag-bad">exceeds ${fmt(limitPct, 1)}%</span>`);
    return show('vd-result', `<b>${label}: ${fmt(result, 2)} ${unit}</b>${extra}`, pass ? 'ok' : 'bad');
  }
  show('vd-result', `<b>${label}: ${fmt(result, 2)} ${unit}</b>`, 'ok');
}
function need(id) { show(id, 'Fill the other three fields.', 'bad'); }

// keep nominal voltage in step with phase choice
$('vd-phase').addEventListener('change', (e) => {
  $('vd-nominal').value = e.target.value === 'three' ? '400' : '230';
});

// ---- Three-phase ------------------------------------------------
function calcThree() {
  const VL = num('tp-vl'), IL = num('tp-il'), pf = num('tp-pf');
  if (VL === null || IL === null) return show('tp-result', 'Enter line voltage and line current.', 'bad');
  const root3 = Math.sqrt(3);
  const Vph = VL / root3;
  const S = root3 * VL * IL;            // VA
  $('tp-vph').value = fmt(Vph, 1);
  if (pf === null) {
    return show('tp-result', `<b>Apparent power S = ${fmt(S / 1000, 2)} kVA</b>\nPhase voltage = ${fmt(Vph, 1)} V\nAdd a power factor for kW / kVAR.`, 'ok');
  }
  const P = S * pf;                     // W
  const Q = Math.sqrt(Math.max(S * S - P * P, 0)); // VAR
  show('tp-result',
    `<b>P = ${fmt(P / 1000, 2)} kW</b> · S = ${fmt(S / 1000, 2)} kVA · Q = ${fmt(Q / 1000, 2)} kVAR\nPhase voltage = ${fmt(Vph, 1)} V · pf ${fmt(pf, 2)}`,
    'ok');
}

// ---- Conduit fill -----------------------------------------------
const cfWrap = $('cf-cables');
function addCable(d = '') {
  const row = document.createElement('div');
  row.className = 'cable-row';
  row.innerHTML =
    `<label>Cable Ø <span>mm (overall)</span>
       <input type="text" inputmode="decimal" class="cf-d" placeholder="e.g. 7.4" value="${d}" /></label>
     <button type="button" aria-label="Remove cable">✕</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  cfWrap.appendChild(row);
}
$('cf-add').addEventListener('click', () => addCable());
addCable(); addCable(); // start with two

function calcConduit() {
  const ID = num('cf-id');
  if (ID === null || ID <= 0) return show('cf-result', 'Enter the conduit internal diameter.', 'bad');
  const ds = [...document.querySelectorAll('.cf-d')]
    .map((el) => parseFloat(el.value)).filter((v) => Number.isFinite(v) && v > 0);
  if (!ds.length) return show('cf-result', 'Add at least one cable diameter.', 'bad');

  const area = (d) => (Math.PI / 4) * d * d;
  const conduitCSA = area(ID);
  const cablesCSA = ds.reduce((s, d) => s + area(d), 0);
  const fill = (cablesCSA / conduitCSA) * 100;
  const limit = ds.length === 1 ? 53 : ds.length === 2 ? 31 : 40;
  const pass = fill <= limit;
  show('cf-result',
    `<b>Fill = ${fmt(fill, 1)}%</b> (${ds.length} cable${ds.length > 1 ? 's' : ''})\nLimit ${limit}% — ` +
    (pass ? '<span class="tag-ok">OK</span>' : '<span class="tag-bad">over — size up the conduit</span>') +
    `\nCable CSA ${fmt(cablesCSA, 1)} mm² of ${fmt(conduitCSA, 1)} mm²`,
    pass ? 'ok' : 'bad');
}

// ---- Deratings --------------------------------------------------
function calcDerate() {
  const base = num('dr-base');
  const load = num('dr-load');
  const ka = num('dr-ka') ?? 1, kg = num('dr-kg') ?? 1, ki = num('dr-ki') ?? 1, ko = num('dr-ko') ?? 1;
  if (base === null) return show('dr-result', 'Enter the base current-carrying capacity.', 'bad');
  const derated = base * ka * kg * ki * ko;
  let line = `<b>Derated capacity = ${fmt(derated, 1)} A</b>\nBase ${fmt(base, 1)} A × ${fmt(ka, 2)} × ${fmt(kg, 2)} × ${fmt(ki, 2)} × ${fmt(ko, 2)}`;
  if (load !== null) {
    const pass = derated >= load;
    line += `\nDesign load ${fmt(load, 1)} A — ` +
      (pass ? '<span class="tag-ok">cable OK</span>' : '<span class="tag-bad">undersized — size up</span>');
    return show('dr-result', line, pass ? 'ok' : 'bad');
  }
  show('dr-result', line, 'ok');
}

// ---- wiring buttons ---------------------------------------------
const calcs = { ohms: calcOhms, vdrop: calcVdrop, three: calcThree, conduit: calcConduit, derate: calcDerate };
document.querySelectorAll('[data-calc]').forEach((b) =>
  b.addEventListener('click', () => calcs[b.dataset.calc]()));

const clearSets = {
  ohms: ['ohm-v', 'ohm-i', 'ohm-r', 'ohm-p', 'ohm-result'],
  vdrop: ['vd-vd', 'vd-i', 'vd-l', 'vd-k', 'vd-result'],
  three: ['tp-vl', 'tp-il', 'tp-pf', 'tp-vph', 'tp-result'],
  conduit: ['cf-id', 'cf-result'],
  derate: ['dr-base', 'dr-load', 'dr-result'],
};
document.querySelectorAll('[data-clear]').forEach((b) =>
  b.addEventListener('click', () => {
    (clearSets[b.dataset.clear] || []).forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (el.classList.contains('result')) { el.innerHTML = ''; el.className = 'result'; }
      else el.value = '';
    });
    if (b.dataset.clear === 'derate') ['dr-ka', 'dr-kg', 'dr-ki', 'dr-ko'].forEach((id) => ($(id).value = '1.00'));
  }));

// ---- Ask a standard ---------------------------------------------
// Signposts only: point to the standard + clause and give light orientation.
// Deliberately does NOT hand over the regulated figures — apprentices read,
// learn, and the licensed person carries final responsibility.
const KB = [
  { q: 'Maximum voltage drop allowed?', topic: 'Voltage drop limits',
    std: 'AS/NZS 3000 — Clause 3.6.2', tool: 'vdrop',
    gist: 'The maximum permissible voltage drop and how it is shared across the installation.',
    keys: 'voltage drop volt drop vd percent max limit run length' },
  { q: 'RCD required on power points / lighting?', topic: 'Additional protection (RCDs)',
    std: 'AS/NZS 3000 — Section 2.6',
    gist: 'Which final subcircuits need RCD protection and the maximum trip current.',
    keys: 'rcd safety switch power point gpo socket lighting protection trip ma' },
  { q: 'Cable identification colours', topic: 'Conductor identification',
    std: 'AS/NZS 3000 — Clause 3.8',
    gist: 'Approved colours for active, neutral and earth, including three-phase.',
    keys: 'cable colour color active neutral earth phase identification wire' },
  { q: 'Conduit fill / cable space factor', topic: 'Wiring enclosures — space factor',
    std: 'AS/NZS 3000 — Section 3', tool: 'conduit',
    gist: 'Permissible cable space factor for the number of cables in an enclosure.',
    keys: 'conduit fill space factor enclosure how many cables duct' },
  { q: 'Automatic disconnection times', topic: 'Earth fault — disconnection times',
    std: 'AS/NZS 3000 — Section 1.5 & Section 5',
    gist: 'Required disconnection times by circuit type and earthing arrangement.',
    keys: 'disconnection time fault clearance seconds earthing loop impedance' },
  { q: 'What does an IP rating mean?', topic: 'Ingress protection ratings',
    std: 'AS 60529',
    gist: 'What each IP digit certifies against solids/dust and against water.',
    keys: 'ip rating ingress protection dust water ip65 ip66 ip44 degrees' },
  { q: 'Standard supply voltages (single / three phase)', topic: 'Standard voltages',
    std: 'AS 60038', tool: 'three',
    gist: 'Nominal supply voltages and the line-to-phase relationship.',
    keys: 'voltage 230 400 415 single three phase nominal supply line' },
  { q: 'GPO / switch mounting heights', topic: 'Mounting heights & accessibility',
    std: 'AS/NZS 3000 + AS 1428.1',
    gist: '3000 sets no general height; AS 1428.1 governs accessible heights — check the job spec.',
    keys: 'gpo height power point switch socket mounting accessible 1428' },
  { q: 'Main earthing conductor sizing', topic: 'Earthing — conductor sizing',
    std: 'AS/NZS 3000 — Section 5 (Table 5.1)',
    gist: 'Sizing the main earthing conductor from the active conductor size.',
    keys: 'earth size main earthing conductor protective ground table 5.1 men' },
  { q: 'Maximum demand (domestic)', topic: 'Maximum demand assessment',
    std: 'AS/NZS 3000 — Appendix C',
    gist: 'The assessment (column) method for maximum demand by load group.',
    keys: 'maximum demand max demand load assessment domestic column method' },
  { q: 'Cable current-carrying capacity / sizing', topic: 'Current-carrying capacity',
    std: 'AS/NZS 3008.1.1', tool: 'conduit',
    gist: 'Base current ratings, then derating for temperature, grouping and install method.',
    keys: 'cable size current carrying capacity ccc rating ampacity derate 3008' },
  { q: 'Minimum cable size for a circuit', topic: 'Selecting cable size',
    std: 'AS/NZS 3008 + AS/NZS 3000', tool: 'vdrop',
    gist: 'Driven by current-carrying capacity AND voltage drop for the actual load.',
    keys: 'minimum cable size lighting power 2.5 1.5 csa select circuit' },
  { q: 'MEN / earthing system requirements', topic: 'Earthing system (MEN)',
    std: 'AS/NZS 3000 — Section 5',
    gist: 'Multiple Earthed Neutral system requirements and connections.',
    keys: 'men earthing system neutral earth bond section 5 equipotential' },
  { q: 'Power factor explained', topic: 'Power factor fundamentals',
    std: 'Fundamentals (no single clause)', tool: 'three',
    gist: 'Real vs apparent power; power factor = cosφ.',
    keys: 'power factor cos phi kw kva reactive' },
];

const TOOL_NAMES = { vdrop: 'Voltage Drop', three: 'Three-Phase', conduit: 'Conduit & Deratings', ohms: "Ohm's Law" };
const askInput = $('ask-input');
const askResults = $('ask-results');

function askSearch(q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return KB
    .map((e) => {
      const hay = (e.q + ' ' + e.topic + ' ' + e.keys).toLowerCase();
      return { e, score: tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.e);
}

function askRenderList(list) {
  if (!list.length) {
    askResults.innerHTML = '<div class="ask-sug" data-empty>No match yet — try “voltage drop”, “RCD”, “conduit”, “colours”, “earthing”.</div>';
  } else {
    askResults.innerHTML = list
      .map((e) => `<div class="ask-sug" data-i="${KB.indexOf(e)}"><span class="sug-q">${e.q}</span><span class="sug-std">${e.std}</span></div>`)
      .join('');
  }
  askResults.hidden = false;
}

function askRenderAnswer(e) {
  const openBtn = e.tool
    ? `<button class="btn open" data-open="${e.tool}">Open ${TOOL_NAMES[e.tool]} calc →</button>`
    : '';
  askResults.innerHTML =
    `<div class="ask-answer">
       <p class="topic">${e.topic}</p>
       <p class="std">📖 ${e.std}</p>
       <p class="gist">${e.gist}</p>
       ${openBtn}
       <p class="own">Read the clause and learn it — once you're licensed this is yours to know, and final responsibility always sits with the licensed person.</p>
     </div>`;
  askResults.hidden = false;
}

askInput.addEventListener('input', () => {
  const q = askInput.value.trim();
  if (q.length < 2) { askResults.hidden = true; askResults.innerHTML = ''; return; }
  askRenderList(askSearch(q));
});
askInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    const top = askSearch(askInput.value.trim())[0];
    if (top) askRenderAnswer(top);
  }
});
askResults.addEventListener('click', (ev) => {
  ev.stopPropagation(); // keep the "tap outside to close" handler from firing on our own clicks
  const sug = ev.target.closest('.ask-sug');
  if (sug && sug.dataset.i !== undefined) return askRenderAnswer(KB[+sug.dataset.i]);
  const open = ev.target.closest('[data-open]');
  if (open) {
    document.querySelector(`.tab[data-go="${open.dataset.open}"]`).click();
    askResults.hidden = true;
    askInput.value = '';
  }
});
document.addEventListener('click', (ev) => {
  if (!$('ask').contains(ev.target)) askResults.hidden = true;
});

// ---- service worker (offline) -----------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
