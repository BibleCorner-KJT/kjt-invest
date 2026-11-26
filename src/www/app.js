/* KJT Invest 1.7 (Knowing Jesus Today) - one screen code for the Android and Linux apps.
   All data stays in one SQLite file on the device. The only network calls are the
   price updates (metal prices from gold-api.com, exchange rates from the European Central Bank). */
'use strict';

const APP_VERSION = '1.7';
const SCHEMA = 6;
const OZT_G = 31.1034768;
const METALS = [
  { sym: 'XAU', name: 'Gold', purity: 0.9999 },
  { sym: 'XAG', name: 'Silver', purity: 0.999 },
  { sym: 'XPT', name: 'Platinum', purity: 0.9995 },
  { sym: 'XPD', name: 'Palladium', purity: 0.9995 },
];
const METAL = Object.fromEntries(METALS.map(m => [m.sym, m]));
const UNITS = { ozt: 'troy oz', g: 'grams', kg: 'kilograms' };
const COMMON_CUR = ['CAD', 'USD', 'EUR', 'GBP', 'CHF', 'AUD', 'JPY'];
/* property types and their icons (simple line drawings, 24x24) */
const PROP_TYPES = {
  house: ['House', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'],
  apartment: ['Apartment', '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M11 21v-3h2v3"/>'],
  condo: ['Condo', '<path d="M4 21V8l6-4v17M10 21V10h10v11M3 21h18"/><path d="M13 13h1M16 13h1M13 17h1M16 17h1M6.5 10h1M6.5 14h1"/>'],
  multiplex: ['Duplex / multiplex', '<path d="M2 11l5-5 5 5 5-5 5 5"/><path d="M4 9v11h16V9M12 11v9M7 20v-4M17 20v-4"/>'],
  cottage: ['Cottage', '<path d="M3 13l9-9 9 9"/><path d="M5 11v9h14v-9M10 20v-5h4v5M16 6V3h2v5"/>'],
  land: ['Land', '<path d="M3 19l6-8 4 5 3-3 5 6z"/><circle cx="17" cy="7" r="2"/>'],
  commercial: ['Commercial', '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9c0 1.5 1.3 2.5 3 2.5S9 10.5 9 9c0 1.5 1.3 2.5 3 2.5s3-1 3-2.5c0 1.5 1.3 2.5 3 2.5S21 10.5 21 9"/><path d="M5 11.5V20h14v-8.5M10 20v-5h4v5"/>'],
  other: ['Other', '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 12h6M12 9v6"/>'],
};
const propIcon = (t, size) => `<svg class="picon" viewBox="0 0 24 24" width="${size || 26}" height="${size || 26}" aria-hidden="true">${(PROP_TYPES[t] || PROP_TYPES.house)[1]}</svg>`;
const ACCT_TYPES = { chequing: 'Chequing', savings: 'Savings', cash: 'Cash', gic: 'GIC / term deposit', other: 'Other' };
const COSTS = [
  ['condo_fees', 'Condo fees'], ['insurance', 'Insurance'], ['municipal_tax', 'Municipal taxes'],
  ['school_tax', 'School taxes'], ['other_costs', 'Other costs (repairs, maintenance)'],
];

/* ---------------- native bridge (Android, Linux, or a plain browser for testing) ---------------- */
const pending = new Map();
let nextId = 1;
window.__nativeReply = function (id, payload) {
  const p = pending.get(String(id)); if (!p) return;
  pending.delete(String(id));
  let data = payload;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = { error: 'bad reply' }; } }
  p(data || {});
};
const LEAVES_APP = ['exportDb', 'importDb', 'bioUnlock', 'bioEnable'];
function native(cmd, args) {
  const away = LEAVES_APP.includes(cmd);
  if (away) nativeBusy++;
  return new Promise(resolve => {
    const id = String(nextId++);
    pending.set(id, away ? (d => { setTimeout(() => { nativeBusy--; }, 1500); resolve(d); }) : resolve);
    const json = JSON.stringify(args || {});
    if (window.AndroidNative) window.AndroidNative.call(id, cmd, json);
    else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native)
      window.webkit.messageHandlers.native.postMessage(JSON.stringify({ id, cmd, args: args || {} }));
    else browserNative(id, cmd, args || {});
  });
}
async function browserNative(id, cmd, a) {
  const reply = d => window.__nativeReply(id, d);
  try {
    if (cmd === 'loadDb') reply({ b64: localStorage.getItem('it-db') });
    else if (cmd === 'saveDb') { localStorage.setItem('it-db', a.b64); reply({ ok: true }); }
    else if (cmd === 'getPrefs') reply({ json: localStorage.getItem('it-prefs') || '{}' });
    else if (cmd === 'setPrefs') { localStorage.setItem('it-prefs', a.json); reply({ ok: true }); }
    else if (cmd === 'secure' || cmd === 'bioDisable' || cmd === 'statusBar' || cmd === 'openUrl') reply({ ok: true });
    else if (cmd === 'appInfo') reply({ platform: 'browser', version: APP_VERSION });
    else if (cmd === 'bioAvailable') reply({ available: false });
    else if (cmd === 'httpGet') { const r = await fetch(a.url); reply({ status: r.status, body: await r.text() }); }
    else if (cmd === 'exportDb') {
      const link = document.createElement('a'); link.href = 'data:application/x-sqlite3;base64,' + a.b64; link.download = a.name; link.click();
      reply({ ok: true, where: 'Downloads' });
    } else if (cmd === 'importDb') {
      const inp = document.createElement('input'); inp.type = 'file';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return reply({}); const fr = new FileReader();
        fr.onload = () => reply({ b64: String(fr.result).split(',')[1] }); fr.readAsDataURL(f); };
      inp.click();
    } else reply({ error: 'unknown' });
  } catch (e) { reply({ error: String(e) }); }
}
function b64ToBytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function bytesToB64(u) { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }

/* ---------------- database ---------------- */
let SQL, db;
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS prices (symbol TEXT PRIMARY KEY, price REAL, currency TEXT, updated TEXT, source TEXT);
CREATE TABLE IF NOT EXISTS fx (currency TEXT PRIMARY KEY, per_eur REAL, updated TEXT, source TEXT);
CREATE TABLE IF NOT EXISTS metal_holdings (id INTEGER PRIMARY KEY, metal TEXT NOT NULL, description TEXT, quantity REAL DEFAULT 1,
  weight REAL, unit TEXT DEFAULT 'ozt', purity REAL DEFAULT 1, form TEXT DEFAULT 'coin', cost REAL, commission REAL DEFAULT 0, shipping REAL DEFAULT 0, other_fees REAL DEFAULT 0,
  currency TEXT, purchase_date TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT, currency TEXT, purchase_date TEXT,
  purchase_price REAL, purchase_costs REAL DEFAULT 0, current_value REAL, notes TEXT, owners INTEGER DEFAULT 1, type TEXT DEFAULT 'house');
CREATE TABLE IF NOT EXISTS rent_periods (id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, end_date TEXT, monthly_rent REAL NOT NULL, tenant TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS property_years (id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  year INTEGER NOT NULL, rent REAL DEFAULT 0, condo_fees REAL DEFAULT 0, insurance REAL DEFAULT 0, municipal_tax REAL DEFAULT 0,
  school_tax REAL DEFAULT 0, other_costs REAL DEFAULT 0, value_end REAL, notes TEXT, UNIQUE(property_id, year));
CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'savings', institution TEXT, currency TEXT,
  interest_rate REAL, owners INTEGER DEFAULT 1, notes TEXT);
CREATE TABLE IF NOT EXISTS account_balances (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL, balance REAL NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS source_quotes (source TEXT NOT NULL, kind TEXT NOT NULL, code TEXT NOT NULL, value REAL NOT NULL, updated TEXT,
  PRIMARY KEY(source, kind, code));
CREATE TABLE IF NOT EXISTS property_items (id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, amount REAL NOT NULL, freq TEXT NOT NULL, start_date TEXT, end_date TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS property_values (id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  date TEXT NOT NULL, value REAL NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS other_assets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'other', purchase_date TEXT,
  purchase_price REAL, currency TEXT, owners INTEGER DEFAULT 1, notes TEXT);
CREATE TABLE IF NOT EXISTS asset_values (id INTEGER PRIMARY KEY, asset_id INTEGER NOT NULL REFERENCES other_assets(id) ON DELETE CASCADE,
  date TEXT NOT NULL, value REAL NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS price_history (symbol TEXT NOT NULL, date TEXT NOT NULL, price REAL NOT NULL, source TEXT, PRIMARY KEY(symbol, date));
CREATE TABLE IF NOT EXISTS fx_history (currency TEXT NOT NULL, date TEXT NOT NULL, per_eur REAL NOT NULL, PRIMARY KEY(currency, date));
`;
function q(sql, params) {
  const st = db.prepare(sql); const out = [];
  try { if (params) st.bind(params); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
  return out;
}
function run(sql, params) { db.run(sql, params || []); }
function bulk(sql, rows) {   /* many rows with one prepared statement, in one transaction */
  const st = db.prepare(sql); db.exec('BEGIN');
  try { for (const r of rows) { st.run(r); } db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } finally { st.free(); }
}
function getSetting(k, d) { const r = q('SELECT value FROM settings WHERE key=?', [k]); return r.length ? r[0].value : d; }
function setSetting(k, v) { run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, String(v)]); }
function prepareDb() {
  run('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  if (!getSetting('app')) { setSetting('app', 'investment-tracker'); setSetting('schema', SCHEMA); setSetting('home_currency', 'CAD'); setSetting('auto_prices', '1'); }
  /* 1.1: purchase fees on metals (databases from 1.0, also when imported) */
  const cols = q('PRAGMA table_info(metal_holdings)').map(r => r.name);
  for (const c of ['commission', 'shipping', 'other_fees']) if (!cols.includes(c)) run(`ALTER TABLE metal_holdings ADD COLUMN ${c} REAL DEFAULT 0`);
  if (!cols.includes('form')) run("ALTER TABLE metal_holdings ADD COLUMN form TEXT DEFAULT 'coin'");
  if (!getSetting('metal_currency')) setSetting('metal_currency', 'USD');
  /* 1.2: co-owners */
  const pcols = q('PRAGMA table_info(properties)').map(r => r.name);
  if (!pcols.includes('owners')) run('ALTER TABLE properties ADD COLUMN owners INTEGER DEFAULT 1');
  if (!pcols.includes('type')) run("ALTER TABLE properties ADD COLUMN type TEXT DEFAULT 'house'");
  /* 1.4: the yearly amounts of earlier versions become yearly items for that year; year-end values become value entries */
  if (!getSetting('items_migrated')) {
    for (const y of q('SELECT * FROM property_years')) {
      const a = y.year + '-01-01', b = y.year + '-12-31';
      for (const [col, kind] of [['condo_fees', 'condo_fees'], ['insurance', 'insurance'], ['municipal_tax', 'municipal_tax'], ['school_tax', 'school_tax'], ['other_costs', 'other_cost'], ['rent', 'other_income']])
        if (y[col] > 0) run('INSERT INTO property_items(property_id,kind,amount,freq,start_date,end_date,note) VALUES(?,?,?,?,?,?,?)', [y.property_id, kind, y[col], 'yearly', a, b, 'from ' + y.year + ' (earlier version)']);
      if (y.value_end != null) run('INSERT INTO property_values(property_id,date,value,note) VALUES(?,?,?,?)', [y.property_id, b, y.value_end, 'Year-end value']);
    }
    for (const p of q('SELECT * FROM properties WHERE current_value IS NOT NULL'))
      if (!q('SELECT id FROM property_values WHERE property_id=? AND date>=?', [p.id, today()]).length) run('INSERT INTO property_values(property_id,date,value,note) VALUES(?,?,?,?)', [p.id, today(), p.current_value, 'Your estimate']);
    setSetting('items_migrated', '1');
  }
  if (+getSetting('schema', 1) < SCHEMA) setSetting('schema', SCHEMA);
}
function isOurDb(candidate) {
  try { const r = candidate.exec("SELECT value FROM settings WHERE key='app'"); return r.length && r[0].values[0][0] === 'investment-tracker'; }
  catch (e) { return false; }
}
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
async function fileBytes() { const plain = db.export(); return CRYPT ? encryptBytes(plain) : plain; }   /* what goes into the file */
async function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  const r = await native('saveDb', { b64: bytesToB64(await fileBytes()) });
  if (r.error) toast('Could not save: ' + r.error);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) saveNow(); });

/* ---------------- money ---------------- */
const home = () => getSetting('home_currency', 'CAD');
const mcur = () => getSetting('metal_currency', 'USD');   // the currency metals are shown in
let FX = {};
function loadFx() { FX = { EUR: 1 }; for (const r of q('SELECT currency, per_eur FROM fx')) FX[r.currency] = r.per_eur; }
function conv(amount, from, to) {
  if (amount == null || isNaN(amount)) return null;
  from = from || home(); to = to || home();
  if (from === to) return amount;
  if (!FX[from] || !FX[to]) return null;
  return amount / FX[from] * FX[to];
}
function spot(sym) { const r = q('SELECT price, currency, updated FROM prices WHERE symbol=?', [sym]); return r.length ? r[0] : null; }
function spotIn(sym, cur) { const s = spot(sym); return s ? conv(s.price, s.currency, cur) : null; }
const fmtCache = {};
function money(v, cur, opts) {
  cur = cur || home();
  if (v == null || isNaN(v)) return '—';
  const key = cur + (opts && opts.dec);
  if (!fmtCache[key]) {
    try { fmtCache[key] = new Intl.NumberFormat('en-CA', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: opts && opts.dec != null ? opts.dec : 2, minimumFractionDigits: opts && opts.dec != null ? opts.dec : 2 }); }
    catch (e) { fmtCache[key] = { format: x => cur + ' ' + x.toFixed(2) }; }
  }
  let s = fmtCache[key].format(v);
  if (cur !== home() && cur !== 'USD' && cur !== 'EUR' && cur !== 'GBP') s += ' ' + cur;
  else if (cur === 'USD' && home() !== 'USD' && !/US/.test(s)) s = s.replace('$', 'US$');
  return s;
}
const whole = (v, cur) => money(v, cur, { dec: 0 });
function pct(v) { if (v == null || !isFinite(v)) return '—'; return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }
function signCls(v) { return v == null ? '' : v >= 0 ? 'up' : 'down'; }
function num(s) {
  if (s == null) return null; s = String(s).trim().replace(/[\s$€£]/g, '').replace(/,/g, '');
  if (s === '') return null; const n = Number(s); return isFinite(n) ? n : NaN;
}
function fmtNum(v, maxDec) {   /* 12345.5 -> "12,345.5" for input boxes */
  if (v == null || v === '' || isNaN(v)) return '';
  return Number(v).toLocaleString('en-CA', { maximumFractionDigits: maxDec == null ? 6 : maxDec, useGrouping: true });
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function curOptions(sel) {
  const set = new Set(COMMON_CUR.concat(Object.keys(FX)).concat([sel, home()]).filter(Boolean));
  return Array.from(set).sort().map(c => `<option${c === sel ? ' selected' : ''}>${c}</option>`).join('');
}
function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function when(iso) {
  if (!iso) return 'never';
  const d = new Date(iso); if (isNaN(d)) return iso;
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 2) return 'just now'; if (mins < 60) return mins + ' min ago';
  if (mins < 60 * 24) return Math.round(mins / 60) + ' h ago';
  return d.toLocaleDateString('en-CA');
}

/* ---------------- calculations ---------------- */
function pureOz(h) {
  const w = (h.weight || 0) * (h.unit === 'g' ? 1 / OZT_G : h.unit === 'kg' ? 1000 / OZT_G : 1);
  return (h.quantity || 0) * w * (h.purity == null ? 1 : h.purity);
}
function holdingStats(h) {
  const oz = pureOz(h);
  const priceIn = spotIn(h.metal, h.currency || home());
  const value = priceIn == null ? null : oz * priceIn;            // in the holding's own currency
  const fees = (h.commission || 0) + (h.shipping || 0) + (h.other_fees || 0);
  const cost = h.cost == null && !fees ? null : (h.cost || 0) + fees;   // what it really cost, fees included
  const gain = value == null || cost == null ? null : value - cost;
  return { oz, value, fees, cost, gain, gainPct: gain == null || !cost ? null : gain / cost,
    valueHome: conv(value, h.currency, home()), costHome: conv(cost, h.currency, home()),
    valueM: conv(value, h.currency, mcur()), costM: conv(cost, h.currency, mcur()) };
}
/* dates as 'YYYY-MM-DD' strings; day numbers for counting */
const dnum = s => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
const dstr = n => new Date(n * 864e5).toISOString().slice(0, 10);
function fmtDate(s, short) {
  if (!s) return '';
  return new Date(s + 'T12:00:00').toLocaleDateString('en-CA', short ? { year: 'numeric', month: 'short' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
/* ---------------- real estate: money in and out, month by month ----------------
   Rent comes from the rent periods (a monthly rent between two dates). Every other cost or income is an
   item with how often it is paid: monthly (e.g. condo fees, due whether the unit is rented or not),
   yearly (e.g. insurance, taxes: spread over the months), or once (e.g. a repair, in its month). */
const PITEMS = {
  condo_fees: ['Condo fees', 'cost', 'monthly'], insurance: ['Insurance', 'cost', 'yearly'],
  municipal_tax: ['Municipal taxes', 'cost', 'yearly'], school_tax: ['School taxes', 'cost', 'yearly'],
  utilities: ['Utilities (heat, power, water)', 'cost', 'monthly'], management: ['Management fees', 'cost', 'monthly'],
  repairs: ['Repairs & maintenance', 'cost', 'once'], other_cost: ['Other cost', 'cost', 'monthly'],
  other_income: ['Other income (parking, laundry…)', 'income', 'monthly'],
};
const FREQ = { monthly: 'a month', yearly: 'a year', once: 'once' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthBounds(y, m) {   /* m 0-11 -> first and last day numbers */
  const a = dnum(`${y}-${String(m + 1).padStart(2, '0')}-01`);
  const b = dnum(m === 11 ? `${y + 1}-01-01` : `${y}-${String(m + 2).padStart(2, '0')}-01`) - 1;
  return [a, b];
}
function monthFlow(p, periods, items, y, m) {
  const [a, b] = monthBounds(y, m), days = b - a + 1;
  const own0 = p.purchase_date ? dnum(p.purchase_date) : -Infinity, oa = Math.max(a, own0);
  const out = { y, m, owned: 0, rent: 0, rented: 0, income: 0, costs: 0, byKind: {}, future: a > dnum(today()) };
  if (oa > b) return out;
  out.owned = (b - oa + 1) / days;
  for (const r of periods) {
    const s = dnum(r.start_date), e = r.end_date ? dnum(r.end_date) : Infinity;
    const lo = Math.max(oa, s), hi = Math.min(b, e); if (hi < lo) continue;
    out.rent += (r.monthly_rent || 0) * (hi - lo + 1) / days; out.rented += (hi - lo + 1) / days;
  }
  for (const it of items) {
    const meta = PITEMS[it.kind] || PITEMS.other_cost, s = it.start_date ? dnum(it.start_date) : own0, e = it.end_date ? dnum(it.end_date) : Infinity;
    let v = 0;
    if (it.freq === 'once') { if (s >= oa && s <= b) v = it.amount || 0; }
    else { const lo = Math.max(oa, s), hi = Math.min(b, e); if (hi >= lo) v = (it.amount || 0) * (it.freq === 'yearly' ? 1 / 12 : 1) * (hi - lo + 1) / days; }
    if (!v) continue;
    if (meta[1] === 'income') out.income += v; else out.costs += v;
    out.byKind[it.kind] = (out.byKind[it.kind] || 0) + v;
  }
  out.empty = Math.max(0, out.owned - out.rented);
  out.net = out.rent + out.income - out.costs;
  return out;
}
function propertyValues(p) {   /* [[date, value]]: the purchase, then your estimates */
  const an = [[p.purchase_date || '0000-01-01', p.purchase_price || 0]];
  for (const r of q('SELECT date, value FROM property_values WHERE property_id=? ORDER BY date, id', [p.id])) an.push([r.date, r.value]);
  if (an.length === 1 && p.current_value != null) an.push([today(), p.current_value]);   /* a value typed in before 1.4 */
  return an.sort((x, z) => x[0] < z[0] ? -1 : x[0] > z[0] ? 1 : 0);
}
function propertyStats(p) {
  const periods = q('SELECT * FROM rent_periods WHERE property_id=? ORDER BY start_date', [p.id]);
  const items = q('SELECT * FROM property_items WHERE property_id=? ORDER BY start_date', [p.id]);
  const owners = Math.max(1, p.owners || 1), share = 1 / owners;
  const invested = (p.purchase_price || 0) + (p.purchase_costs || 0);
  const anchors = propertyValues(p), now = today(), nowY = +now.slice(0, 4), nowM = +now.slice(5, 7) - 1;
  let y0 = p.purchase_date ? +p.purchase_date.slice(0, 4) : nowY;
  for (const r of periods) y0 = Math.min(y0, +r.start_date.slice(0, 4));
  for (const it of items) if (it.start_date) y0 = Math.min(y0, +it.start_date.slice(0, 4));
  const years = []; let sumNet = 0;
  for (let y = y0; y <= nowY; y++) {
    const months = MONTHS.map((_, m) => monthFlow(p, periods, items, y, m));
    const done = months.filter(f => !f.future);
    const add = (list, k) => list.reduce((s, f) => s + f[k], 0);
    const yr = { year: y, months, current: y === nowY,
      rent: add(done, 'rent'), income: add(done, 'income'), costs: add(done, 'costs'), empty: add(done, 'empty'),
      fullRent: add(months, 'rent'), fullIncome: add(months, 'income'), fullCosts: add(months, 'costs') };
    yr.net = yr.rent + yr.income - yr.costs; yr.fullNet = yr.fullRent + yr.fullIncome - yr.fullCosts;
    yr.byKind = {}; for (const f of done) for (const [k, v] of Object.entries(f.byKind)) yr.byKind[k] = (yr.byKind[k] || 0) + v;
    if (!done.some(f => f.owned) && !yr.rent && !yr.costs) continue;
    const startD = p.purchase_date && p.purchase_date > `${y}-01-01` ? p.purchase_date : `${y - 1}-12-31`;
    const endD = y === nowY ? now : `${y}-12-31`;
    yr.valueStart = interp(anchors, startD) || (p.purchase_price || 0); yr.valueEnd = interp(anchors, endD);
    yr.valChange = anchors.length > 1 ? yr.valueEnd - yr.valueStart : null;
    yr.cash = invested ? yr.net / invested : null;
    yr.total = yr.valChange == null || !invested ? null : (yr.net + yr.valChange) / invested;
    sumNet += yr.net; years.push(yr);
  }
  const value = anchors.length > 1 ? anchors[anchors.length - 1][1] : (p.current_value != null ? p.current_value : p.purchase_price || 0);
  const valueGain = value - (p.purchase_price || 0);
  const gain = sumNet + valueGain - (p.purchase_costs || 0);
  const overall = invested ? gain / invested : null;
  let yearsHeld = null, annual = null;
  if (p.purchase_date) { yearsHeld = (Date.now() - new Date(p.purchase_date)) / (365.25 * 864e5); if (yearsHeld >= 1 && overall > -1) annual = Math.pow(1 + overall, 1 / yearsHeld) - 1; }
  const full = years.filter(r => !r.current), last = full.length ? full[full.length - 1] : years.length ? years[years.length - 1] : null;
  /* the last 12 months, for a "per month" figure */
  const last12 = []; for (const yr of years) for (const f of yr.months) if (!f.future && f.owned) last12.push(f);
  const l12 = last12.slice(-12), perMonth = l12.length ? l12.reduce((s, f) => s + f.net, 0) / l12.length : null;
  return { rows: years, periods, items, anchors, owners, share, invested, value, valueGain, sumNet, gain, overall, annual, yearsHeld, last, perMonth,
    avgCash: full.length ? full.reduce((s, r) => s + (r.cash || 0), 0) / full.length : null };
}
function acctBalance(id) { const r = q('SELECT * FROM account_balances WHERE account_id=? ORDER BY date DESC, id DESC LIMIT 1', [id]); return r[0] || null; }
function totals() {
  const H = home(); let metals = 0, metalsCost = 0, metalsM = 0, metalsCostM = 0, missing = false;
  for (const h of q('SELECT * FROM metal_holdings')) {
    const s = holdingStats(h);
    if (s.valueHome == null || s.valueM == null) { missing = true; continue; }
    metals += s.valueHome; if (s.costHome != null) metalsCost += s.costHome;
    metalsM += s.valueM; if (s.costM != null) metalsCostM += s.costM;
  }
  let re = 0, reInvested = 0, reIncome = 0, reLastNet = 0, reLastYear = null;
  for (const p of q('SELECT * FROM properties')) {
    const s = propertyStats(p);
    const k = s.share;   /* your share when the property has several owners */
    const v = conv(s.value * k, p.currency, H), inv = conv(s.invested * k, p.currency, H), inc = conv(s.sumNet * k, p.currency, H);
    if (v == null) { missing = true; continue; }
    re += v; reInvested += inv; reIncome += inc;
    if (s.last) { const ly = s.last.year; const n = conv(s.last.net * k, p.currency, H);
      if (reLastYear == null || ly > reLastYear) { reLastYear = ly; reLastNet = n; } else if (ly === reLastYear) reLastNet += n; }
  }
  let cash = 0;
  for (const a of q('SELECT * FROM accounts')) {
    const b = acctBalance(a.id); if (!b) continue;
    const v = conv(b.balance / Math.max(1, a.owners || 1), a.currency || H, H);
    if (v == null) { missing = true; continue; } cash += v;
  }
  let other = 0, otherCost = 0;
  for (const a of q('SELECT * FROM other_assets')) {
    const v = assetValue(a.id); if (!v) continue; const k = 1 / Math.max(1, a.owners || 1);
    const hv = conv(v.value * k, a.currency || H, H); if (hv == null) { missing = true; continue; }
    other += hv; otherCost += conv((a.purchase_price != null ? a.purchase_price : v.value) * k, a.currency || H, H) || 0;
  }
  return { other, otherCost, cash, metals, metalsCost, metalsM, metalsCostM, re, reInvested, reIncome, reLastNet, reLastYear, total: metals + re + cash + other, missing };
}

/* ---------------- price updates ---------------- */
/* ---------------- several sources for every price ----------------
   Each source is asked for its numbers; they are kept side by side (table source_quotes) and the app uses
   the middle value (the median), so one wrong or late source cannot pull your totals off. You can also pick one source.
   Currencies are kept as "units per 1 US dollar"; metals as "US dollars per troy ounce". */
const FX_SOURCES = [
  { id: 'ecb', name: 'European Central Bank', url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    parse: b => { const r = {}, re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g; let m; while ((m = re.exec(b))) r[m[1]] = +m[2];
      if (!r.USD) return null; const out = { EUR: 1 / r.USD }; for (const [c, v] of Object.entries(r)) out[c] = v / r.USD; out.USD = 1; return out; } },
  { id: 'boc', name: 'Bank of Canada', url: 'https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json?recent=1',
    parse: b => { const o = JSON.parse(b).observations; const last = o && o[o.length - 1]; if (!last || !last.FXUSDCAD) return null;
      const usd = +last.FXUSDCAD.v, out = { CAD: usd, USD: 1 };
      for (const [k, v] of Object.entries(last)) { const m = /^FX([A-Z]{3})CAD$/.exec(k); if (m && v && +v.v > 0) out[m[1]] = usd / +v.v; }
      out.USD = 1; return out; } },
  { id: 'erapi', name: 'ExchangeRate-API', url: 'https://open.er-api.com/v6/latest/USD',
    parse: b => { const d = JSON.parse(b); return d.result === 'success' && d.rates ? Object.assign({}, d.rates, { USD: 1 }) : null; } },
  { id: 'fawaz', name: 'Currency API', url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
    alt: 'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
    parse: b => { const d = JSON.parse(b).usd; if (!d) return null; const out = { USD: 1 };
      for (const [c, v] of Object.entries(d)) if (/^[a-z]{3}$/.test(c) && v > 0 && !['xau', 'xag', 'xpt', 'xpd', 'btc', 'eth'].includes(c)) out[c.toUpperCase()] = v; return out; } },
];
const METAL_SOURCES = [
  { id: 'goldapi', name: 'gold-api.com' },
  { id: 'yahoo', name: 'Yahoo Finance (futures)' },
  { id: 'fawaz', name: 'Currency API' },
];
const SRC_NAME = Object.fromEntries(FX_SOURCES.concat(METAL_SOURCES).map(s => [s.id, s.name]));
let fawazCache = null;
async function getText(url, alt, ua) {
  let r = await native('httpGet', { url, ua });
  if ((r.status !== 200 || !r.body) && alt) r = await native('httpGet', { url: alt, ua });
  return r.status === 200 ? r.body : null;
}
async function fetchFxSource(s) {
  try { const b = await getText(s.url, s.alt); if (!b) return null; if (s.id === 'fawaz') fawazCache = b; return s.parse(b); } catch (e) { return null; }
}
async function fetchMetalSource(id) {
  const out = {};
  try {
    if (id === 'goldapi') {
      for (const m of METALS) { const b = await getText('https://api.gold-api.com/price/' + m.sym); if (!b) continue;
        const d = JSON.parse(b); if (d.price > 0 && (d.currency || 'USD') === 'USD') out[m.sym] = +d.price; }
    } else if (id === 'yahoo') {
      for (const m of METALS) { const b = await getText(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(YAHOO[m.sym])}?range=1d&interval=1d`, null, 'Mozilla/5.0'); if (!b) continue;
        const meta = JSON.parse(b).chart.result[0].meta; if (meta.regularMarketPrice > 0) out[m.sym] = +meta.regularMarketPrice; }
    } else if (id === 'fawaz') {
      const b = fawazCache || await getText(FX_SOURCES[3].url, FX_SOURCES[3].alt); if (!b) return out;
      const d = JSON.parse(b).usd || {}; for (const m of METALS) { const v = d[m.sym.toLowerCase()]; if (v > 0) out[m.sym] = 1 / v; }
    }
  } catch (e) { /* this source not now */ }
  return out;
}
function median(a) { const s = a.filter(x => x > 0).sort((x, y) => x - y); if (!s.length) return null; const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; }
function quotes(kind) {   /* { code: { source: value } } */
  const out = {};
  for (const r of q('SELECT source, code, value, updated FROM source_quotes WHERE kind=?', [kind])) (out[r.code] = out[r.code] || {})[r.source] = r.value;
  return out;
}
/* from the kept quotes: the numbers the app uses (median, or the chosen source when it has the number) */
function applyQuotes(now) {
  const fxPick = getSetting('fx_source', 'auto'), mPick = getSetting('metal_source', 'auto');
  const fx = quotes('fx'), mt = quotes('metal');
  const use = (byS, pick) => pick !== 'auto' && byS[pick] > 0 ? byS[pick] : median(Object.values(byS));
  const perUsd = {}; for (const [c, byS] of Object.entries(fx)) { const v = use(byS, fxPick); if (v > 0) perUsd[c] = v; }
  perUsd.USD = 1;
  if (perUsd.EUR > 0) {
    const rows = Object.entries(perUsd).map(([c, v]) => [c, v / perUsd.EUR, now, fxPick === 'auto' ? 'middle of the sources' : SRC_NAME[fxPick]]);
    bulk('INSERT INTO fx(currency,per_eur,updated,source) VALUES(?,?,?,?) ON CONFLICT(currency) DO UPDATE SET per_eur=excluded.per_eur, updated=excluded.updated, source=excluded.source', rows);
    bulk('INSERT OR REPLACE INTO fx_history(currency,date,per_eur) VALUES(?,?,?)', rows.map(r => [r[0], now.slice(0, 10), r[1]]));
  }
  for (const [sym, byS] of Object.entries(mt)) { const v = use(byS, mPick); if (!(v > 0)) continue;
    run('INSERT INTO prices(symbol,price,currency,updated,source) VALUES(?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, currency=excluded.currency, updated=excluded.updated, source=excluded.source',
      [sym, v, 'USD', now, mPick === 'auto' ? 'middle of the sources' : SRC_NAME[mPick]]);
    run('INSERT OR REPLACE INTO price_history(symbol,date,price,source) VALUES(?,?,?,?)', [sym, now.slice(0, 10), v, 'app (daily)']); }
  loadFx();
}
let updating = false;
async function updatePrices(quiet) {
  if (updating) return; updating = true;
  const btn = document.getElementById('refresh'); btn.classList.add('spin');
  const now = new Date().toISOString(); const got = [];
  try {
    fawazCache = null;
    const fxRes = await Promise.all(FX_SOURCES.map(fetchFxSource));
    const mRes = [];
    for (const s of METAL_SOURCES) mRes.push(await fetchMetalSource(s.id));
    const rows = [];
    FX_SOURCES.forEach((s, i) => { const r = fxRes[i]; if (!r) return; got.push(s.name); for (const [c, v] of Object.entries(r)) if (v > 0) rows.push([s.id, 'fx', c, v, now]); });
    METAL_SOURCES.forEach((s, i) => { const r = mRes[i]; if (!r || !Object.keys(r).length) return; got.push(s.name + ' (metals)'); for (const [c, v] of Object.entries(r)) rows.push([s.id, 'metal', c, v, now]); });
    if (rows.length) {
      bulk('INSERT OR REPLACE INTO source_quotes(source,kind,code,value,updated) VALUES(?,?,?,?,?)', rows);
      applyQuotes(now); setSetting('prices_updated', now); save();
    }
    const nf = FX_SOURCES.length + METAL_SOURCES.length;
    if (!quiet || !rows.length) toast(rows.length ? `Prices updated from ${got.length} of ${nf} sources` : 'No connection: prices not updated');
  } finally { updating = false; btn.classList.remove('spin'); clearHist(); render(); }
  if (!getSetting('history_loaded') && getSetting('auto_prices', '1') === '1') loadHistory(true);
  else if (getSetting('auto_prices', '1') === '1') { const dl = getSetting('daily_loaded');
    if (!dl || Date.now() - new Date(dl) > 2 * 864e5) loadDaily(dl ? '1mo' : '5y').then(n => { if (n) { save(); clearHist(); render(); } }); }
}
/* the numbers of each source next to each other */
function spreadOf(byS) { const v = Object.values(byS).filter(x => x > 0); if (v.length < 2) return null; return (Math.max(...v) - Math.min(...v)) / median(v); }
function metalSourcesHtml() {
  const mt = quotes('metal'), M = mcur();
  if (!Object.keys(mt).length) return '<p class="sub">No sources yet: press ↻ when you are online.</p>';
  return `<div class="srcgrid" style="--n:${METAL_SOURCES.length}"><span></span>${METAL_SOURCES.map(s => `<span class="sh">${esc(s.name.replace(' (futures)', ''))}</span>`).join('')}` +
    METALS.map(m => { const byS = mt[m.sym] || {}, sp = spreadOf(byS);
      return `<span class="sm">${m.name}${sp != null ? `<small>${(sp * 100).toFixed(1)}% apart</small>` : ''}</span>` + METAL_SOURCES.map(s => `<span class="sv">${byS[s.id] ? money(conv(byS[s.id], 'USD', M), M, { dec: 0 }) : '—'}</span>`).join(''); }).join('') + `</div>`;
}

/* ---------------- price history ----------------
   Past prices: monthly prices back to the 1960s from DataHub (public-domain datasets, no key),
   exchange rates back to 1999 from Frankfurter (European Central Bank data). From then on the app
   adds each day's prices itself when it updates. Everything is kept in the database. */
const HIST_SRC = {
  XAU: 'https://datahub.io/core/gold-prices/_r/-/data/monthly.csv',
  XAG: 'https://datahub.io/energy-and-commodities/precious-metals-prices/_r/-/data/silver.csv',
  XPT: 'https://datahub.io/energy-and-commodities/precious-metals-prices/_r/-/data/platinum.csv',
  XPD: 'https://datahub.io/energy-and-commodities/precious-metals-prices/_r/-/data/palladium.csv',
};
const YAHOO = { XAU: 'GC=F', XAG: 'SI=F', XPT: 'PL=F', XPD: 'PA=F' };
async function loadDaily(range) {   /* daily closing prices (futures, USD per troy ounce) from Yahoo Finance; no account needed */
  let n = 0;
  for (const m of METALS) {
    const r = await native('httpGet', { url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(YAHOO[m.sym])}?range=${range}&interval=1d`, ua: 'Mozilla/5.0' });
    try {
      const res = JSON.parse(r.body || '').chart.result[0], ts = res.timestamp || [], cl = res.indicators.quote[0].close || [];
      const rows = []; for (let i = 0; i < ts.length; i++) if (cl[i] > 0) rows.push([m.sym, new Date(ts[i] * 1000).toISOString().slice(0, 10), cl[i], 'Yahoo Finance (daily)']);
      if (rows.length) { bulk('INSERT OR REPLACE INTO price_history(symbol,date,price,source) VALUES(?,?,?,?)', rows); n += rows.length; }
    } catch (e) { /* this metal not now */ }
  }
  if (n) setSetting('daily_loaded', new Date().toISOString());
  return n;
}
let loadingHist = false;
async function loadHistory(quiet) {
  if (loadingHist) return; loadingHist = true;
  const done = [], fail = [];
  try {
    for (const m of METALS) {
      const r = await native('httpGet', { url: HIST_SRC[m.sym] });
      const rows = [];
      if (r.status === 200 && r.body) {
        for (const line of r.body.split(/\r?\n/)) {
          const c = line.split(','); if (c.length < 2) continue;
          let d = c[0].trim().replace(/"/g, ''); const v = Number(String(c[1]).replace(/"/g, ''));
          if (/^\d{4}-\d{2}$/.test(d)) d += '-15'; else if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          if (v > 0) rows.push([m.sym, d, v, 'DataHub (monthly)']);
        }
      }
      if (rows.length) bulk('INSERT OR IGNORE INTO price_history(symbol,date,price,source) VALUES(?,?,?,?)', rows);
      (rows.length ? done : fail).push(m.name);
    }
    if (await loadDaily('5y')) done.push('daily prices');
    const curs = new Set(['USD', 'CAD', home(), mcur()]);
    q('SELECT DISTINCT currency FROM metal_holdings UNION SELECT DISTINCT currency FROM properties').forEach(r => r.currency && curs.add(r.currency));
    curs.delete('EUR');
    const fr = await native('httpGet', { url: 'https://api.frankfurter.dev/v1/1999-01-04..?symbols=' + Array.from(curs).join(',') });
    try {
      const d = JSON.parse(fr.body || '');
      const rows = []; let lastWeek = '';
      for (const date of Object.keys(d.rates || {}).sort()) {   /* one rate a week is plenty for history */
        const wk = Math.floor(new Date(date + 'T00:00:00Z') / (7 * 864e5)); if (String(wk) === lastWeek) continue; lastWeek = String(wk);
        for (const [c, v] of Object.entries(d.rates[date])) if (v > 0) rows.push([c, date, v]);
      }
      if (rows.length) bulk('INSERT OR IGNORE INTO fx_history(currency,date,per_eur) VALUES(?,?,?)', rows);
      if (!Object.keys(d.rates || {}).length) fail.push('exchange rates');
    } catch (e) { fail.push('exchange rates'); }
    if (done.length) { setSetting('history_loaded', new Date().toISOString()); save(); }
    if (!quiet || fail.length) toast(done.length ? (fail.length ? 'Price history loaded, except ' + fail.join(', ') : 'Price history loaded') : 'No connection: price history not loaded');
  } finally { loadingHist = false; clearHist(); render(); }
}
let HIST = {}, FXH = {};
function clearHist() { HIST = {}; FXH = {}; }
function series(sym) {
  if (!HIST[sym]) HIST[sym] = q('SELECT date, price FROM price_history WHERE symbol=? ORDER BY date', [sym]).map(r => [r.date, r.price]);
  return HIST[sym];
}
function fxSeries(cur) {
  if (!FXH[cur]) FXH[cur] = q('SELECT date, per_eur FROM fx_history WHERE currency=? ORDER BY date', [cur]).map(r => [r.date, r.per_eur]);
  return FXH[cur];
}
function lastOnOrBefore(arr, date) {     /* [date, value] of the last entry on or before date */
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid][0] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans < 0 ? null : arr[ans][1];
}
function fxOn(cur, date) {
  if (cur === 'EUR') return 1;
  const a = fxSeries(cur); const v = a.length ? (lastOnOrBefore(a, date) || a[0][1]) : null;   /* before 1999: the earliest rate */
  return v || FX[cur] || null;
}
function convOn(amount, from, to, date) {
  if (amount == null || from === to) return amount;
  const a = fxOn(from, date), b = fxOn(to, date); return a && b ? amount / a * b : null;
}
function priceOn(sym, date, cur) {   /* USD price of a troy ounce on a date, in cur */
  const p = lastOnOrBefore(series(sym), date); return p == null ? null : convOn(p, 'USD', cur || 'USD', date);
}

/* ---------------- screens ---------------- */
const state = { tab: 'overview', propertyId: null };
const view = () => document.getElementById('view');
function setTitle(t, back) {
  document.getElementById('title').textContent = t;
  document.getElementById('back').hidden = !back;
}
/* Menus: Overview · Assets (Metals, Property, Cash, Other assets) · Markets (metal prices, currencies) */
const ASECS = [['metals', 'Metals'], ['property', 'Property'], ['accounts', 'Cash'], ['assets', 'Other assets']];
const isAsset = t => ASECS.some(a => a[0] === t);
function render() {
  if (isAsset(state.tab)) state.lastAsec = state.tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab || (b.dataset.tab === 'assetsgroup' && isAsset(state.tab))));
  document.getElementById('settings').classList.toggle('on', state.tab === 'more');
  if (state.tab === 'overview') renderOverview();
  else if (state.tab === 'markets') renderMarkets();
  else if (state.tab === 'metals') renderMetals();
  else if (state.tab === 'property') state.propertyId ? renderProperty(state.propertyId) : renderProperties();
  else if (state.tab === 'accounts') state.accountId ? renderAccount(state.accountId) : renderAccounts();
  else if (state.tab === 'assets') state.assetId ? renderAsset(state.assetId) : renderAssets();
  else if (state.tab === 'currency') renderMarkets();
  else renderMore();
  const inDetail = state.propertyId && state.tab === 'property' || state.accountId && state.tab === 'accounts' || state.assetId && state.tab === 'assets';
  if (isAsset(state.tab) && !inDetail) {
    setTitle('Assets');
    view().insertAdjacentHTML('afterbegin', `<div class="subnav">${ASECS.map(([k, l]) => `<button class="${k === state.tab ? 'on' : ''}" data-asec="${k}">${l}</button>`).join('')}</div>`);
  }
}
function priceStrip() {
  const H = mcur();
  const cells = METALS.map(m => { const p = spotIn(m.sym, H);
    return `<div class="price"><div class="m">${m.name} / oz</div><div class="p">${p == null ? '—' : money(p, H)}</div></div>`; }).join('');
  return `<div class="prices">${cells}</div><div class="sub" style="margin-top:8px">Prices updated ${when(getSetting('prices_updated'))}</div>`;
}
function missingWarn() {
  if (Object.keys(FX).length > 1) return '';
  const H = home(), other = q('SELECT COUNT(*) n FROM metal_holdings')[0].n + ['properties', 'accounts', 'other_assets'].reduce((n, tb) => n + q(`SELECT COUNT(*) n FROM ${tb} WHERE currency IS NOT NULL AND currency <> ?`, [H])[0].n, 0);
  if (!other) return '';
  return `<div class="warn">No exchange rates yet. Press <b>↻</b> (top right) when you are online, or enter rates under Settings (⚙) › Prices.</div>`;
}
function renderOverview() {
  setTitle('KJT Invest');
  const t = totals(), H = home();
  const nAll = ['metal_holdings', 'properties', 'accounts', 'other_assets'].reduce((n, tb) => n + q(`SELECT COUNT(*) n FROM ${tb}`)[0].n, 0);
  let h = missingWarn() + `<h2 class="sect">Summary <span class="sub">swipe the box for more</span></h2>` + heroHtml(t);
  if (!nAll) {
    h += `<div class="card"><h2>Welcome</h2><p class="sub">Add what you own. Everything stays on this device, in one file you can export at any time.</p>
      <div class="btns"><button class="btn" data-act="add-metal">Add precious metal</button><button class="btn" data-act="add-property">Add property</button><button class="btn" data-act="add-account">Add bank account</button><button class="btn" data-act="add-asset">Add other asset</button></div></div>`;
  }
  const M = mcur(), mGain = t.metalsM - t.metalsCostM;
  h += `<h2 class="sect">What you own</h2><div class="card tap" data-go="metals"><div class="phead"><span class="pbadge">${metalIcon('XAU', 'bar', 28)}</span><h2 style="margin:0">Precious metals${M !== H ? ' (' + M + ')' : ''}</h2></div>
    <div class="row strong"><span class="k">Value</span><span class="v">${whole(t.metalsM, M)}</span></div>
    <div class="row"><span class="k">Paid (fees included)</span><span class="v">${whole(t.metalsCostM, M)}</span></div>
    <div class="row"><span class="k">Gain</span><span class="v ${signCls(mGain)}">${whole(mGain, M)} ${t.metalsCostM ? '(' + pct(mGain / t.metalsCostM) + ')' : ''}</span></div>
    ${M !== H ? `<div class="row"><span class="k">Value in ${H}</span><span class="v">${whole(t.metals, H)}</span></div>` : ''}</div>`;
  const reGain = t.re - t.reInvested + t.reIncome;
  h += `<div class="card tap" data-go="property"><div class="phead"><span class="pbadge">${propIcon('house')}</span><h2 style="margin:0">Real estate</h2></div>
    <div class="row strong"><span class="k">Value (your estimate)</span><span class="v">${whole(t.re, H)}</span></div>
    <div class="row"><span class="k">Invested</span><span class="v">${whole(t.reInvested, H)}</span></div>
    ${t.reLastYear ? `<div class="row"><span class="k">Net income ${t.reLastYear}</span><span class="v ${signCls(t.reLastNet)}">${whole(t.reLastNet, H)}</span></div>` : ''}
    <div class="row"><span class="k">Total gain (value + income)</span><span class="v ${signCls(reGain)}">${whole(reGain, H)} ${t.reInvested ? '(' + pct(reGain / t.reInvested) + ')' : ''}</span></div></div>`;
  h += `<div class="card tap" data-go="accounts"><div class="phead"><span class="pbadge"><svg class="picon" viewBox="0 0 24 24" width="26" height="26"><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l13-3v3M16 13.5h2"/></svg></span><h2 style="margin:0">Cash & bank accounts</h2></div>
    <div class="row strong"><span class="k">Balance</span><span class="v">${whole(t.cash, H)}</span></div></div>`;
  h += `<div class="card tap" data-go="assets"><div class="phead"><span class="pbadge">${assetIcon('car')}</span><h2 style="margin:0">Other assets</h2></div>
    <div class="row strong"><span class="k">Value (your estimate)</span><span class="v">${whole(t.other, H)}</span></div>
    ${t.otherCost ? `<div class="row"><span class="k">Paid</span><span class="v">${whole(t.otherCost, H)}</span></div>` : ''}</div>`;
  h += `<h2 class="sect">Income & expenses</h2>` + ieCard();
  h += `<h2 class="sect">Current prices <span class="sub">${mcur()} per troy ounce</span></h2><div class="card">${priceStrip()}</div>`;
  view().innerHTML = h; bindHero(); bindChart();
}
/* ---------------- 1.3: metal pictures, other assets, overview pages ---------------- */
const METAL_COL = { XAU: ['#f7dc85', '#c9971f', '#7a5a06'], XAG: ['#f3f5f7', '#a9b2ba', '#59626b'], XPT: ['#e6edf3', '#93a6b8', '#4a5b6c'], XPD: ['#f1ebe3', '#b6a998', '#675d50'] };
const FORMS = { coin: 'Coin', bar: 'Bar', round: 'Round', jewelry: 'Jewellery', other: 'Other' };
let iconSeq = 0;
function metalIcon(sym, form, size) {
  const [a, b, c] = METAL_COL[sym] || METAL_COL.XAU, id = 'mg' + (iconSeq++), s = size || 26;
  const g = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
  const f = `url(#${id})`;
  const shapes = {
    coin: `<circle cx="12" cy="12" r="10" fill="${f}" stroke="${c}" stroke-width="1.2"/><circle cx="12" cy="12" r="7" fill="none" stroke="${c}" stroke-width="1" opacity=".7"/><path d="M9.5 12h5M12 9.5v5" stroke="${c}" stroke-width="1.1" stroke-linecap="round" opacity=".6"/>`,
    bar: `<path d="M2.5 18 6 8h12l3.5 10z" fill="${f}" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 8l1.8 3.5h8.4L18 8" fill="none" stroke="${c}" stroke-width="1" opacity=".7"/>`,
    round: `<circle cx="12" cy="12" r="10" fill="${f}" stroke="${c}" stroke-width="1.2"/><path d="M7.5 9.5a5.5 5.5 0 0 1 9 0" fill="none" stroke="${a}" stroke-width="1.6" stroke-linecap="round"/>`,
    jewelry: `<ellipse cx="12" cy="14" rx="8" ry="6.5" fill="none" stroke="${f}" stroke-width="3.4"/><ellipse cx="12" cy="14" rx="8" ry="6.5" fill="none" stroke="${c}" stroke-width=".8" opacity=".6"/><path d="M12 3.5l2.2 2.6-2.2 2.4-2.2-2.4z" fill="${a}" stroke="${c}" stroke-width="1"/>`,
    other: `<path d="M5 15c-1.5-3 .5-7 4-8 2-.6 3 .4 5 0 3-.6 6 1.8 5.5 5.5-.4 3.2-3 5.5-7 5.5-3.5 0-6.3-.6-7.5-3z" fill="${f}" stroke="${c}" stroke-width="1.2"/>`,
  };
  return `<svg class="micon" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${g}${shapes[form] || shapes.coin}</svg>`;
}

const ASSET_TYPES = {
  car: ['Car / truck', '<path d="M3 16v-3l2-5h14l2 5v3z"/><path d="M5 13h14"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/>'],
  motorcycle: ['Motorcycle', '<circle cx="5.5" cy="16" r="3.2"/><circle cx="18.5" cy="16" r="3.2"/><path d="M5.5 16l4-6h5l4 6M9.5 10l-1-3H6M14.5 10l1.5-3h2.5"/>'],
  boat: ['Boat', '<path d="M3 15h18l-3 5H6z"/><path d="M12 3v12M12 4l6 9h-6"/>'],
  rv: ['RV / trailer', '<rect x="2" y="6" width="16" height="10" rx="1.5"/><path d="M18 9h2.5l1.5 3v4h-4M5 9h4v3H5z"/><circle cx="6" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>'],
  jewelry: ['Jewellery & watches', '<circle cx="12" cy="14" r="6"/><path d="M9 5h6l-3 3zM10 8l2 0"/>'],
  art: ['Art', '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>'],
  collectible: ['Collectibles', '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z"/>'],
  equipment: ['Equipment / tools', '<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>'],
  other: ['Other', '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 12h6M12 9v6"/>'],
};
const assetIcon = (t, size) => `<svg class="picon" viewBox="0 0 24 24" width="${size || 26}" height="${size || 26}" aria-hidden="true">${(ASSET_TYPES[t] || ASSET_TYPES.other)[1]}</svg>`;
function assetValue(id) { const r = q('SELECT * FROM asset_values WHERE asset_id=? ORDER BY date DESC, id DESC LIMIT 1', [id]); return r[0] || null; }

function renderAssets() {
  setTitle('Other assets');
  const H = home(), as = q('SELECT * FROM other_assets ORDER BY type, name');
  let total = 0, paid = 0, body = '';
  for (const a of as) {
    const v = assetValue(a.id), c = a.currency || H, k = 1 / Math.max(1, a.owners || 1);
    const val = v ? v.value * k : null, cost = a.purchase_price != null ? a.purchase_price * k : null;
    const hv = conv(val, c, H); if (hv != null) { total += hv; paid += conv(cost, c, H) || 0; }
    const ch = val != null && cost ? val / cost - 1 : null;
    body += `<div class="txn" data-asset="${a.id}"><div class="txn-top"><span class="ticon">${assetIcon(a.type, 22)}</span><span class="txn-date">${a.purchase_date ? 'bought ' + fmtDate(a.purchase_date, true) : (ASSET_TYPES[a.type] || ASSET_TYPES.other)[0]}</span><span class="txn-desc">${esc(a.name)}</span></div>
      <div class="txn-body"><div class="sub">${(ASSET_TYPES[a.type] || ASSET_TYPES.other)[0]}${cost != null ? ' · paid ' + money(cost, c, { dec: 0 }) : ''}${a.owners > 1 ? ' · your share 1/' + a.owners : ''}</div>
      <div class="r"><div class="strongv">${val == null ? '—' : money(val, c, { dec: 0 })}</div><div class="sub ${signCls(ch)}">${pct(ch)}</div></div></div></div>`;
  }
  let h = `<h2 class="sect">Total</h2><div class="card hero"><div class="label">Other assets (${H})</div><div class="big">${whole(total, H)}</div>
    ${paid ? `<div class="sub">Paid ${whole(paid, H)} · <span class="${signCls(total - paid)}">${pct(total / paid - 1)}</span></div>` : ''}</div>`;
  h += `<h2 class="sect">Your assets</h2>`;
  h += as.length ? `<div class="card"><div class="txns" style="margin-top:0">${body}</div></div>` : `<div class="card empty">No other assets yet: cars, boats, trailers, jewellery, art, collections, equipment…</div>`;
  h += `<button class="btn wide" data-act="add-asset">+ Add asset</button>`;
  view().innerHTML = h;
}
function renderAsset(id) {
  const a = q('SELECT * FROM other_assets WHERE id=?', [id])[0];
  if (!a) { state.assetId = null; return renderAssets(); }
  setTitle(a.name, true);
  const c = a.currency || home(), k = 1 / Math.max(1, a.owners || 1), vs = q('SELECT * FROM asset_values WHERE asset_id=? ORDER BY date DESC, id DESC', [id]), v = vs[0];
  const val = v ? v.value * k : null, cost = a.purchase_price != null ? a.purchase_price * k : null;
  let h = `<div class="card"><div class="phead"><span class="pbadge">${assetIcon(a.type)}</span><div><h3>${(ASSET_TYPES[a.type] || ASSET_TYPES.other)[0]}</h3>${a.purchase_date ? `<div class="sub">Bought ${fmtDate(a.purchase_date)}</div>` : ''}</div></div>
    ${a.owners > 1 ? `<div class="note" style="margin-top:10px">Owned by ${a.owners} people: amounts show your share (1/${a.owners}).</div>` : ''}
    <div class="row strong" style="margin-top:8px"><span class="k">Value (your estimate)</span><span class="v">${val == null ? '—' : money(val, c, { dec: 0 })}</span></div>
    ${cost != null ? `<div class="row"><span class="k">Paid</span><span class="v">${money(cost, c, { dec: 0 })}</span></div>
    <div class="row"><span class="k">Change</span><span class="v ${signCls(val - cost)}">${val == null ? '—' : money(val - cost, c, { dec: 0 }) + ' (' + pct(val / cost - 1) + ')'}</span></div>` : ''}
    <div class="btns"><button class="btn" data-act="add-avalue" data-id="${a.id}">Update value</button><button class="btn light" data-act="edit-asset" data-id="${a.id}">Edit</button></div></div>`;
  h += `<div class="card"><h2>Value history</h2>` + (vs.length ? `<div class="txns">` + vs.map((r, i) => { const p = vs[i + 1], ch = p ? r.value - p.value : null;
    return `<div class="txn" data-aval="${r.id}"><div class="txn-top"><span class="txn-date">${fmtDate(r.date)}</span><span class="txn-desc">${esc(r.note || '')}</span></div>
      <div class="txn-body"><div class="sub ${signCls(ch)}">${ch == null ? '' : (ch >= 0 ? '+' : '') + money(ch, c, { dec: 0 })}</div><div class="r"><div class="strongv">${money(r.value, c, { dec: 0 })}</div></div></div></div>`; }).join('') + `</div>` : '<p class="sub">No values yet.</p>') + `</div>`;
  view().innerHTML = h;
}
function assetForm(id, copyOf) {
  const a = id ? q('SELECT * FROM other_assets WHERE id=?', [id])[0] : copyOf || { type: 'car', currency: home(), purchase_date: today() };
  openSheet(`<h2>${id ? 'Edit' : copyOf ? 'Copy of' : 'Add'} asset</h2>
    <div class="f"><span class="flabel">Type</span><div class="ptypes">${Object.entries(ASSET_TYPES).map(([k, [l]]) => `<label class="ptype"><input type="radio" name="type" value="${k}"${k === (a.type || 'car') ? ' checked' : ''}><span>${assetIcon(k, 28)}<b>${l}</b></span></label>`).join('')}</div></div>
    ${field('name', 'Name', a.name, 'autocomplete="off" placeholder="e.g. 2021 Toyota RAV4"')}
    <div class="f2">${field('purchase_date', 'Date bought', a.purchase_date, 'type="date"')}<label class="f"><span>Currency</span><select name="currency">${curOptions(a.currency || home())}</select></label></div>
    <div class="f2">${field('purchase_price', 'Price paid', a.purchase_price)}${id ? '' : field('value', 'Worth today (your estimate)', null)}</div>
    <label class="f"><span>Owners</span><select name="owners">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === (a.owners || 1) ? ' selected' : ''}>${n === 1 ? 'Just me' : n + ' people, equal shares'}</option>`).join('')}</select></label>
    <label class="f"><span>Notes</span><textarea name="notes">${esc(a.notes)}</textarea></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn light" data-f="dup">Duplicate</button><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'dup') { const cp = Object.assign({}, a); delete cp.id; cp.name = a.name + ' (copy)'; return assetForm(null, cp); }
      if (f === 'delete') { ask('Delete this asset and its value history?').then(y => { if (!y) return;
        run('DELETE FROM asset_values WHERE asset_id=?', [id]); run('DELETE FROM other_assets WHERE id=?', [id]); state.assetId = null; save(); closeSheet(); render(); }); return; }
      const d = formData(box), pp = num(d.purchase_price), v = id ? null : num(d.value);
      if (!d.name.trim()) return bad('Give it a name.');
      if (Number.isNaN(pp) || Number.isNaN(v)) return bad('Check the amounts.');
      const vals = [d.name.trim(), d.type || 'other', d.purchase_date || null, pp, d.currency, +d.owners || 1, d.notes.trim()];
      if (id) run('UPDATE other_assets SET name=?,type=?,purchase_date=?,purchase_price=?,currency=?,owners=?,notes=? WHERE id=?', vals.concat([id]));
      else { run('INSERT INTO other_assets(name,type,purchase_date,purchase_price,currency,owners,notes) VALUES(?,?,?,?,?,?,?)', vals);
        const nid = q('SELECT last_insert_rowid() id')[0].id;
        const first = v != null ? v : pp;
        if (first != null) run('INSERT INTO asset_values(asset_id,date,value,note) VALUES(?,?,?,?)', [nid, today(), first, v != null ? 'Your estimate' : 'Price paid']);
        state.tab = 'assets'; state.assetId = nid; }
      save(); closeSheet(); render(); };
  });
}
function assetValueForm(assetId, valId) {
  const a = q('SELECT * FROM other_assets WHERE id=?', [assetId])[0]; if (!a) return;
  const r = valId ? q('SELECT * FROM asset_values WHERE id=?', [valId])[0] : { date: today() };
  openSheet(`<h2>${esc(a.name)}: ${valId ? 'edit' : 'new'} value</h2>
    <div class="f2">${field('date', 'Date', r.date, 'type="date"')}${field('value', 'Worth (' + (a.currency || home()) + ', whole)', r.value)}</div>
    ${field('note', 'Note (optional)', r.note, 'autocomplete="off" placeholder="e.g. dealer estimate"')}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${valId ? '<div class="btns"><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'delete') { ask('Delete this value?').then(y => { if (!y) return; run('DELETE FROM asset_values WHERE id=?', [valId]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), v = num(d.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return bad('Enter the date.');
      if (v == null || Number.isNaN(v)) return bad('Enter the value.');
      if (valId) run('UPDATE asset_values SET date=?,value=?,note=? WHERE id=?', [d.date, v, d.note.trim(), valId]);
      else run('INSERT INTO asset_values(asset_id,date,value,note) VALUES(?,?,?,?)', [assetId, d.date, v, d.note.trim()]);
      save(); closeSheet(); render(); };
  });
}

/* ---------------- worth on any day (for the performance chart) ---------------- */
function interp(anchors, d) {   /* anchors: [[date, value]] sorted; straight line between them; 0 before the first */
  if (!anchors.length || d < anchors[0][0]) return 0;
  for (let i = anchors.length - 1; i >= 0; i--) if (anchors[i][0] <= d) {
    const a = anchors[i], b = anchors[i + 1]; if (!b) return a[1];
    const t = (dnum(d) - dnum(a[0])) / Math.max(1, dnum(b[0]) - dnum(a[0])); return a[1] + (b[1] - a[1]) * t;
  }
  return 0;
}
function worthModel() {
  const H = home(), now = today(), items = [];
  for (const h of q('SELECT * FROM metal_holdings')) { const s = holdingStats(h);
    items.push({ kind: 'm', from: h.purchase_date || '0000', at: d => { const p = d >= now ? spotIn(h.metal, H) : priceOn(h.metal, d, H); return p == null ? null : s.oz * p; },
      paid: d => convOn(s.cost || 0, h.currency || H, H, h.purchase_date || d) }); }
  for (const p of q('SELECT * FROM properties')) { const st = propertyStats(p), k = st.share, c = p.currency || H;
    const an = st.anchors;
    items.push({ kind: 'p', from: p.purchase_date || '0000', at: d => convOn(interp(an, d) * k, c, H, d), paid: d => convOn(st.invested * k, c, H, p.purchase_date || d) }); }
  for (const a of q('SELECT * FROM accounts')) { const k = 1 / Math.max(1, a.owners || 1), c = a.currency || H;
    const bs = q('SELECT date, balance FROM account_balances WHERE account_id=? ORDER BY date, id', [a.id]).map(r => [r.date, r.balance]);
    if (!bs.length) continue;
    items.push({ kind: 'c', from: bs[0][0], at: d => { const v = lastOnOrBefore(bs, d); return v == null ? 0 : convOn(v * k, c, H, d); }, paid: null }); }
  for (const a of q('SELECT * FROM other_assets')) { const k = 1 / Math.max(1, a.owners || 1), c = a.currency || H;
    const an = q('SELECT date, value FROM asset_values WHERE asset_id=? ORDER BY date, id', [a.id]).map(r => [r.date, r.value]);
    if (a.purchase_date && a.purchase_price != null && (!an.length || an[0][0] > a.purchase_date)) an.unshift([a.purchase_date, a.purchase_price]);
    if (!an.length) continue;
    items.push({ kind: 'o', from: an[0][0], at: d => convOn(interp(an, d) * k, c, H, d), paid: d => convOn((a.purchase_price != null ? a.purchase_price : an[0][1]) * k, c, H, an[0][0]) }); }
  return items;
}
function worthSeries(range) {
  const items = worthModel(); if (!items.length) return [];
  const now = today(), RG = { '1Y': 366, '5Y': 1827, 'All': 0 }, days = range in RG ? RG[range] : 366;
  let start = days ? dstr(dnum(now) - days) : items.map(i => i.from).filter(x => x > '1900').sort()[0] || now;
  const dates = []; let y = +start.slice(0, 4), m = +start.slice(5, 7);
  for (;;) { const d = dstr(dnum(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`) - 1); if (d >= now) break; if (d >= start) dates.push(d); m++; if (m > 12) { m = 1; y++; } }
  if (dates.length > 180) { const k = dates.length / 180, out = []; for (let i = 0; i < 180; i++) out.push(dates[Math.floor(i * k)]); dates.length = 0; dates.push(...out); }
  dates.push(now);
  const pts = [];
  for (const d of dates) {
    let v = 0, paid = 0, ok = true;
    for (const it of items) { if (it.from > d) continue; const x = it.at(d); if (x == null) { ok = false; break; } v += x; paid += it.paid ? it.paid(d) || 0 : x; }
    if (ok) pts.push([d, v, paid]);
  }
  return pts;
}

/* ---------------- shared line chart (with touch read-out) ---------------- */
window.__charts = {};
function lineChart(cid, pts, two, M, shortDates, names) {
  const W = 340, Hh = 170, L = 6, Rr = 6, T = 8, B = 20;
  const vals = pts.flatMap(p => two ? [p[1], p[2]] : [p[1]]);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.08 || hi * 0.05 || 1; lo -= pad; hi += pad;
  if (lo < 0 && Math.min(...vals) >= 0) lo = 0;
  const x = i => L + (W - L - Rr) * i / (pts.length - 1), y = v => T + (Hh - T - B) * (1 - (v - lo) / (hi - lo));
  const path = j => pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[j]).toFixed(1)).join('');
  const grid = niceTicks(lo, hi).map(v => `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L}" y="${y(v) - 3}" class="tl">${shortMoney(v, M)}</text>`).join('');
  const fmtD = d => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', shortDates ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short' });
  const xl = `<text x="${L}" y="${Hh - 4}" class="tl">${fmtD(pts[0][0])}</text><text x="${W - Rr}" y="${Hh - 4}" class="tl" text-anchor="end">${fmtD(pts[pts.length - 1][0])}</text>`;
  window.__charts[cid] = { pts, two, M, names, geo: { W, Hh, x, y } };
  return `${two ? `<div class="legend"><span><i class="k1"></i>${names[0]}</span><span><i class="k2"></i>${names[1]}</span></div>` : ''}
    <div class="chart-wrap"><svg viewBox="0 0 ${W} ${Hh}" class="chart" data-cid="${cid}">${grid}${xl}
      ${two ? `<path d="${path(2)}" class="ln2"/>` : ''}<path d="${path(1)}" class="ln1"/>
      <line class="xh" x1="0" x2="0" y1="${T}" y2="${Hh - B}" visibility="hidden"/><circle class="dot1" r="4" visibility="hidden"/>${two ? '<circle class="dot2" r="4" visibility="hidden"/>' : ''}
      <rect class="hit" x="0" y="0" width="${W}" height="${Hh}" fill="transparent"/></svg><div class="tip" hidden></div></div>`;
}
function bindChart() {
  view().querySelectorAll('svg.chart').forEach(svg => {
    const c = window.__charts[svg.dataset.cid]; if (!c) return;
    const wrap = svg.parentNode, tip = wrap.querySelector('.tip');
    const show = e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * c.geo.W;
      let i = Math.round((px - c.geo.x(0)) / (c.geo.x(1) - c.geo.x(0))); i = Math.max(0, Math.min(c.pts.length - 1, i));
      const p = c.pts[i], X = c.geo.x(i);
      const xh = svg.querySelector('.xh'); xh.setAttribute('x1', X); xh.setAttribute('x2', X); xh.setAttribute('visibility', 'visible');
      const d1 = svg.querySelector('.dot1'); d1.setAttribute('cx', X); d1.setAttribute('cy', c.geo.y(p[1])); d1.setAttribute('visibility', 'visible');
      const d2 = svg.querySelector('.dot2'); if (d2) { d2.setAttribute('cx', X); d2.setAttribute('cy', c.geo.y(p[2])); d2.setAttribute('visibility', 'visible'); }
      tip.innerHTML = `<b>${new Date(p[0] + 'T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}</b><br>` +
        (c.two ? `${c.names[0]} ${money(p[1], c.M, { dec: 0 })}<br>${c.names[1]} ${money(p[2], c.M, { dec: 0 })}` : money(p[1], c.M));
      tip.hidden = false; const left = X / c.geo.W * r.width; tip.style.left = Math.min(Math.max(left - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth) + 'px';
    };
    const hide = () => { tip.hidden = true; svg.querySelectorAll('.xh,.dot1,.dot2').forEach(el => el.setAttribute('visibility', 'hidden')); };
    const hit = svg.querySelector('.hit');
    hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show); hit.addEventListener('pointerleave', hide);
  });
}

/* ---------------- overview: the top box has pages you swipe ---------------- */
const CATS = [['metals', 'Precious metals', 'cat-m'], ['re', 'Real estate', 'cat-p'], ['cash', 'Cash & bank', 'cat-c'], ['other', 'Other assets', 'cat-o']];
function heroPages(t) {
  const H = home(), parts = { metals: t.metals, re: t.re, cash: t.cash, other: t.other };
  const sum = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
  const paid = { metals: t.metalsCost, re: t.reInvested, cash: t.cash, other: t.otherCost };
  const gainOf = { metals: t.metals - t.metalsCost, re: t.re - t.reInvested + t.reIncome, cash: 0, other: t.other - t.otherCost };
  const totalGain = gainOf.metals + gainOf.re + gainOf.other, totalPaid = paid.metals + paid.re + paid.other;
  state.prange = state.prange || '1Y';
  const pts = worthSeries(state.prange);
  let perf;
  if (pts.length < 3) perf = `<p class="sub" style="padding:24px 0;text-align:center">The graph fills in as your items have dates, values and price history.</p>`;
  else { const f = pts[0][1], l = pts[pts.length - 1][1];
    perf = `<div class="chart-head"><div class="sub">Value of everything (${H})</div><div class="r ${signCls(l - f)}">${pct(f ? l / f - 1 : null)}</div></div>` + lineChart('worth', pts, true, H, false, ['Value', 'Paid in']); }
  const prs = ['1Y', '5Y', 'All'].map(k => `<button class="seg${state.prange === k ? ' on' : ''}" data-prange="${k}">${k}</button>`).join('');
  const m30 = pts.length > 1 ? pts.filter(p => p[0] <= dstr(dnum(today()) - 30)).pop() : null;
  const ch30 = m30 ? t.total - m30[1] : null;
  return [
    `<div class="label">Total value (${H})</div><div class="big">${whole(t.total, H)}</div>
      ${ch30 != null ? `<div class="sub"><span class="${signCls(ch30)}">${ch30 >= 0 ? '+' : ''}${whole(ch30, H)}</span> in the last month</div>` : ''}
      ${totalPaid ? `<div class="sub">Gain on what you bought: <span class="${signCls(totalGain)}">${whole(totalGain, H)} (${pct(totalGain / totalPaid)})</span></div>` : ''}
      ${t.missing ? '<div class="sub">Some items are not counted yet: an exchange rate or price is missing.</div>' : ''}
      <div class="sub swipehint">Swipe for more ›</div>`,
    `<div class="label">What you own</div>
      <div class="stack">${CATS.map(([k, , cl]) => parts[k] > 0 ? `<i class="${cl}" style="width:${(parts[k] / sum * 100).toFixed(2)}%"></i>` : '').join('')}</div>
      <div class="alloc">${CATS.map(([k, l, cl]) => `<div class="arow"><span class="sw ${cl}"></span><span class="al">${l}</span><span class="ap">${(parts[k] / sum * 100).toFixed(1)}%</span><span class="av">${whole(parts[k], H)}</span></div>`).join('')}</div>`,
    (() => { const ie = ieRange(ieModel(), 'L12'); return `<div class="label">Income & expenses, last 12 months</div>
      <div class="ie3" style="margin-top:10px"><div class="stat"><div class="k">Income</div><div class="v up">${whole(ie.income, H)}</div></div><div class="stat"><div class="k">Expenses</div><div class="v down">${whole(ie.costs, H)}</div></div><div class="stat"><div class="k">Net</div><div class="v ${signCls(ie.net)}">${whole(ie.net, H)}</div></div></div>
      <div class="sub" style="margin-top:8px">${whole(ie.net / 12, H)} net a month on average</div>`; })(),
    `<div class="segs" style="justify-content:center">${prs}</div>${perf}`,
    `<div class="label">Gains</div><div class="alloc">${CATS.filter(c => c[0] !== 'cash').map(([k, l, cl]) => `<div class="arow"><span class="sw ${cl}"></span><span class="al">${l}<span class="sub"> paid ${whole(paid[k], H)}</span></span><span class="av ${signCls(gainOf[k])}">${whole(gainOf[k], H)}</span><span class="ap ${signCls(gainOf[k])}">${pct(paid[k] ? gainOf[k] / paid[k] : null)}</span></div>`).join('')}
      <div class="arow tot"><span class="al">All</span><span class="av ${signCls(totalGain)}">${whole(totalGain, H)}</span><span class="ap ${signCls(totalGain)}">${pct(totalPaid ? totalGain / totalPaid : null)}</span></div></div>
      <p class="sub" style="margin:8px 0 0">Real estate counts its net rent too. Cash is not a gain.</p>`,
  ];
}
function heroHtml(t) {
  const pages = heroPages(t);
  return `<div class="card hero heroc"><div class="hero-scroll" id="heroS">${pages.map(p => `<section class="hpage">${p}</section>`).join('')}</div>
    <div class="hdots">${pages.map((_, i) => `<button data-hpage="${i}" aria-label="Page ${i + 1}" class="${i === (state.hpage || 0) ? 'on' : ''}"></button>`).join('')}</div></div>`;
}
/* a swipe box is as tall as the page shown, not as tall as its tallest page */
function fitSwipe(s, i) {
  const pg = s.children[i]; if (!pg) return;
  s.style.height = pg.scrollHeight + 'px';
}
function bindHero() {
  const s = document.getElementById('heroS'); if (!s) return;
  s.scrollLeft = (state.hpage || 0) * s.clientWidth; fitSwipe(s, state.hpage || 0);
  s.addEventListener('scroll', () => { const i = Math.round(s.scrollLeft / s.clientWidth); if (i !== state.hpage) { state.hpage = i; fitSwipe(s, i);
    s.parentNode.querySelectorAll('.hdots button').forEach((b, j) => b.classList.toggle('on', j === i)); } }, { passive: true });
}

/* ---------------- price history chart ---------------- */
const RANGES = [['1W', 8], ['1M', 31], ['6M', 183], ['1Y', 366], ['5Y', 1827], ['20Y', 7305], ['All', 0]];
function dayStr(d) { return d.toISOString().slice(0, 10); }
function chartData(key) {
  const M = mcur(), days = (RANGES.find(r => r[0] === state.range) || RANGES[2])[1];
  const start = days ? dayStr(new Date(Date.now() - days * 864e5)) : '0000', now = today();
  const holdings = q('SELECT * FROM metal_holdings');
  const syms = key === 'MINE' ? Array.from(new Set(holdings.map(h => h.metal))) : [key];
  if (!syms.length) return { pts: [], two: key === 'MINE' };
  let first = start;
  if (key === 'MINE') { const ds = holdings.map(h => h.purchase_date).filter(Boolean).sort(); if (ds.length && ds[0] > first) first = ds[0]; }
  const dates = new Set();
  for (const sy of syms) for (const [d] of series(sy)) if (d >= first && d <= now) dates.add(d);
  let list = Array.from(dates).sort();
  if (list.length > 240) { const k = list.length / 240; const out = []; for (let i = 0; i < 240; i++) out.push(list[Math.floor(i * k)]); out.push(list[list.length - 1]); list = out; }
  const spotNow = sy => spotIn(sy, M);
  const pts = [];
  const at = (d, live) => {
    if (key !== 'MINE') { const v = live ? spotNow(key) : priceOn(key, d, M); return v == null ? null : [d, v]; }
    let v = 0, paid = 0, any = false;
    for (const h of holdings) {
      if (h.purchase_date && h.purchase_date > d) continue;
      const pr = live ? spotNow(h.metal) : priceOn(h.metal, d, M); if (pr == null) return null;
      const st = holdingStats(h); v += st.oz * pr; any = true;
      if (st.cost != null) paid += convOn(st.cost, h.currency, M, h.purchase_date || d) || 0;
    }
    return any ? [d, v, paid] : null;
  };
  for (const d of list) { const p = at(d, false); if (p) pts.push(p); }
  if ((!pts.length || pts[pts.length - 1][0] < now) && spot(syms[0])) { const p = at(now, true); if (p) pts.push(p); }
  return { pts, two: key === 'MINE' };
}
function niceTicks(min, max) {
  const span = max - min || Math.abs(max) || 1, step0 = span / 4, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= step0);
  const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v); return out;
}
function shortMoney(v, cur) {
  const a = Math.abs(v); const sym = money(0, cur, { dec: 0 }).replace(/[\d.,\s-]/g, '').replace(/^0/, '') || '';
  return a >= 1e6 ? sym + (v / 1e6).toFixed(1) + 'M' : a >= 1e4 ? sym + Math.round(v / 1e3) + 'k' : money(v, cur, { dec: 0 });
}
function chartCard() {
  const M = mcur(); state.range = state.range || '1Y';
  const nH = q('SELECT COUNT(*) n FROM metal_holdings')[0].n;
  const key = !nH && (!state.chart || state.chart === 'MINE') ? 'XAU' : state.chart || 'MINE';
  const tabs = (nH ? [['MINE', 'My metals']] : []).concat(METALS.map(m => [m.sym, m.name]))
    .map(([k, l]) => `<button class="seg${key === k ? ' on' : ''}" data-chart="${k}">${l}</button>`).join('');
  const ranges = RANGES.map(([k]) => `<button class="seg${state.range === k ? ' on' : ''}" data-range="${k}">${k}</button>`).join('');
  const { pts, two } = chartData(key);
  let body;
  if (pts.length < 2) {
    body = `<p class="sub" style="padding:18px 0;text-align:center">${getSetting('history_loaded') ? 'Not enough prices for this period yet.' : 'No price history yet.'}</p>
      ${getSetting('history_loaded') ? '' : '<div class="btns"><button class="btn light" data-act="history">Load price history</button></div>'}`;
  } else {
    const f = pts[0][1], l = pts[pts.length - 1][1], ch = f ? l / f - 1 : null;
    body = `<div class="chart-head"><div><div class="big2">${money(l, M)}</div><div class="sub">${two ? 'value of your metals' : 'per troy ounce'}</div></div>
      <div class="r"><div class="${signCls(ch)}">${pct(ch)}</div><div class="sub">over ${state.range}</div></div></div>
      ${lineChart('metals', pts, two, M, state.range === '1W' || state.range === '1M' || state.range === '6M', ['Value', 'Paid (fees included)'])}
      <p class="sub" style="margin:6px 0 0">Daily prices for the last years (Yahoo Finance), monthly before that (DataHub).</p>`;
  }
  return `<div class="card"><div class="segs">${tabs}</div><div class="segs">${ranges}</div>${body}</div>`;
}
function renderMetals() {
  setTitle('Precious metals');
  const H = mcur(), hs = q("SELECT * FROM metal_holdings ORDER BY metal, COALESCE(purchase_date,'') DESC, description");
  let tv = 0, tc = 0; for (const x of hs) { const st = holdingStats(x); if (st.valueM != null) { tv += st.valueM; tc += st.costM || 0; } }
  let h = missingWarn() + `<h2 class="sect">Total</h2><div class="card hero"><div class="label">Precious metals (${H})</div><div class="big">${whole(tv, H)}</div>
      ${tc ? `<div class="sub">Paid ${whole(tc, H)} (fees included) · <span class="${signCls(tv - tc)}">${pct(tv / tc - 1)}</span></div>` : ''}
      <div class="sub" style="margin-top:6px"><a href="#" data-go="markets">Prices, sources and the price chart are under Markets ›</a></div></div>`
    + `<h2 class="sect">Your holdings</h2>`;
  if (!hs.length) h += `<div class="card empty">No metals yet.</div>`;
  for (const m of METALS) {
    const mine = hs.filter(x => x.metal === m.sym); if (!mine.length) continue;
    let oz = 0, val = 0, cost = 0;
    const items = mine.map(x => { const s = holdingStats(x); oz += s.oz; if (s.valueM != null) { val += s.valueM; cost += s.costM || 0; }
      return `<div class="txn" data-metal="${x.id}">
        <div class="txn-top"><span class="ticon">${metalIcon(x.metal, x.form, 24)}</span><span class="txn-date">${x.purchase_date ? fmtDate(x.purchase_date) : 'No date'}</span><span class="txn-desc">${esc(x.description || m.name)}</span></div>
        <div class="txn-body"><div class="sub">${FORMS[x.form] || 'Coin'} · ${fmtNum(x.quantity)} × ${fmtNum(x.weight)} ${x.unit === 'ozt' ? 'oz' : x.unit} · ${s.oz.toFixed(3)} oz pure<br>
          paid ${money(s.cost, x.currency)}${s.fees ? ' (fees ' + money(s.fees, x.currency) + ')' : ''}</div>
        <div class="r"><div class="strongv">${money(s.value, x.currency)}</div><div class="sub ${signCls(s.gain)}">${pct(s.gainPct)}</div></div></div></div>`; }).join('');
    h += `<div class="card"><div class="phead"><span class="pbadge">${metalIcon(m.sym, 'coin', 30)}</span><div style="flex:1"><div class="row strong" style="padding:0"><span class="k">${m.name}</span><span class="v">${whole(val, H)}</span></div>
      <div class="sub">${oz.toFixed(3)} troy oz pure · paid ${whole(cost, H)} · <span class="${signCls(val - cost)}">${pct(cost ? (val - cost) / cost : null)}</span></div></div></div>
      <div class="txns">${items}</div></div>`;
  }
  h += `<button class="btn wide" data-act="add-metal">+ Add precious metal</button>`;
  view().innerHTML = h;
}
function renderProperties() {
  setTitle('Real estate');
  const ps = q('SELECT * FROM properties ORDER BY name');
  let h = missingWarn() + `<h2 class="sect">Your properties</h2>`;
  if (!ps.length) h += `<div class="card empty">No properties yet.</div>`;
  for (const p of ps) {
    const s = propertyStats(p), c = p.currency || home(), k = s.share;
    h += `<div class="card tap" data-prop="${p.id}"><div class="phead"><span class="pbadge">${propIcon(p.type)}</span><div><h3>${esc(p.name)}</h3>
      <div class="sub">${(PROP_TYPES[p.type] || PROP_TYPES.house)[0]}${p.address ? ' · ' + esc(p.address) : ''}${s.owners > 1 ? ' · your share 1/' + s.owners : ''}</div></div></div>
      <div class="grid2" style="margin-top:10px">
        <div class="stat"><div class="k">Value${s.owners > 1 ? ' (your share)' : ''}</div><div class="v">${whole(s.value * k, c)}</div></div>
        <div class="stat"><div class="k">Invested${s.owners > 1 ? ' (your share)' : ''}</div><div class="v">${whole(s.invested * k, c)}</div></div>
        <div class="stat"><div class="k">Net per month</div><div class="v ${signCls(s.perMonth)}">${s.perMonth == null ? '—' : whole(s.perMonth * k, c)}</div></div>
        <div class="stat"><div class="k">${s.annual != null ? 'Per year, overall' : 'Overall return'}</div><div class="v ${signCls(s.overall)}">${pct(s.annual != null ? s.annual : s.overall)}</div></div>
      </div></div>`;
  }
  h += `<button class="btn wide" data-act="add-property">+ Add property</button>`;
  view().innerHTML = h;
}
function renderProperty(id) {
  const p = q('SELECT * FROM properties WHERE id=?', [id])[0];
  if (!p) { state.propertyId = null; return renderProperties(); }
  setTitle(p.name, true);
  const s = propertyStats(p), c = p.currency || home(), k = s.share, sh = v => whole(v * k, c);
  let h = `<div class="card"><div class="phead"><span class="pbadge">${propIcon(p.type)}</span><div><h3>${(PROP_TYPES[p.type] || PROP_TYPES.house)[0]}</h3>${p.address ? `<div class="sub">${esc(p.address)}</div>` : ''}</div></div>
    ${s.owners > 1 ? `<div class="note" style="margin-top:10px">Owned by ${s.owners} people: amounts show your share (1/${s.owners}). Whole property value ${whole(s.value, c)}.</div>` : ''}
    <div class="row strong" style="margin-top:6px"><span class="k">Value (your estimate)</span><span class="v">${sh(s.value)}</span></div>
    <div class="row"><span class="k">Purchase price${p.purchase_costs ? ' + costs' : ''}</span><span class="v">${sh(s.invested)}</span></div>
    <div class="row"><span class="k">Value gain</span><span class="v ${signCls(s.valueGain)}">${sh(s.valueGain)}</span></div>
    <div class="row"><span class="k">Net cashflow, all time</span><span class="v ${signCls(s.sumNet)}">${sh(s.sumNet)}</span></div>
    ${s.perMonth != null ? `<div class="row"><span class="k">Net cashflow per month (last 12)</span><span class="v ${signCls(s.perMonth)}">${sh(s.perMonth)}</span></div>` : ''}
    <div class="row strong"><span class="k">Total return</span><span class="v ${signCls(s.gain)}">${sh(s.gain)} (${pct(s.overall)})</span></div>
    ${s.annual != null ? `<div class="row"><span class="k">Per year, on average</span><span class="v ${signCls(s.annual)}">${pct(s.annual)}</span></div>` : ''}
    ${p.purchase_date ? `<div class="sub" style="margin-top:6px">Bought ${fmtDate(p.purchase_date)}${c !== home() ? ' · amounts in ' + c : ''}</div>` : ''}
    <div class="btns"><button class="btn light" data-act="edit-property" data-id="${p.id}">Edit</button><button class="btn light" data-act="dup-property" data-id="${p.id}">Duplicate</button></div></div>`;
  h = `<h2 class="sect">Summary</h2>` + h + `<h2 class="sect">Cashflow <span class="sub">swipe for Monthly · Yearly · Costs</span></h2>` + cashflowCard(p, s, c, k).replace('<h2>Cashflow</h2>', '') + `<h2 class="sect">Money in and out</h2>`;
  /* rent periods */
  h += `<div class="card"><h2>Rent</h2>`;
  if (!s.periods.length) h += `<p class="sub">Add each rental: from when, to when (leave the end empty while it is still rented) and the rent per month. Months without rent show as empty.</p>`;
  else h += `<div class="txns">` + s.periods.slice().reverse().map(r => `<div class="txn" data-rent="${r.id}">
      <div class="txn-top"><span class="txn-date">${fmtDate(r.start_date)} – ${r.end_date ? fmtDate(r.end_date) : 'still rented'}</span><span class="txn-desc">${esc(r.tenant || 'Rental')}</span></div>
      <div class="txn-body"><div class="sub">Rent${s.owners > 1 ? ' (whole property)' : ''}</div><div class="r"><div class="strongv">${money(r.monthly_rent, c, { dec: 0 })} <span class="freq">a month</span></div></div></div></div>`).join('') + `</div>`;
  h += `<button class="btn wide light" data-act="add-rent" data-id="${p.id}">+ Add rent period</button></div>`;
  /* costs and other income */
  h += `<div class="card"><h2>Costs & other income</h2>`;
  if (!s.items.length) h += `<p class="sub">Add what this property costs: condo fees, insurance, taxes, repairs… For each one you choose whether it is paid every month, every year, or once.</p>`;
  else h += `<div class="txns">` + s.items.slice().sort((a, b) => (b.start_date || '') < (a.start_date || '') ? -1 : 1).map(it => { const meta = PITEMS[it.kind] || PITEMS.other_cost, inc = meta[1] === 'income';
    return `<div class="txn${inc ? ' inc' : ' cost'}" data-item="${it.id}">
      <div class="txn-top"><span class="txn-date">${it.freq === 'once' ? fmtDate(it.start_date) : (it.start_date ? 'from ' + fmtDate(it.start_date, true) : 'from purchase') + (it.end_date ? ' to ' + fmtDate(it.end_date, true) : '')}</span><span class="txn-desc">${esc(meta[0])}</span></div>
      <div class="txn-body"><div class="sub">${esc(it.note || (inc ? 'Income' : 'Cost'))}${it.freq === 'yearly' ? ' · ' + money(it.amount / 12, c, { dec: 0 }) + ' a month' : it.freq === 'monthly' ? ' · ' + money(it.amount * 12, c, { dec: 0 }) + ' a year' : ''}</div>
      <div class="r"><div class="strongv ${inc ? 'up' : ''}">${inc ? '+' : '−'}${money(it.amount, c, { dec: 0 })} <span class="freq">${FREQ[it.freq] || ''}</span></div></div></div></div>`; }).join('') + `</div>`;
  h += `<button class="btn wide light" data-act="add-item" data-id="${p.id}">+ Add cost or income</button></div>`;
  /* value history */
  const vals = q('SELECT * FROM property_values WHERE property_id=? ORDER BY date DESC, id DESC', [p.id]);
  h += `<h2 class="sect">Value over time</h2><div class="card">` + (vals.length ? `<div class="txns">` + vals.map(r => `<div class="txn" data-pval="${r.id}"><div class="txn-top"><span class="txn-date">${fmtDate(r.date)}</span><span class="txn-desc">${esc(r.note || 'Your estimate')}</span></div>
      <div class="txn-body"><div class="sub">${s.owners > 1 ? 'whole property' : ''}</div><div class="r"><div class="strongv">${money(r.value, c, { dec: 0 })}</div></div></div></div>`).join('') + `</div>` : '<p class="sub">Add what you think it is worth now and then; the value between dates is drawn as a straight line.</p>') +
    `<button class="btn wide light" data-act="add-pvalue" data-id="${p.id}">+ Update value</button></div>`;
  view().innerHTML = h; bindCashflow();
}
/* Cashflow box: Monthly / Yearly / Costs pages, swiped or chosen above */
function cashflowCard(p, s, c, k) {
  if (!s.rows.length) return `<div class="card"><h2>Cashflow</h2><p class="sub">Add rent periods and costs below to see the money coming in and going out, month by month and year by year.</p></div>`;
  const years = s.rows.map(r => r.year), nowY = new Date().getFullYear();
  if (!state.cfYear || !years.includes(state.cfYear)) state.cfYear = years.includes(nowY) ? nowY : years[years.length - 1];
  const yr = s.rows.find(r => r.year === state.cfYear), sh = v => whole(v * k, c), i = years.indexOf(state.cfYear);
  const ysel = `<div class="ysel"><button data-cfy="${years[i - 1] || ''}"${i > 0 ? '' : ' disabled'} aria-label="Previous year">‹</button><b>${state.cfYear}</b><button data-cfy="${years[i + 1] || ''}"${i < years.length - 1 ? '' : ' disabled'} aria-label="Next year">›</button></div>`;
  /* monthly */
  const maxAbs = Math.max(1, ...yr.months.map(f => Math.abs(f.net)));
  const bars = `<div class="mbars">${yr.months.map((f, m) => `<div class="mb${f.future ? ' fut' : ''}${!f.owned ? ' none' : ''}"><div class="mbt">${f.net > 0 ? `<i class="pos" style="height:${(f.net / maxAbs * 100).toFixed(1)}%"></i>` : ''}</div><div class="mbb">${f.net < 0 ? `<i class="neg" style="height:${(-f.net / maxAbs * 100).toFixed(1)}%"></i>` : ''}</div><span>${MONTHS[m][0]}</span></div>`).join('')}</div>`;
  const mrows = yr.months.map((f, m) => !f.owned ? '' : `<div class="cfrow${f.future ? ' fut' : ''}"><span class="cfm">${MONTHS[m]}${f.future ? '<small>expected</small>' : ''}${f.empty >= 0.05 ? `<small class="warn-t">${f.empty >= 0.95 ? 'empty' : Math.round(f.empty * 100) + '% empty'}</small>` : ''}</span>
      <span class="cfin">${sh(f.rent + f.income)}</span><span class="cfout">−${sh(f.costs).replace('-', '')}</span><span class="cfnet ${signCls(f.net)}">${sh(f.net)}</span></div>`).join('');
  const monthly = `${ysel}${bars}<div class="cfhead"><span></span><span>In</span><span>Out</span><span>Net</span></div>${mrows}
    <div class="cfrow tot"><span class="cfm">${yr.current ? 'So far' : 'Year'}</span><span class="cfin">${sh(yr.rent + yr.income)}</span><span class="cfout">−${sh(yr.costs).replace('-', '')}</span><span class="cfnet ${signCls(yr.net)}">${sh(yr.net)}</span></div>
    ${yr.current ? `<p class="sub" style="margin:6px 0 0">Whole year expected: net ${sh(yr.fullNet)}.</p>` : ''}`;
  /* yearly */
  const yearly = s.rows.slice().reverse().map(r => `<div class="yrow" data-cfy="${r.year}">
      <div class="yt"><b>${r.year}</b>${r.current ? '<span class="sub"> so far</span>' : ''}<span class="yn ${signCls(r.net)}">${sh(r.net)}</span></div>
      <div class="sub">In ${sh(r.rent + r.income)} · Out ${sh(r.costs)}${r.empty >= 0.05 ? ` · <span class="warn-t">${r.empty.toFixed(1).replace('.0', '')} mo empty</span>` : ''}</div>
      <div class="ystats"><span>Cash return <b class="${signCls(r.cash)}">${pct(r.cash)}</b></span><span>Value <b class="${signCls(r.valChange)}">${r.valChange == null ? '—' : (r.valChange >= 0 ? '+' : '') + sh(r.valChange)}</b></span><span>Total <b class="${signCls(r.total)}">${pct(r.total)}</b></span></div></div>`).join('');
  /* where the money goes (selected year) */
  const kinds = Object.entries(yr.byKind).filter(([kk]) => (PITEMS[kk] || PITEMS.other_cost)[1] === 'cost').sort((a, b) => b[1] - a[1]);
  const totalCost = kinds.reduce((a, [, v]) => a + v, 0) || 1;
  const costs = `${ysel}<div class="alloc">${kinds.length ? kinds.map(([kk, v]) => `<div class="arow"><span class="sw cat-p" style="opacity:${0.35 + 0.65 * v / totalCost}"></span><span class="al">${esc((PITEMS[kk] || PITEMS.other_cost)[0])}<span class="sub">${sh(v / 12)} a month on average</span></span><span class="av">${sh(v)}</span><span class="ap">${Math.round(v / totalCost * 100)}%</span></div>`).join('') : '<p class="sub">No costs entered for this year.</p>'}</div>`;
  const pages = [['Monthly', monthly], ['Yearly', `<div class="ylist">${yearly}</div><p class="sub" style="margin:8px 0 0">Cash return = net ÷ what you invested. Total also counts the change in value.</p>`], ['Costs', costs]];
  state.cfPage = state.cfPage || 0;
  return `<div class="card cfc"><h2>Cashflow</h2><div class="segs cftabs">${pages.map(([l], j) => `<button class="seg${j === state.cfPage ? ' on' : ''}" data-cfp="${j}">${l}</button>`).join('')}</div>
    <div class="hero-scroll" id="cfS">${pages.map(([, body]) => `<section class="cfpage">${body}</section>`).join('')}</div></div>`;
}
function bindCashflow() {
  const s = document.getElementById('cfS'); if (!s) return;
  s.scrollLeft = (state.cfPage || 0) * s.clientWidth; fitSwipe(s, state.cfPage || 0);
  s.addEventListener('scroll', () => { const i = Math.round(s.scrollLeft / s.clientWidth); if (i !== state.cfPage) { state.cfPage = i; fitSwipe(s, i);
    document.querySelectorAll('.cftabs .seg').forEach((b, j) => b.classList.toggle('on', j === i)); } }, { passive: true });
}
function itemForm(propertyId, itemId, copyOf) {
  const p = q('SELECT * FROM properties WHERE id=?', [propertyId])[0]; if (!p) return;
  const it = itemId ? q('SELECT * FROM property_items WHERE id=?', [itemId])[0] : copyOf || { kind: 'condo_fees', freq: null, start_date: p.purchase_date || today() };
  const c = p.currency || home();
  openSheet(`<h2>${itemId ? 'Edit' : 'Add'} cost or income</h2>
    <label class="f"><span>What is it?</span><select name="kind">${Object.entries(PITEMS).map(([kk, [l]]) => `<option value="${kk}"${kk === it.kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    ${field('amount', 'Amount (' + c + ', whole property)', it.amount)}
    <div class="f"><span class="flabel">How often is it paid?</span><div class="freqs">${Object.entries({ monthly: 'Every month', yearly: 'Every year', once: 'Once' }).map(([f, l]) => `<label class="freqo"><input type="radio" name="freq" value="${f}"${f === it.freq ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
    <div class="f2" id="dates">${field('start_date', 'From', it.start_date, 'type="date"')}${field('end_date', 'Until (empty: still paid)', it.end_date, 'type="date"')}</div>
    ${field('note', 'Note (optional)', it.note, 'autocomplete="off"')}
    <div class="preview" id="pv"></div>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${itemId ? '<div class="btns"><button class="btn light" data-f="dup">Duplicate</button><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    const sync = () => { const d = formData(box), once = d.freq === 'once';
      box.querySelector('#dates').querySelectorAll('label.f')[0].querySelector('span').textContent = once ? 'Date paid' : 'From';
      box.querySelector('#dates').querySelectorAll('label.f')[1].style.display = once ? 'none' : '';
      const a = num(d.amount);
      box.querySelector('#pv').innerHTML = !d.freq ? '<b>Choose how often it is paid.</b>' : !(a > 0) ? 'Enter the amount.'
        : d.freq === 'monthly' ? `${money(a, c, { dec: 0 })} every month = ${money(a * 12, c, { dec: 0 })} a year`
        : d.freq === 'yearly' ? `${money(a, c, { dec: 0 })} a year = about ${money(a / 12, c, { dec: 0 })} a month`
        : `${money(a, c, { dec: 0 })} once, counted in the month it was paid`; };
    box.oninput = sync; box.onchange = sync; sync();
    box.onclick = e => { const a = e.target.dataset.f; if (!a) return;
      if (a === 'cancel') return closeSheet();
      if (a === 'dup') { const cp = Object.assign({}, it); delete cp.id; return itemForm(propertyId, null, cp); }
      if (a === 'delete') { ask('Delete this item?').then(y => { if (!y) return; run('DELETE FROM property_items WHERE id=?', [itemId]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), amt = num(d.amount);
      if (!d.freq) return bad('Choose how often it is paid: every month, every year or once.');
      if (!(amt > 0)) return bad('Enter the amount.');
      if (d.freq === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(d.start_date)) return bad('Enter the date it was paid.');
      if (d.end_date && d.start_date && d.end_date < d.start_date) return bad('The end date is before the start date.');
      const vals = [d.kind, amt, d.freq, d.start_date || null, d.freq === 'once' ? null : (d.end_date || null), d.note.trim()];
      if (itemId) run('UPDATE property_items SET kind=?,amount=?,freq=?,start_date=?,end_date=?,note=? WHERE id=?', vals.concat([itemId]));
      else run('INSERT INTO property_items(property_id,kind,amount,freq,start_date,end_date,note) VALUES(?,?,?,?,?,?,?)', [propertyId].concat(vals));
      save(); closeSheet(); render(); };
  });
}
function propertyValueForm(propertyId, valId) {
  const p = q('SELECT * FROM properties WHERE id=?', [propertyId])[0]; if (!p) return;
  const r = valId ? q('SELECT * FROM property_values WHERE id=?', [valId])[0] : { date: today() };
  openSheet(`<h2>${esc(p.name)}: ${valId ? 'edit' : 'new'} value</h2>
    <div class="f2">${field('date', 'Date', r.date, 'type="date"')}${field('value', 'Worth (' + (p.currency || home()) + ', whole property)', r.value)}</div>
    ${field('note', 'Note (optional)', r.note, 'autocomplete="off" placeholder="e.g. municipal assessment, agent estimate"')}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${valId ? '<div class="btns"><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'delete') { ask('Delete this value?').then(y => { if (!y) return; run('DELETE FROM property_values WHERE id=?', [valId]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), v = num(d.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return bad('Enter the date.');
      if (!(v > 0)) return bad('Enter the value.');
      if (valId) run('UPDATE property_values SET date=?,value=?,note=? WHERE id=?', [d.date, v, d.note.trim(), valId]);
      else run('INSERT INTO property_values(property_id,date,value,note) VALUES(?,?,?,?)', [propertyId, d.date, v, d.note.trim()]);
      save(); closeSheet(); render(); };
  });
}

/* ---------------- bank accounts & cash ---------------- */
function renderAccounts() {
  setTitle('Bank accounts & cash');
  const H = home(), as = q('SELECT * FROM accounts ORDER BY type, name');
  let h = missingWarn(), total = 0, yearly = 0;
  const groups = {};
  for (const a of as) (groups[a.type] = groups[a.type] || []).push(a);
  let body = '';
  for (const [type, label] of Object.entries(ACCT_TYPES)) {
    const list = groups[type]; if (!list) continue;
    body += `<div class="card"><h2>${label}</h2><div class="txns">` + list.map(a => {
      const b = acctBalance(a.id), c = a.currency || H, share = 1 / Math.max(1, a.owners || 1);
      const mine = b ? b.balance * share : null, hv = conv(mine, c, H); if (hv != null) total += hv;
      if (mine != null && a.interest_rate) yearly += conv(mine * a.interest_rate / 100, c, H) || 0;
      return `<div class="txn" data-acct="${a.id}"><div class="txn-top"><span class="txn-date">${b ? 'as of ' + fmtDate(b.date) : 'no balance yet'}</span><span class="txn-desc">${esc(a.name)}</span></div>
        <div class="txn-body"><div class="sub">${esc(a.institution || label)}${a.interest_rate ? ' · ' + a.interest_rate + '% interest' : ''}${a.owners > 1 ? ' · your share 1/' + a.owners : ''}</div>
        <div class="r"><div class="strongv">${mine == null ? '—' : money(mine, c)}</div></div></div></div>`; }).join('') + `</div></div>`;
  }
  h += `<h2 class="sect">Total</h2><div class="card hero"><div class="label">Cash & bank (${H})</div><div class="big">${whole(total, H)}</div>
    ${yearly ? `<div class="sub">About ${whole(yearly, H)} interest a year</div>` : ''}</div>`;
  h += `<h2 class="sect">Your accounts</h2>`;
  h += as.length ? body : `<div class="card empty">No accounts yet. Add your chequing and savings accounts, and cash on hand.</div>`;
  h += `<button class="btn wide" data-act="add-account">+ Add account</button>`;
  view().innerHTML = h;
}
function renderAccount(id) {
  const a = q('SELECT * FROM accounts WHERE id=?', [id])[0];
  if (!a) { state.accountId = null; return renderAccounts(); }
  setTitle(a.name, true);
  const c = a.currency || home(), bs = q('SELECT * FROM account_balances WHERE account_id=? ORDER BY date DESC, id DESC', [id]);
  const share = 1 / Math.max(1, a.owners || 1), b = bs[0];
  let h = `<div class="card hero"><div class="label">${esc(ACCT_TYPES[a.type] || 'Account')}${a.institution ? ' · ' + esc(a.institution) : ''}</div>
    <div class="big">${b ? money(b.balance * share, c) : '—'}</div>
    <div class="sub">${b ? 'as of ' + fmtDate(b.date) : 'no balance yet'}${a.owners > 1 ? ' · your share (1/' + a.owners + ') of ' + money(b ? b.balance : 0, c) : ''}${a.interest_rate ? ' · ' + a.interest_rate + '% interest' : ''}</div>
    <div class="btns"><button class="btn" data-act="add-balance" data-id="${a.id}">Update balance</button><button class="btn light" data-act="edit-account" data-id="${a.id}">Edit</button></div></div>`;
  h += `<div class="card"><h2>Balance history</h2>`;
  if (!bs.length) h += `<p class="sub">No balances yet.</p>`;
  else h += `<div class="txns">` + bs.map((r, i) => { const prev = bs[i + 1], ch = prev ? r.balance - prev.balance : null;
    return `<div class="txn" data-bal="${r.id}"><div class="txn-top"><span class="txn-date">${fmtDate(r.date)}</span><span class="txn-desc">${esc(r.note || '')}</span></div>
      <div class="txn-body"><div class="sub ${signCls(ch)}">${ch == null ? '' : (ch >= 0 ? '+' : '') + money(ch, c)}</div><div class="r"><div class="strongv">${money(r.balance, c)}</div></div></div></div>`; }).join('') + `</div>`;
  h += `</div>`;
  view().innerHTML = h;
}
function accountForm(id, copyOf) {
  const a = id ? q('SELECT * FROM accounts WHERE id=?', [id])[0] : copyOf || { type: 'savings', currency: home() };
  openSheet(`<h2>${id ? 'Edit' : copyOf ? 'Copy of' : 'Add'} account</h2>
    ${field('name', 'Name', a.name, 'autocomplete="off" placeholder="e.g. Everyday chequing"')}
    <div class="f2"><label class="f"><span>Type</span><select name="type">${Object.entries(ACCT_TYPES).map(([k, l]) => `<option value="${k}"${k === a.type ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>Currency</span><select name="currency">${curOptions(a.currency || home())}</select></label></div>
    ${field('institution', 'Bank (optional)', a.institution, 'autocomplete="off"')}
    ${id ? '' : field('balance', 'Balance today', null)}
    <div class="f2">${field('interest_rate', 'Interest % a year (optional)', a.interest_rate)}
    <label class="f"><span>Owners</span><select name="owners">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === (a.owners || 1) ? ' selected' : ''}>${n === 1 ? 'Just me' : n + ' people'}</option>`).join('')}</select></label></div>
    <label class="f"><span>Notes</span><textarea name="notes">${esc(a.notes)}</textarea></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn light" data-f="dup">Duplicate</button><button class="btn danger" data-f="delete">Delete account</button></div>' : ''}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'dup') { const cp = Object.assign({}, a); delete cp.id; cp.name = a.name + ' (copy)'; return accountForm(null, cp); }
      if (f === 'delete') { ask('Delete this account and its balance history?').then(y => { if (!y) return;
        run('DELETE FROM account_balances WHERE account_id=?', [id]); run('DELETE FROM accounts WHERE id=?', [id]); state.accountId = null; save(); closeSheet(); render(); }); return; }
      const d = formData(box), rate = num(d.interest_rate), bal = id ? null : num(d.balance);
      if (!d.name.trim()) return bad('Give the account a name.');
      if (Number.isNaN(rate) || Number.isNaN(bal)) return bad('Check the amounts.');
      const vals = [d.name.trim(), d.type, d.institution.trim(), d.currency, rate, +d.owners || 1, d.notes.trim()];
      if (id) run('UPDATE accounts SET name=?,type=?,institution=?,currency=?,interest_rate=?,owners=?,notes=? WHERE id=?', vals.concat([id]));
      else { run('INSERT INTO accounts(name,type,institution,currency,interest_rate,owners,notes) VALUES(?,?,?,?,?,?,?)', vals);
        const nid = q('SELECT last_insert_rowid() id')[0].id;
        if (bal != null) run('INSERT INTO account_balances(account_id,date,balance,note) VALUES(?,?,?,?)', [nid, today(), bal, 'Opening balance']);
        state.tab = 'accounts'; state.accountId = nid; }
      save(); closeSheet(); render(); };
  });
}
function balanceForm(accountId, balId) {
  const a = q('SELECT * FROM accounts WHERE id=?', [accountId])[0]; if (!a) return;
  const r = balId ? q('SELECT * FROM account_balances WHERE id=?', [balId])[0] : { date: today() };
  openSheet(`<h2>${esc(a.name)}: ${balId ? 'edit' : 'new'} balance</h2>
    <div class="f2">${field('date', 'Date', r.date, 'type="date"')}${field('balance', 'Balance (' + (a.currency || home()) + ', whole account)', r.balance)}</div>
    ${field('note', 'Note (optional)', r.note, 'autocomplete="off" placeholder="e.g. interest paid, transfer"')}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${balId ? '<div class="btns"><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'delete') { ask('Delete this balance?').then(y => { if (!y) return; run('DELETE FROM account_balances WHERE id=?', [balId]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), v = num(d.balance);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return bad('Enter the date.');
      if (v == null || Number.isNaN(v)) return bad('Enter the balance.');
      if (balId) run('UPDATE account_balances SET date=?,balance=?,note=? WHERE id=?', [d.date, v, d.note.trim(), balId]);
      else run('INSERT INTO account_balances(account_id,date,balance,note) VALUES(?,?,?,?)', [accountId, d.date, v, d.note.trim()]);
      save(); closeSheet(); render(); };
  });
}

/* ---------------- Currency: convert, favourites, and the sources side by side ---------------- */
let curNames = null;
function curName(c) {
  try { curNames = curNames || new Intl.DisplayNames(['en-CA'], { type: 'currency' }); return curNames.of(c); } catch (e) { return c; }
}
function allCurrencies() {
  const set = new Set(COMMON_CUR.concat(Object.keys(FX)).concat([home(), mcur()]));
  return Array.from(set).filter(c => /^[A-Z]{3}$/.test(c)).sort();
}
function favs() { try { const f = JSON.parse(getSetting('fav_currencies', '') || 'null'); if (Array.isArray(f)) return f; } catch (e) { /* none */ } return ['USD', 'EUR', 'GBP', 'CHF'].filter(c => c !== home()); }
function setFavs(f) { setSetting('fav_currencies', JSON.stringify(f)); save(); }
function curSelect(name, sel) {
  const f = favs().concat([home()]), all = allCurrencies();
  const opt = c => `<option value="${c}"${c === sel ? ' selected' : ''}>${c} · ${esc(curName(c))}</option>`;
  return `<select id="${name}" class="cursel"><optgroup label="Favourites">${Array.from(new Set(f)).filter(c => all.includes(c)).map(opt).join('')}</optgroup><optgroup label="All currencies">${all.map(opt).join('')}</optgroup></select>`;
}
function renderMarkets() {
  const M = mcur();
  const pre = `<h2 class="sect">Precious metal prices <span class="sub">${M} per troy ounce</span></h2><div class="card">${priceStrip()}
    <details class="fold"><summary><h2>Compare the sources</h2></summary>${metalSourcesHtml()}</details></div>
    <h2 class="sect">Price over time</h2>` + chartCard();
  renderCurrency(pre); bindChart();
}
function renderCurrency(prefix) {
  setTitle('Markets');
  const from = getSetting('conv_from', 'USD'), to = getSetting('conv_to', home()), amt = num(getSetting('conv_amt', '100')) || 0;
  const r1 = conv(1, from, to), res = conv(amt, from, to);
  const dec = c => ['JPY', 'KRW', 'IDR', 'HUF', 'ISK', 'CLP', 'VND'].includes(c) ? 0 : 2;
  let h = missingWarn() + (prefix || '');
  h += `<h2 class="sect">Currency converter</h2><div class="card conv">
    <label class="f"><span>Amount</span><input id="cv-amt" value="${esc(fmtNum(amt))}" inputmode="decimal" autocomplete="off"></label>
    <div class="convrow"><label class="f"><span>From</span>${curSelect('cv-from', from)}</label>
      <button class="iconbtn swap" id="cv-swap" aria-label="Swap"><svg viewBox="0 0 24 24"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg></button>
      <label class="f"><span>To</span>${curSelect('cv-to', to)}</label></div>
    <div class="convres"><div class="big">${res == null ? '—' : money(res, to, { dec: dec(to) })}</div>
      <div class="sub">${r1 == null ? 'No rate for this pair yet.' : `1 ${from} = ${fmtNum(r1, 6)} ${to} · 1 ${to} = ${fmtNum(1 / r1, 6)} ${from}`}</div></div></div>`;
  /* sources for this pair */
  const fx = quotes('fx');
  const rows = FX_SOURCES.map(s => { const a = (fx[from] || {})[s.id], b = (fx[to] || {})[s.id]; return [s, a > 0 && b > 0 ? b / a : null]; });
  const vals = rows.map(r => r[1]).filter(Boolean), md = median(vals);
  h += `<h2 class="sect">Sources for ${from} → ${to}</h2><div class="card"><div class="list">${rows.map(([s, v]) => `<div class="item nolink"><span>${esc(s.name)}</span><span class="r">${v == null ? '<span class="sub">no rate</span>' : fmtNum(v, 6)}${v != null && md ? `<small class="sub"> ${((v / md - 1) * 100 >= 0 ? '+' : '')}${((v / md - 1) * 100).toFixed(2)}%</small>` : ''}</span></div>`).join('')}</div>
    <p class="sub" style="margin:8px 0 0">${vals.length === 1 ? 'Only ' + esc(rows.find(r => r[1])[0].name) + ' has a rate for this pair. ' : ''}${vals.length > 1 ? `The app uses ${getSetting('fx_source', 'auto') === 'auto' ? 'the middle value of the ' + vals.length + ' sources' : esc(SRC_NAME[getSetting('fx_source')])} (change it in Settings).` : vals.length ? '' : 'Press ↻ when you are online to compare the sources.'} Updated ${when(getSetting('prices_updated'))}.</p></div>`;
  /* favourites */
  const f = favs(), H = home();
  h += `<h2 class="sect">Favourites <span class="sub">value of 1 ${H}</span></h2><div class="card"><div class="list">` +
    (f.length ? f.map(c => { const v = conv(1, H, c), inv = conv(1, c, H); return `<div class="item nolink fav"><span><b>${c}</b> <span class="sub">${esc(curName(c))}</span></span>
      <span class="r">${v == null ? '—' : fmtNum(v, 4)}<small class="sub">1 ${c} = ${inv == null ? '—' : money(inv, H, { dec: 4 })}</small></span>
      <button class="iconbtn star on" data-unfav="${c}" aria-label="Remove ${c} from favourites">★</button></div>`; }).join('') : '<p class="sub">No favourites yet.</p>') +
    `</div><div class="addfav"><select id="fav-add"><option value="">+ Add a favourite currency…</option>${allCurrencies().filter(c => !f.includes(c) && c !== H).map(c => `<option value="${c}">${c} · ${esc(curName(c))}</option>`).join('')}</select></div></div>`;
  view().innerHTML = h;
  const keep = () => { setSetting('conv_from', document.getElementById('cv-from').value); setSetting('conv_to', document.getElementById('cv-to').value); save(); };
  document.getElementById('cv-from').onchange = () => { keep(); render(); };
  document.getElementById('cv-to').onchange = () => { keep(); render(); };
  document.getElementById('cv-swap').onclick = () => { setSetting('conv_from', to); setSetting('conv_to', from); save(); render(); };
  const ai = document.getElementById('cv-amt');
  ai.oninput = () => { const n = num(ai.value); if (n == null || Number.isNaN(n)) return; setSetting('conv_amt', String(n));
    const v = conv(n, from, to); document.querySelector('.convres .big').textContent = v == null ? '—' : money(v, to, { dec: dec(to) }); };
  ai.onblur = () => { save(); const n = num(ai.value); if (n != null && !Number.isNaN(n)) ai.value = fmtNum(n); };
  document.getElementById('fav-add').onchange = e => { if (!e.target.value) return; setFavs(favs().concat([e.target.value])); render(); };
}

function renderMore() {
  setTitle('Settings');
  const H = home(), fxRows = q('SELECT * FROM fx ORDER BY currency');
  const PALS = [['purple', 'KJT Purple', '#3e093f', '#f3e2b8', '#f5f1ec'], ['navy', 'Navy & Gold', '#0f2a4a', '#f2d27a', '#f2f5f9'], ['ledger', 'Ledger', '#1b2321', '#0d7a5c', '#f3f5f4'], ['sepia', 'Sepia', '#6b4a2b', '#fbf1d8', '#f3ead5']];
  let h = `<h2 class="sect">Look</h2><div class="card"><div class="pals">${PALS.map(([k, l, a, b, c]) => `<button class="pal${(PREFS.palette || 'purple') === k ? ' on' : ''}" data-pal="${k}"><span class="pv" style="background:${c}"><i style="background:${a}"></i><b style="background:${b}"></b></span>${l}</button>`).join('')}</div>
    <div class="f2"><label class="f"><span>Light or dark</span><select id="set-theme">${[['', 'Same as device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}"${(PREFS.theme || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>Text size</span><select id="set-size">${[['', 'Normal'], ['large', 'Large'], ['larger', 'Larger']].map(([v, l]) => `<option value="${v}"${(PREFS.size || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div></div>`;
  h += `<h2 class="sect">Currencies</h2><div class="card">
    <label class="f"><span>Home currency (for totals)</span><select id="set-home">${curOptions(H)}</select></label>
    <label class="f"><span>Currency for precious metals</span><select id="set-mcur">${curOptions(mcur())}</select></label></div>`;
  h += `<h2 class="sect">Price sources</h2><div class="card">
    <div class="switch"><span>Update prices when the app opens</span><input type="checkbox" id="set-auto"${getSetting('auto_prices', '1') === '1' ? ' checked' : ''}></div>
    <label class="f"><span>Metal prices from</span><select id="set-msrc"><option value="auto">The middle of all sources (recommended)</option>${METAL_SOURCES.map(x => `<option value="${x.id}"${getSetting('metal_source', 'auto') === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Exchange rates from</span><select id="set-fsrc"><option value="auto">The middle of all sources (recommended)</option>${FX_SOURCES.map(x => `<option value="${x.id}"${getSetting('fx_source', 'auto') === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <p class="sub">With the middle value, one late or wrong source cannot change your totals. Every source is shown on the Metals and Currency pages. Updated ${when(getSetting('prices_updated'))}.</p>
    <div class="btns"><button class="btn" data-act="update">Update now</button></div>
    <details class="fold"><summary><h2>Enter a price yourself</h2></summary><p class="sub">For when there is no internet; the next update replaces it.</p><div class="list">`;
  for (const m of METALS) { const sp = spot(m.sym);
    h += `<div class="item" data-price="${m.sym}"><span>${m.name} (per troy oz)</span><span class="r">${sp ? money(sp.price, sp.currency) : '—'}</span></div>`; }
  const shown = new Set(COMMON_CUR.concat(favs()));
  for (const c of Array.from(shown).sort()) { if (c === H) continue; const r = conv(1, H, c);
    h += `<div class="item" data-fx="${c}"><span>1 ${H} in ${c}</span><span class="r">${r == null ? '—' : r.toFixed(4)}</span></div>`; }
  h += `</div></details></div>`;
  const nh = q('SELECT COUNT(*) n, MIN(date) d FROM price_history')[0];
  h += `<h2 class="sect">Price history</h2><div class="card"><p class="sub">${nh.n ? nh.n.toLocaleString('en-CA') + ' prices kept, from ' + esc(nh.d.slice(0, 4)) + '. Daily for the last years (Yahoo Finance), monthly before that (DataHub), and each day the app updates.' : 'No price history yet.'}${getSetting('daily_loaded') ? ' Daily prices updated ' + when(getSetting('daily_loaded')) + '.' : ''}</p>
    <div class="btns"><button class="btn light" data-act="history">${getSetting('history_loaded') ? 'Refresh past prices' : 'Load past prices'}</button></div></div>`;
  h += `<h2 class="sect">Updates</h2><div class="card">
    <div class="switch"><span>Check for new versions by itself</span><input type="checkbox" id="set-upd"${getSetting('auto_update', '1') === '1' ? ' checked' : ''}></div>
    <p class="sub">This is version ${APP_VERSION}. Last checked ${when(getSetting('update_checked'))}.${updateInfo ? ' Version ' + esc(updateInfo.version) + ' is ready.' : ''} When there is a new version a bar appears at the top: on Android the phone then asks you to confirm the update; on Linux, Software (GNOME Software) opens with it and you press Install. Your data always stays.</p>
    <div class="btns"><button class="btn light" data-act="check-update">Check for updates now</button>${updateInfo ? '<button class="btn" data-act="install-update">Update</button>' : ''}</div></div>`;
  h += `<h2 class="sect">Security</h2><div id="sec"></div>`;
  h += `<h2 class="sect">Your data</h2><div class="card">
    <p class="sub">Everything is kept in one SQLite database file on this device. Export it to back it up or to move it to another phone or computer; import it there.</p>
    <div class="btns"><button class="btn" data-act="export">Export database</button><button class="btn light" data-act="import">Import database</button></div></div>`;
  h += `<h2 class="sect">About</h2><div class="card"><p class="sub">KJT Invest ${APP_VERSION}, by Knowing Jesus Today (knowingjesus.today). Open source (GPL-2.0-or-later), no accounts, no analytics, no tracking.
    The app only goes online to update prices. Metals: gold-api.com, Yahoo Finance, Currency API. Exchange rates: European Central Bank, Bank of Canada, ExchangeRate-API (exchangerate-api.com), Currency API. Past prices: DataHub, Yahoo Finance, Frankfurter. Nothing about you or your holdings is sent.</p></div>`;
  view().innerHTML = h;
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.onchange = f; };
  on('set-home', e => { setSetting('home_currency', e.target.value); save(); render(); });
  on('set-mcur', e => { setSetting('metal_currency', e.target.value); save(); render(); });
  on('set-upd', e => { setSetting('auto_update', e.target.checked ? '1' : '0'); save(); });
  on('set-auto', e => { setSetting('auto_prices', e.target.checked ? '1' : '0'); save(); });
  on('set-theme', e => { PREFS.theme = e.target.value; applyLook(); savePrefs(); });
  on('set-size', e => { PREFS.size = e.target.value; applyLook(); savePrefs(); });
  on('set-msrc', e => { setSetting('metal_source', e.target.value); applyQuotes(getSetting('prices_updated') || new Date().toISOString()); save(); render(); });
  on('set-fsrc', e => { setSetting('fx_source', e.target.value); applyQuotes(getSetting('prices_updated') || new Date().toISOString()); save(); render(); });
  view().querySelectorAll('[data-pal]').forEach(b => b.onclick = () => { PREFS.palette = b.dataset.pal; applyLook(); savePrefs(); render(); });
  securityCard().then(html => { const el = document.getElementById('sec'); if (el) { el.outerHTML = html.replace('<h2>Security</h2>', ''); bindSecurity(); } });
}

/* ---------------- forms ---------------- */
function openSheet(html, onReady) {
  const sh = document.getElementById('sheet'), bx = sh.querySelector('.sheet-box'); bx.oninput = bx.onclick = null; bx.innerHTML = html; sh.hidden = false;
  sh.querySelector('.sheet-box').scrollTop = 0; if (onReady) onReady(sh.querySelector('.sheet-box'));
}
function closeSheet() { document.getElementById('sheet').hidden = true; }
document.querySelector('#sheet .sheet-bg').onclick = closeSheet;
const field = (name, label, value, extra) => extra
  ? `<label class="f"><span>${label}</span><input name="${name}" value="${esc(value == null ? '' : value)}" ${extra}></label>`
  : `<label class="f"><span>${label}</span><input name="${name}" value="${esc(fmtNum(value))}" inputmode="decimal" autocomplete="off" data-amt></label>`;
/* amounts get their thousands separators when you leave the box */
document.getElementById('sheet').addEventListener('focusout', e => {
  const el = e.target; if (!el.hasAttribute || !el.hasAttribute('data-amt')) return;
  const n = num(el.value); if (n != null && !Number.isNaN(n)) el.value = fmtNum(n);
});
function formData(box) { const d = {}; box.querySelectorAll('[name]').forEach(el => { if (el.type === 'radio' && !el.checked) return; d[el.name] = el.value; }); return d; }
function bad(msg) { toast(msg); return false; }

function metalForm(id, copyOf) {
  const x = id ? q('SELECT * FROM metal_holdings WHERE id=?', [id])[0]
    : copyOf ? Object.assign({}, copyOf, { purchase_date: today() })
    : { metal: 'XAU', quantity: 1, weight: 1, unit: 'ozt', purity: 0.9999, currency: mcur(), purchase_date: today() };
  openSheet(`<h2>${id ? 'Edit' : copyOf ? 'Copy of' : 'Add'} precious metal${copyOf ? ': check the date and amounts' : ''}</h2>
    <div class="f"><span class="flabel">Metal</span><div class="ptypes">${METALS.map(m => `<label class="ptype"><input type="radio" name="metal" value="${m.sym}"${m.sym === x.metal ? ' checked' : ''}><span>${metalIcon(m.sym, 'coin', 28)}<b>${m.name}</b></span></label>`).join('')}</div></div>
    <div class="f"><span class="flabel">Kind</span><div class="ptypes ptypes5" id="formtiles"></div></div>
    ${field('description', 'Description (e.g. Maple Leaf 1 oz coin, 100 g bar)', x.description, 'autocomplete="off"')}
    <div class="f2">${field('quantity', 'How many', x.quantity)}${field('weight', 'Weight of each', x.weight)}</div>
    <div class="f2"><label class="f"><span>Weight unit</span><select name="unit">${Object.entries(UNITS).map(([k, v]) => `<option value="${k}"${k === x.unit ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    ${field('purity', 'Purity (fine content)', x.purity)}</div>
    <p class="hint">Purity: 0.9999 for most bullion; 0.9167 for 22 carat coins (Krugerrand, Eagle); 0.925 for sterling silver.</p>
    <div class="f2">${field('cost', 'Price paid for the metal', x.cost)}<label class="f"><span>Currency</span><select name="currency">${curOptions(x.currency || mcur())}</select></label></div>
    <div class="f2">${field('commission', 'Commission', x.commission || '')}${field('shipping', 'Shipping', x.shipping || '')}</div>
    ${field('other_fees', 'Other fees (bank fees, insurance, storage…)', x.other_fees || '')}
    <p class="hint">Fees are added to what you paid, so the gain shows your real return.</p>
    ${field('purchase_date', 'Date bought', x.purchase_date, 'type="date"')}
    <label class="f"><span>Notes</span><textarea name="notes">${esc(x.notes)}</textarea></label>
    <div class="preview" id="pv"></div>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn light" data-f="dup">Duplicate</button><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    const curMetal = () => (box.querySelector('[name=metal]:checked') || {}).value || 'XAU';
    const tiles = form => { box.querySelector('#formtiles').innerHTML = Object.entries(FORMS).map(([k, l]) => `<label class="ptype"><input type="radio" name="form" value="${k}"${k === form ? ' checked' : ''}><span>${metalIcon(curMetal(), k, 28)}<b>${l}</b></span></label>`).join(''); };
    tiles(x.form || 'coin');
    box.querySelectorAll('[name=metal]').forEach(r => r.onchange = () => { if (!id) box.querySelector('[name=purity]').value = METAL[curMetal()].purity;
      tiles((box.querySelector('[name=form]:checked') || {}).value || 'coin'); pv(); });
    const pv = () => { const d = formData(box);
      const hh = { metal: d.metal, quantity: num(d.quantity), weight: num(d.weight), unit: d.unit, purity: num(d.purity), cost: num(d.cost), commission: num(d.commission), shipping: num(d.shipping), other_fees: num(d.other_fees), currency: d.currency };
      const s = holdingStats(hh);
      let prem = '';
      if (d.purchase_date && s.oz > 0 && s.cost) { const sp = priceOn(d.metal, d.purchase_date, d.currency);
        if (sp) prem = `<br>Spot price then: about ${money(sp, d.currency)}/oz · you paid <b>${pct(s.cost / s.oz / sp - 1)}</b> over spot`; }
      box.querySelector('#pv').innerHTML = `${s.oz.toFixed(4)} troy oz pure · worth ${money(s.value, d.currency)}${s.fees ? ` · total cost ${money(s.cost, d.currency)}` : ''}${s.gain != null ? ` · <span class="${signCls(s.gain)}">${pct(s.gainPct)}</span>` : ''}${prem}`; };
    box.oninput = pv; pv();
    box.onclick = e => { const a = e.target.dataset.f; if (!a) return;
      if (a === 'cancel') return closeSheet();
      if (a === 'dup') { const cp = Object.assign({}, x); delete cp.id; return metalForm(null, cp); }
      if (a === 'delete') { ask('Delete this holding?').then(y => { if (!y) return; run('DELETE FROM metal_holdings WHERE id=?', [id]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), qn = num(d.quantity), w = num(d.weight), pu = num(d.purity), cost = num(d.cost);
      if (!(qn > 0) || !(w > 0)) return bad('Enter how many and the weight.');
      if (!(pu > 0 && pu <= 1)) return bad('Purity is a number between 0 and 1, e.g. 0.9999.');
      const com = num(d.commission), ship = num(d.shipping), oth = num(d.other_fees);
      if ([cost, com, ship, oth].some(Number.isNaN)) return bad('Check the amounts: one is not a number.');
      const vals = [d.metal, d.description.trim(), qn, w, d.unit, pu, cost, com || 0, ship || 0, oth || 0, d.currency, d.purchase_date, d.notes.trim(), d.form || 'coin'];
      if (id) run('UPDATE metal_holdings SET metal=?,description=?,quantity=?,weight=?,unit=?,purity=?,cost=?,commission=?,shipping=?,other_fees=?,currency=?,purchase_date=?,notes=?,form=? WHERE id=?', vals.concat([id]));
      else run('INSERT INTO metal_holdings(metal,description,quantity,weight,unit,purity,cost,commission,shipping,other_fees,currency,purchase_date,notes,form) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', vals);
      save(); closeSheet(); render(); };
  });
}
function propertyForm(id) {
  const p = id ? q('SELECT * FROM properties WHERE id=?', [id])[0] : { currency: home() };
  openSheet(`<h2>${id ? 'Edit' : 'Add'} property</h2>
    <div class="f"><span class="flabel">Type</span><div class="ptypes">${Object.entries(PROP_TYPES).map(([k, [l]]) => `<label class="ptype"><input type="radio" name="type" value="${k}"${k === (p.type || 'house') ? ' checked' : ''}><span>${propIcon(k, 28)}<b>${l}</b></span></label>`).join('')}</div></div>
    ${field('name', 'Name', p.name, 'autocomplete="off" placeholder="e.g. Condo on Main Street"')}
    ${field('address', 'Address (optional)', p.address, 'autocomplete="off"')}
    <div class="f2"><label class="f"><span>Currency</span><select name="currency">${curOptions(p.currency || home())}</select></label>
    ${field('purchase_date', 'Date bought', p.purchase_date, 'type="date"')}</div>
    <div class="f2">${field('purchase_price', 'Purchase price', p.purchase_price)}${field('purchase_costs', 'Purchase costs', p.purchase_costs)}</div>
    <p class="hint">Purchase costs: notary, transfer tax, inspection and the like.</p>
    ${id ? '' : field('current_value', 'What it is worth today (your estimate)', null)}
    <label class="f"><span>Number of owners</span><select name="owners">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === (p.owners || 1) ? ' selected' : ''}>${n === 1 ? 'Just me' : n + ' people, equal shares'}</option>`).join('')}</select></label>
    <p class="hint">Enter the whole property's amounts; the app shows your share.</p>
    <label class="f"><span>Notes</span><textarea name="notes">${esc(p.notes)}</textarea></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn danger" data-f="delete">Delete property</button></div>' : ''}`, box => {
    box.onclick = e => { const a = e.target.dataset.f; if (!a) return;
      if (a === 'cancel') return closeSheet();
      if (a === 'delete') { ask('Delete this property and all its years?').then(y => { if (!y) return;
        for (const tb of ['property_years', 'rent_periods', 'property_items', 'property_values']) run(`DELETE FROM ${tb} WHERE property_id=?`, [id]);
        run('DELETE FROM properties WHERE id=?', [id]);
        state.propertyId = null; save(); closeSheet(); render(); }); return; }
      const d = formData(box), pp = num(d.purchase_price), pc = num(d.purchase_costs), cv = id ? null : num(d.current_value);
      if (!d.name.trim()) return bad('Give the property a name.');
      if (!(pp > 0)) return bad('Enter the purchase price.');
      if (Number.isNaN(pc) || Number.isNaN(cv)) return bad('Check the amounts.');
      const ty = (box.querySelector('[name=type]:checked') || {}).value || 'house';
      const vals = [d.name.trim(), d.address.trim(), d.currency, d.purchase_date, pp, pc || 0, d.notes.trim(), +d.owners || 1, ty];
      if (id) run('UPDATE properties SET name=?,address=?,currency=?,purchase_date=?,purchase_price=?,purchase_costs=?,notes=?,owners=?,type=? WHERE id=?', vals.concat([id]));
      else { run('INSERT INTO properties(name,address,currency,purchase_date,purchase_price,purchase_costs,notes,owners,type) VALUES(?,?,?,?,?,?,?,?,?)', vals);
        state.propertyId = q('SELECT last_insert_rowid() id')[0].id; state.tab = 'property';
        if (cv > 0) run('INSERT INTO property_values(property_id,date,value,note) VALUES(?,?,?,?)', [state.propertyId, today(), cv, 'Your estimate']); }
      save(); closeSheet(); render(); };
  });
}
function rentForm(propertyId, rentId, copyOf) {
  const p = q('SELECT * FROM properties WHERE id=?', [propertyId])[0]; if (!p) return;
  const r = rentId ? q('SELECT * FROM rent_periods WHERE id=?', [rentId])[0] : copyOf || { start_date: today() };
  const c = p.currency || home();
  openSheet(`<h2>${rentId ? 'Edit' : 'Add'} rent period</h2>
    <div class="f2">${field('start_date', 'Rented from', r.start_date, 'type="date"')}${field('end_date', 'Rented until (empty: still rented)', r.end_date, 'type="date"')}</div>
    ${field('monthly_rent', 'Rent per month (' + c + ', whole property)', r.monthly_rent)}
    ${field('tenant', 'Tenant or note (optional)', r.tenant, 'autocomplete="off"')}
    <div class="preview" id="pv"></div>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${rentId ? '<div class="btns"><button class="btn light" data-f="dup">Duplicate</button><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    const pv = () => { const d = formData(box), m = num(d.monthly_rent);
      box.querySelector('#pv').innerHTML = m > 0 ? `${whole(m * 12, c)} a year when rented all year` + (d.start_date && d.end_date ? ` · ${((dnum(d.end_date) - dnum(d.start_date) + 1) / 30.44).toFixed(1)} months` : '') : 'Enter the monthly rent.'; };
    box.oninput = pv; pv();
    box.onclick = e => { const a = e.target.dataset.f; if (!a) return;
      if (a === 'cancel') return closeSheet();
      if (a === 'dup') { const cp = Object.assign({}, r); delete cp.id; cp.start_date = r.end_date ? dstr(dnum(r.end_date) + 1) : today(); cp.end_date = null; return rentForm(propertyId, null, cp); }
      if (a === 'delete') { ask('Delete this rent period?').then(y => { if (!y) return; run('DELETE FROM rent_periods WHERE id=?', [rentId]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), m = num(d.monthly_rent);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.start_date)) return bad('Enter the date the rent started.');
      if (d.end_date && d.end_date < d.start_date) return bad('The end date is before the start date.');
      if (!(m >= 0) || Number.isNaN(m) || m == null) return bad('Enter the monthly rent.');
      const vals = [d.start_date, d.end_date || null, m, d.tenant.trim()];
      if (rentId) run('UPDATE rent_periods SET start_date=?,end_date=?,monthly_rent=?,tenant=? WHERE id=?', vals.concat([rentId]));
      else run('INSERT INTO rent_periods(property_id,start_date,end_date,monthly_rent,tenant) VALUES(?,?,?,?,?)', [propertyId].concat(vals));
      save(); closeSheet(); render(); };
  });
}
function duplicateProperty(id) {
  const p = q('SELECT * FROM properties WHERE id=?', [id])[0]; if (!p) return;
  ask('Make a copy of "' + p.name + '" with its rent periods, costs and values? You can then change what differs.', 'Duplicate').then(y => { if (!y) return;
    run('INSERT INTO properties(name,address,currency,purchase_date,purchase_price,purchase_costs,current_value,notes,owners,type) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [p.name + ' (copy)', p.address, p.currency, p.purchase_date, p.purchase_price, p.purchase_costs, p.current_value, p.notes, p.owners || 1, p.type || 'house']);
    const nid = q('SELECT last_insert_rowid() id')[0].id;
    run('INSERT INTO rent_periods(property_id,start_date,end_date,monthly_rent,tenant,notes) SELECT ?,start_date,end_date,monthly_rent,tenant,notes FROM rent_periods WHERE property_id=?', [nid, id]);
    run('INSERT INTO property_items(property_id,kind,amount,freq,start_date,end_date,note) SELECT ?,kind,amount,freq,start_date,end_date,note FROM property_items WHERE property_id=?', [nid, id]);
    run('INSERT INTO property_values(property_id,date,value,note) SELECT ?,date,value,note FROM property_values WHERE property_id=?', [nid, id]);
    state.propertyId = nid; save(); render(); view().scrollTop = 0; toast('Copy made: edit its name and amounts'); });
}
function priceForm(sym) {
  const s = spot(sym), m = METAL[sym];
  openSheet(`<h2>${m.name} price</h2>${field('price', 'Price per troy ounce', s ? s.price : '')}
    <label class="f"><span>Currency</span><select name="currency">${curOptions(s ? s.currency : 'USD')}</select></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const a = e.target.dataset.f; if (!a) return; if (a === 'cancel') return closeSheet();
      const d = formData(box), p = num(d.price); if (!(p > 0)) return bad('Enter a price.');
      run('INSERT INTO prices(symbol,price,currency,updated,source) VALUES(?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, currency=excluded.currency, updated=excluded.updated, source=excluded.source',
        [sym, p, d.currency, new Date().toISOString(), 'entered by you']);
      save(); closeSheet(); render(); };
  });
}
function fxForm(cur) {
  const H = home(), r = conv(1, H, cur);
  openSheet(`<h2>Exchange rate</h2>${field('rate', '1 ' + H + ' = how many ' + cur + '?', r == null ? '' : +r.toFixed(6))}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const a = e.target.dataset.f; if (!a) return; if (a === 'cancel') return closeSheet();
      const v = num(formData(box).rate); if (!(v > 0)) return bad('Enter a rate.');
      const now = new Date().toISOString();
      if (H === 'EUR') run('INSERT OR REPLACE INTO fx(currency,per_eur,updated,source) VALUES(?,?,?,?)', [cur, v, now, 'entered by you']);
      else if (cur === 'EUR') run('INSERT OR REPLACE INTO fx(currency,per_eur,updated,source) VALUES(?,?,?,?)', [H, 1 / v, now, 'entered by you']);
      else { if (!FX[H]) run('INSERT OR REPLACE INTO fx(currency,per_eur,updated,source) VALUES(?,?,?,?)', [H, 1, now, 'entered by you']);
        loadFx(); run('INSERT OR REPLACE INTO fx(currency,per_eur,updated,source) VALUES(?,?,?,?)', [cur, FX[H] * v, now, 'entered by you']); }
      loadFx(); save(); closeSheet(); render(); };
  });
}

/* ---------------- export / import ---------------- */
async function exportDb() {
  await saveNow();
  const r = await native('exportDb', { b64: bytesToB64(await fileBytes()), name: 'kjt-invest-' + today() + (CRYPT ? '-encrypted.itdb' : '.sqlite') });
  if (r.ok) toast('Exported' + (r.where ? ' to ' + r.where : ''));
  else if (r.error) toast('Export failed: ' + r.error);
}
async function importDb() {
  const r = await native('importDb', {});
  if (!r.b64) { if (r.error) toast('Import failed: ' + r.error); return; }
  let cand, bytes = b64ToBytes(r.b64);
  if (isEncrypted(bytes)) {
    if (!(window.crypto && crypto.subtle)) return toast('Encryption is not available on this device.');
    let o = null, msg = '';
    for (let i = 0; i < 5 && !o; i++) {
      const v = await pad({ title: 'This file is encrypted: enter its passcode', cancel: true, msg });
      if (v == null) break; o = await decryptWith(bytes, v); msg = 'Wrong passcode';
    }
    hideLock(); if (!o) return; bytes = o.plain;
  }
  try { cand = new SQL.Database(bytes); } catch (e) { return toast('That file is not a database.'); }
  if (!isOurDb(cand)) { cand.close(); return toast('That file is not a KJT Invest database.'); }
  if (!await ask('Replace everything in the app with the imported database? Export first if you want to keep what is here now.', 'Replace')) { cand.close(); return; }
  db.close(); db = cand; prepareDb(); loadFx(); await saveNow();
  state.propertyId = null; toast('Database imported'); render();
}

/* ---------------- events ---------------- */
function ask(msg, yes) {
  return new Promise(res => {
    const d = document.getElementById('dlg');
    d.querySelector('p').textContent = msg; d.querySelector('[data-y]').textContent = yes || 'Delete'; d.hidden = false;
    d.onclick = e => { const b = e.target.closest('button'); if (!b && !e.target.classList.contains('dlg-bg')) return;
      d.hidden = true; res(!!(b && b.hasAttribute('data-y'))); };
  });
}
let toastTimer;
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2600); }
document.getElementById('tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  let t = b.dataset.tab;
  if (t === 'assetsgroup') t = isAsset(state.tab) ? state.tab : (state.lastAsec || 'metals');
  if (state.tab === t || b.dataset.tab === 'assetsgroup') { state.propertyId = null; state.accountId = null; state.assetId = null; }
  state.tab = t; render(); view().scrollTop = 0; };
document.getElementById('refresh').onclick = () => updatePrices(false);
document.getElementById('settings').onclick = () => { state.tab = 'more'; render(); view().scrollTop = 0; };
document.getElementById('back').onclick = () => goBack();
function goBack() {
  const dl = document.getElementById('dlg'); if (!dl.hidden) { dl.querySelector('[data-n]').click(); return true; }
  if (!document.getElementById('sheet').hidden) { closeSheet(); return true; }
  if (state.tab === 'property' && state.propertyId) { state.propertyId = null; render(); return true; }
  if (state.tab === 'accounts' && state.accountId) { state.accountId = null; render(); return true; }
  if (state.tab === 'assets' && state.assetId) { state.assetId = null; render(); return true; }
  if (state.tab !== 'overview') { state.tab = 'overview'; render(); return true; }
  return false;
}
window.__onBack = () => goBack();
window.addEventListener('resize', () => { for (const [id, k] of [['heroS', 'hpage'], ['cfS', 'cfPage']]) { const el = document.getElementById(id); if (el) fitSwipe(el, state[k] || 0); } });
view().addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-go],[data-metal],[data-prop],[data-item],[data-pval],[data-cfy],[data-cfp],[data-rent],[data-price],[data-fx],[data-chart],[data-range],[data-acct],[data-bal],[data-asset],[data-aval],[data-hpage],[data-prange],[data-unfav],[data-ie],[data-asec]'); if (!el) return;
  const d = el.dataset;
  if (d.chart) { state.chart = d.chart; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.range) { state.range = d.range; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.go) { e.preventDefault(); state.tab = d.go; state.propertyId = null; state.accountId = null; state.assetId = null; render(); view().scrollTop = 0; }
  else if (d.metal) metalForm(+d.metal);
  else if (d.prop) { state.propertyId = +d.prop; render(); view().scrollTop = 0; }
  else if (d.item) itemForm(state.propertyId, +d.item);
  else if (d.pval) propertyValueForm(state.propertyId, +d.pval);
  else if (d.cfy) { state.cfYear = +d.cfy; if (el.classList.contains('yrow')) state.cfPage = 0; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.cfp) { state.cfPage = +d.cfp; const sc = document.getElementById('cfS'); if (sc) sc.scrollTo({ left: +d.cfp * sc.clientWidth, behavior: 'smooth' }); document.querySelectorAll('.cftabs .seg').forEach((b, j) => b.classList.toggle('on', j === +d.cfp)); }
  else if (d.rent) rentForm(state.propertyId, +d.rent);
  else if (d.asec) { state.tab = d.asec; state.propertyId = null; state.accountId = null; state.assetId = null; render(); view().scrollTop = 0; }
  else if (d.ie) { state.ieRange = d.ie; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.unfav) { setFavs(favs().filter(c => c !== d.unfav)); render(); }
  else if (d.hpage) { const sc = document.getElementById('heroS'); if (sc) sc.scrollTo({ left: +d.hpage * sc.clientWidth, behavior: 'smooth' }); }
  else if (d.prange) { state.prange = d.prange; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.asset) { state.assetId = +d.asset; render(); view().scrollTop = 0; }
  else if (d.aval) assetValueForm(state.assetId, +d.aval);
  else if (d.acct) { state.accountId = +d.acct; render(); view().scrollTop = 0; }
  else if (d.bal) balanceForm(state.accountId, +d.bal);
  else if (d.price) priceForm(d.price);
  else if (d.fx) fxForm(d.fx);
  else switch (d.act) {
    case 'add-metal': metalForm(); break;
    case 'add-property': propertyForm(); break;
    case 'edit-property': propertyForm(+d.id); break;
    case 'dup-property': duplicateProperty(+d.id); break;
    case 'add-rent': rentForm(+d.id); break;
    case 'add-account': accountForm(); break;
    case 'add-asset': assetForm(); break;
    case 'check-update': checkUpdate(true); break;
    case 'install-update': installUpdate(); break;
    case 'edit-asset': assetForm(+d.id); break;
    case 'add-avalue': assetValueForm(+d.id); break;
    case 'pin-on': case 'pin-change': case 'pin-off': securityAction(d.act); break;
    case 'edit-account': accountForm(+d.id); break;
    case 'add-balance': balanceForm(+d.id); break;
    case 'add-item': itemForm(+d.id); break;
    case 'add-pvalue': propertyValueForm(+d.id); break;
    case 'update': updatePrices(false); break;
    case 'history': toast('Loading price history…'); loadHistory(false); break;
    case 'export': exportDb(); break;
    case 'import': importDb(); break;
  }
});

/* ---------------- passcode, encryption and fingerprint ----------------
   With a passcode the database file is encrypted (AES-256-GCM). The data key is random; it is kept
   in the file wrapped with a key made from the passcode (PBKDF2-SHA-256, 310,000 rounds).
   Fingerprint / face unlock keeps a copy of the data key that only the phone's biometric hardware
   (Android Keystore) or the desktop keyring + fingerprint reader (Linux) can release.
   File: "ITENC1" | version 1 | rounds (4) | salt (16) | wrap iv (12) | wrapped key (48) | data iv (12) | data */
const ENC_MAGIC = [73, 84, 69, 78, 67, 49];   // "ITENC1"
const ENC_ROUNDS = 310000;
let CRYPT = null;      // { dek: CryptoKey, raw: Uint8Array, salt, wrapIv, wrapped, rounds }
let PREFS = {};        // small settings readable before unlocking: theme, size, passcode length, fingerprint, lock delay
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
function isEncrypted(b) { return b && b.length > 110 && ENC_MAGIC.every((v, i) => b[i] === v); }
async function kekFrom(pass, salt, rounds) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const importDek = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
function parseEnc(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 7;
  const rounds = dv.getUint32(o); o += 4;
  const salt = b.slice(o, o += 16), wrapIv = b.slice(o, o += 12), wrapped = b.slice(o, o += 48), iv = b.slice(o, o += 12);
  return { rounds, salt, wrapIv, wrapped, iv, data: b.slice(o) };
}
async function encryptBytes(plain) {
  const iv = rnd(12), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, CRYPT.dek, plain));
  const out = new Uint8Array(7 + 4 + 16 + 12 + 48 + 12 + ct.length);
  out.set(ENC_MAGIC, 0); out[6] = 1; new DataView(out.buffer).setUint32(7, CRYPT.rounds);
  let o = 11; for (const part of [CRYPT.salt, CRYPT.wrapIv, CRYPT.wrapped, iv, ct]) { out.set(part, o); o += part.length; }
  return out;
}
/* opens an encrypted file with a passcode, or with the data key itself (fingerprint); null if wrong */
async function decryptWith(b, pass, rawKey) {
  const e = parseEnc(b);
  try {
    let raw = rawKey;
    if (!raw) { const kek = await kekFrom(pass, e.salt, e.rounds); raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.wrapIv }, kek, e.wrapped)); }
    const dek = await importDek(raw);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.iv }, dek, e.data));
    return { plain, crypt: { dek, raw, salt: e.salt, wrapIv: e.wrapIv, wrapped: e.wrapped, rounds: e.rounds } };
  } catch (err) { return null; }
}
async function setPasscode(pass) {   /* new passcode: keeps the data key if there is one, wraps it again */
  const raw = CRYPT ? CRYPT.raw : rnd(32), salt = rnd(16), wrapIv = rnd(12), kek = await kekFrom(pass, salt, ENC_ROUNDS);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, kek, raw));
  CRYPT = { dek: await importDek(raw), raw, salt, wrapIv, wrapped, rounds: ENC_ROUNDS };
}
async function checkPasscode(pass) {
  try { const kek = await kekFrom(pass, CRYPT.salt, CRYPT.rounds);
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: CRYPT.wrapIv }, kek, CRYPT.wrapped));
    return raw.length === CRYPT.raw.length && raw.every((v, i) => v === CRYPT.raw[i]);
  } catch (e) { return false; }
}
async function loadPrefs() { const r = await native('getPrefs', {}); try { PREFS = JSON.parse(r.json || '{}') || {}; } catch (e) { PREFS = {}; } applyLook(); }
function savePrefs() { return native('setPrefs', { json: JSON.stringify(PREFS) }); }
const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyLook());
function applyLook() {
  const de = document.documentElement;
  de.dataset.palette = PREFS.palette || 'purple';
  const dark = PREFS.theme === 'dark' || (PREFS.theme !== 'light' && darkQuery && darkQuery.matches);
  de.dataset.mode = dark ? 'dark' : 'light';
  setTimeout(() => { const cs = getComputedStyle(de); native('statusBar', { color: cs.getPropertyValue('--head').trim(), nav: cs.getPropertyValue('--card').trim(), dark }); }, 0);
  if (PREFS.size === 'large' || PREFS.size === 'larger') de.dataset.size = PREFS.size; else delete de.dataset.size;
}

/* the keypad screen; resolves with the digits, 'BIO' or null (cancel) */
const lockEl = () => document.getElementById('lock');
let padKey = null;
function pad(o) {
  return new Promise(res => {
    const L = lockEl(); let val = '';
    const fp = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 11v3M8.5 9.5a3.5 3.5 0 0 1 7 0V14a6 6 0 0 1-1 3.3M8.5 13v1a3.5 3.5 0 0 0 1 2.5M5.5 15V10a6.5 6.5 0 0 1 11.6-4M18.5 10v3"/></svg>';
    const left = o.length ? (o.bio ? `<button class="txt" data-k="bio" aria-label="Fingerprint">${fp}</button>` : '<button class="txt" data-k="" disabled></button>') : '<button class="txt" data-k="ok">OK</button>';
    L.innerHTML = `<h2>${esc(o.title)}</h2><div class="dots"></div><div class="msg">${esc(o.msg || '')}</div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}${left}<button data-k="0">0</button><button class="txt" data-k="del" aria-label="Delete">⌫</button></div>
      ${o.cancel ? '<button class="lockbtn" data-k="cancel">Cancel</button>' : ''}`;
    L.hidden = false;
    const dots = () => { const n = o.length || Math.max(4, val.length); L.querySelector('.dots').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < val.length ? 'on' : ''}"></i>`).join(''); };
    const msg = t => { L.querySelector('.msg').textContent = t; };
    const done = v => { L.onclick = null; document.removeEventListener('keydown', padKey); padKey = null; res(v); };
    const key = k => {
      if (k === 'del') val = val.slice(0, -1);
      else if (k === 'cancel') return done(null);
      else if (k === 'bio') return done('BIO');
      else if (k === 'ok') { if (val.length >= 4) return done(val); msg('Use 4 to 8 digits'); }
      else if (/^\d$/.test(k) && val.length < (o.length || 8)) val += k;
      dots();
      if (o.length && val.length === o.length) setTimeout(() => done(val), 120);
    };
    L.onclick = e => { const b = e.target.closest('[data-k]'); if (b && b.dataset.k !== '') key(b.dataset.k); };
    if (padKey) document.removeEventListener('keydown', padKey);
    padKey = e => { if (/^\d$/.test(e.key)) key(e.key); else if (e.key === 'Backspace') key('del'); else if (e.key === 'Enter') key(o.length ? '' : 'ok'); else if (e.key === 'Escape' && o.cancel) key('cancel'); };
    document.addEventListener('keydown', padKey);
    dots();
  });
}
function hideLock() { const L = lockEl(); L.hidden = true; L.innerHTML = ''; }
async function bioAvailable() { const r = await native('bioAvailable', {}); return r.available ? (r.kind || 'fingerprint') : null; }

/* asks until the right passcode (or fingerprint); opening = the encrypted file at start */
let wrongCount = 0;
async function unlockLoop(opening) {
  const bio = PREFS.bio ? await bioAvailable() : null;
  let msg = '', triedBio = false;
  for (;;) {
    let v;
    if (bio && !triedBio) { triedBio = true; v = 'BIO'; }
    else v = await pad({ title: 'Enter your passcode', length: PREFS.pinLength || null, bio: !!bio, msg });
    if (v === 'BIO') {
      lockEl().hidden = false;
      const r = await native('bioUnlock', {});
      if (r.dek) {
        const raw = b64ToBytes(r.dek);
        if (opening) { const o = await decryptWith(opening, null, raw); if (o) { hideLock(); return o; } }
        else if (CRYPT && raw.every((x, i) => x === CRYPT.raw[i])) { hideLock(); return true; }
        msg = 'Fingerprint unlock needs setting up again (More › Security)';
      } else msg = r.error === 'changed' ? 'Fingerprints changed: use your passcode, then turn fingerprint on again' : (r.error ? '' : '');
      continue;
    }
    if (v == null) continue;
    if (wrongCount >= 5) { msg = 'Too many tries: wait 30 seconds'; await new Promise(r => setTimeout(r, 30000)); wrongCount = 3; }
    const ok = opening ? await decryptWith(opening, v) : (await checkPasscode(v) ? true : null);
    if (ok) { wrongCount = 0; hideLock(); return ok; }
    wrongCount++; msg = 'Wrong passcode';
  }
}
/* lock again after the app has been in the background (not while a file picker or fingerprint prompt is open) */
let hiddenAt = null, nativeBusy = 0, unlocking = false;
document.addEventListener('visibilitychange', async () => {
  if (!CRYPT || !db || nativeBusy) { hiddenAt = null; return; }
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt == null || unlocking) return;
  const away = Date.now() - hiddenAt; hiddenAt = null;
  if (away >= (PREFS.lockAfter || 0) * 60000) { unlocking = true; try { await unlockLoop(null); } finally { unlocking = false; } }
});

/* settings: turn on, change, turn off */
async function newPasscodeFlow(title) {
  for (;;) {
    const a = await pad({ title: title || 'Choose a passcode (4 to 8 digits)', cancel: true });
    if (a == null) { hideLock(); return null; }
    const b = await pad({ title: 'Enter it again', length: a.length, cancel: true });
    if (b == null) { hideLock(); return null; }
    if (a === b) { hideLock(); return a; }
    title = 'They were not the same. Choose a passcode';
  }
}
async function confirmCurrent() {
  for (let i = 0; i < 5; i++) {
    const v = await pad({ title: 'Enter your current passcode', length: PREFS.pinLength || null, cancel: true, msg: i ? 'Wrong passcode' : '' });
    if (v == null) { hideLock(); return false; }
    if (await checkPasscode(v)) { hideLock(); return true; }
  }
  hideLock(); return false;
}
async function securityAction(act) {
  if (!(window.crypto && crypto.subtle)) return toast('Encryption is not available on this device.');
  if (act === 'pin-on' || act === 'pin-change') {
    if (act === 'pin-change' && !await confirmCurrent()) return;
    const p = await newPasscodeFlow(); if (!p) return;
    toast('Encrypting…'); await setPasscode(p); PREFS.pinLength = p.length; if (PREFS.lockAfter == null) PREFS.lockAfter = 1;
    await savePrefs(); await saveNow(); native('secure', { on: true });
    if (PREFS.bio) await native('bioEnable', { dek: bytesToB64(CRYPT.raw) });
    toast(act === 'pin-on' ? 'Passcode on: your data file is now encrypted' : 'Passcode changed');
  } else if (act === 'pin-off') {
    if (!await confirmCurrent()) return;
    if (!await ask('Turn off the passcode? The data file will no longer be encrypted.', 'Turn off')) return;
    CRYPT = null; PREFS.pinLength = null; PREFS.bio = false; await savePrefs(); await native('bioDisable', {}); await saveNow(); native('secure', { on: false });
    toast('Passcode off');
  } else if (act === 'bio-on') {
    const r = await native('bioEnable', { dek: bytesToB64(CRYPT.raw) });
    if (r.ok) { PREFS.bio = true; await savePrefs(); toast('Fingerprint unlock on'); } else toast(r.error ? 'Not turned on: ' + r.error : 'Not turned on');
  } else if (act === 'bio-off') { PREFS.bio = false; await savePrefs(); await native('bioDisable', {}); toast('Fingerprint unlock off'); }
  render();
}
async function securityCard() {
  const bio = CRYPT ? await bioAvailable() : null;
  const on = !!CRYPT, la = PREFS.lockAfter == null ? 1 : PREFS.lockAfter;
  return `<div class="card"><h2>Security</h2>
    ${on ? `<p class="sub">Passcode on: the data file on this device and your exports are encrypted.</p>
      ${bio ? `<div class="switch"><span>Unlock with ${bio}</span><input type="checkbox" id="set-bio"${PREFS.bio ? ' checked' : ''}></div>` : ''}
      <label class="f"><span>Lock again after leaving the app</span><select id="set-lock">${[[0, 'Immediately'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [15, 'After 15 minutes']].map(([v, l]) => `<option value="${v}"${v === la ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="btns"><button class="btn light" data-act="pin-change">Change passcode</button><button class="btn danger" data-act="pin-off">Turn off</button></div>`
    : `<p class="sub">Protect the app with a number passcode. Your data file is then encrypted, and so are your exports. If you forget the passcode, nobody can open the data, so keep an exported backup and remember the passcode.</p>
      <div class="btns"><button class="btn" data-act="pin-on">Turn on passcode</button></div>`}</div>`;
}
function bindSecurity() {
  const b = document.getElementById('set-bio'); if (b) b.onchange = () => securityAction(b.checked ? 'bio-on' : 'bio-off');
  const l = document.getElementById('set-lock'); if (l) l.onchange = () => { PREFS.lockAfter = +l.value; savePrefs(); };
}

/* ---------------- income and expenses, everything together ----------------
   Income: rent and other income from the properties, and the interest the accounts earn (estimated from
   their interest rate and balance). Expenses: every property cost (condo fees, taxes, insurance, repairs…).
   Your share only, in your home currency. */
function ieModel() {
  const H = home(), m = {};
  const slot = key => (m[key] = m[key] || { rent: 0, other: 0, interest: 0, costs: 0, byKind: {} });
  for (const p of q('SELECT * FROM properties')) {
    const st = propertyStats(p), k = st.share, c = p.currency || H;
    for (const yr of st.rows) for (const f of yr.months) {
      if (!f.owned || f.future) continue;
      const key = `${f.y}-${String(f.m + 1).padStart(2, '0')}`, d = key + '-15', x = slot(key), cv = v => convOn(v * k, c, H, d) || 0;
      x.rent += cv(f.rent); x.other += cv(f.income); x.costs += cv(f.costs);
      for (const [kk, v] of Object.entries(f.byKind)) if ((PITEMS[kk] || PITEMS.other_cost)[1] === 'cost') x.byKind[kk] = (x.byKind[kk] || 0) + cv(v);
    }
  }
  const now = today();
  for (const a of q('SELECT * FROM accounts WHERE interest_rate > 0')) {
    const bs = q('SELECT date, balance FROM account_balances WHERE account_id=? ORDER BY date, id', [a.id]).map(r => [r.date, r.balance]);
    if (!bs.length) continue;
    const k = 1 / Math.max(1, a.owners || 1), c = a.currency || H;
    let y = +bs[0][0].slice(0, 4), mo = +bs[0][0].slice(5, 7);
    for (;;) { const key = `${y}-${String(mo).padStart(2, '0')}`; if (key > now.slice(0, 7)) break;
      const bal = lastOnOrBefore(bs, key + '-28'); if (bal > 0) slot(key).interest += convOn(bal * a.interest_rate / 100 / 12 * k, c, H, key + '-15') || 0;
      mo++; if (mo > 12) { mo = 1; y++; } }
  }
  return m;
}
function ieRange(model, range) {
  const now = today(), ym = now.slice(0, 7), yNow = +now.slice(0, 4);
  let keys = [];
  if (range === 'Y') keys = Array.from({ length: +now.slice(5, 7) }, (_, i) => `${yNow}-${String(i + 1).padStart(2, '0')}`);
  else if (range === 'PY') keys = Array.from({ length: 12 }, (_, i) => `${yNow - 1}-${String(i + 1).padStart(2, '0')}`);
  else { let y = yNow, mo = +now.slice(5, 7); for (let i = 0; i < 12; i++) { keys.unshift(`${y}-${String(mo).padStart(2, '0')}`); mo--; if (!mo) { mo = 12; y--; } } }
  const t = { rent: 0, other: 0, interest: 0, costs: 0, byKind: {}, months: [] };
  for (const key of keys) { const x = model[key] || { rent: 0, other: 0, interest: 0, costs: 0, byKind: {} };
    t.rent += x.rent; t.other += x.other; t.interest += x.interest; t.costs += x.costs;
    for (const [kk, v] of Object.entries(x.byKind)) t.byKind[kk] = (t.byKind[kk] || 0) + v;
    t.months.push({ key, inc: x.rent + x.other + x.interest, out: x.costs, current: key === ym }); }
  t.income = t.rent + t.other + t.interest; t.net = t.income - t.costs;
  return t;
}
function ieCard() {
  const H = home(), model = ieModel();
  if (!Object.keys(model).length) return `<div class="card"><p class="sub">Add rent periods and costs to your properties, and interest rates to your savings accounts, to see your income and expenses here.</p></div>`;
  state.ieRange = state.ieRange || 'L12';
  const t = ieRange(model, state.ieRange), yNow = new Date().getFullYear();
  const segs = [['L12', 'Last 12 months'], ['Y', String(yNow) + ' so far'], ['PY', String(yNow - 1)]].map(([kk, l]) => `<button class="seg${state.ieRange === kk ? ' on' : ''}" data-ie="${kk}">${l}</button>`).join('');
  const max = Math.max(1, ...t.months.map(x => Math.max(x.inc, x.out)));
  const bars = `<div class="iebars">${t.months.map(x => `<div class="ieb${x.current ? ' cur' : ''}"><div class="iebp"><i class="in" style="height:${(x.inc / max * 100).toFixed(1)}%"></i><i class="out" style="height:${(x.out / max * 100).toFixed(1)}%"></i></div><span>${MONTHS[+x.key.slice(5, 7) - 1][0]}</span></div>`).join('')}</div>
    <div class="legend"><span><i class="lin"></i>Income</span><span><i class="lout"></i>Expenses</span></div>`;
  const rows = (list, total) => list.filter(([, v]) => v > 0.5).map(([l, v]) => `<div class="arow ie"><span class="al">${l}</span><span class="av">${whole(v, H)}</span><span class="ap">${total ? Math.round(v / total * 100) + '%' : ''}</span></div>`).join('') || '<p class="sub">None in this period.</p>';
  const inc = [['Rent', t.rent], ['Other income', t.other], ['Interest (estimated)', t.interest]];
  const exp = Object.entries(t.byKind).sort((a, b) => b[1] - a[1]).map(([kk, v]) => [esc((PITEMS[kk] || PITEMS.other_cost)[0]), v]);
  const n = t.months.length || 1;
  return `<div class="card"><div class="segs">${segs}</div>
    <div class="ie3"><div class="stat"><div class="k">Income</div><div class="v up">${whole(t.income, H)}</div></div>
      <div class="stat"><div class="k">Expenses</div><div class="v down">${whole(t.costs, H)}</div></div>
      <div class="stat"><div class="k">Net</div><div class="v ${signCls(t.net)}">${whole(t.net, H)}</div></div></div>
    <p class="sub" style="margin:8px 0">${whole(t.income / n, H)} in and ${whole(t.costs / n, H)} out a month on average${t.income ? ` · you keep <b class="${signCls(t.net)}">${Math.round(t.net / t.income * 100)}%</b> of your income` : ''}.</p>
    ${bars}
    <h3 class="ieh">Income</h3><div class="alloc">${rows(inc, t.income)}</div>
    <h3 class="ieh">Expenses</h3><div class="alloc">${rows(exp, t.costs)}</div>
    <p class="sub" style="margin:10px 0 0">From your properties (your share) and the interest your accounts earn, estimated from their rate and balance.</p></div>`;
}

/* ---------------- updates ----------------
   The app looks at one small public file (latest.json on the project's GitHub) to see whether a newer version exists.
   Android downloads the new app file, checks it, and the phone asks you to confirm the update.
   Linux updates come through GNOME Software (the app's own channel). Nothing about you is sent. */
const UPDATE_URL = 'https://raw.githubusercontent.com/BibleCorner-KJT/kjt-invest/releases/latest.json';
let updateInfo = null, appInfo = null;
function newerThan(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
async function checkUpdate(manual) {
  appInfo = appInfo || await native('appInfo', {});
  const plat = appInfo.platform || 'browser';
  const r = await native('httpGet', { url: UPDATE_URL + '?t=' + Math.floor(Date.now() / 600000) });
  let d = null; try { d = JSON.parse(r.body || ''); } catch (e) { d = null; }
  setSetting('update_checked', new Date().toISOString()); save();
  if (!d) { if (manual) toast('Could not check for updates (no connection?)'); return; }
  const it = d[plat];
  if (it && newerThan(it.version, APP_VERSION)) { updateInfo = Object.assign({ platform: plat }, it); showUpdateBar(); if (manual) toast('KJT Invest ' + it.version + ' is available'); }
  else { updateInfo = null; showUpdateBar(); if (manual) toast('You have the newest version (' + APP_VERSION + ')'); }
}
function showUpdateBar() {
  const b = document.getElementById('upd'); if (!b) return;
  if (!updateInfo) { b.hidden = true; return; }
  b.innerHTML = `<span><b>KJT Invest ${esc(updateInfo.version)}</b> is ready${updateInfo.notes ? ': ' + esc(updateInfo.notes) : ''}</span><button class="btn" id="upd-go">${updateInfo.platform === 'android' ? 'Update' : 'How to update'}</button>`;
  b.hidden = false;
  document.getElementById('upd-go').onclick = installUpdate;
}
async function installUpdate() {
  if (!updateInfo) return;
  if (updateInfo.platform === 'android') {
    toast('Downloading the update…');
    const r = await native('installUpdate', { url: updateInfo.url, sha256: updateInfo.sha256 || '' });
    if (r.error) toast('Update not installed: ' + r.error); else toast('Confirm the update on the screen that opens');
  } else if (updateInfo.platform === 'linux') {
    const f = updateInfo[(appInfo && appInfo.arch) || 'x86_64'];
    if (f && f.url) {
      toast('Downloading the update…');
      const r = await native('installUpdate', { url: f.url, sha256: f.sha256 || '' });
      if (r.error) toast('Update not downloaded: ' + r.error); else toast('Software opens with the new version: press Install (your data stays)');
    } else { await native('openUrl', { url: updateInfo.page }); toast('The download page opened in your browser'); }
  }
}
window.__updateStatus = msg => toast(msg);

/* ---------------- start ---------------- */
(async function start() {
  try {
    try {
      if (typeof WebAssembly !== 'object') throw new Error('no WebAssembly');
      SQL = await initSqlJs({ wasmBinary: b64ToBytes(window.SQL_WASM_B64).buffer });
    } catch (e) {
      /* devices without WebAssembly use the slower plain-JavaScript SQLite */
      await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'sql-asm.js'; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
      SQL = await initSqlJs();
    }
    await loadPrefs();
    const r = await native('loadDb', {});
    let opened = null;
    if (r.b64) {
      let bytes = b64ToBytes(r.b64);
      if (isEncrypted(bytes)) {
        if (!(window.crypto && crypto.subtle)) throw new Error('Your data is encrypted, but encryption is not available on this device.');
        const o = await unlockLoop(bytes); CRYPT = o.crypt; bytes = o.plain;
      }
      /* a file that cannot be opened is never overwritten */
      try { opened = new SQL.Database(bytes); } catch (e) { throw new Error('The data file could not be opened. It was not changed. A copy of it from the last start is kept as portfolio.backup.sqlite.'); }
      if (!isOurDb(opened)) throw new Error('The data file is not a KJT Invest database. It was not changed.');
    }
    db = opened || new SQL.Database();
    native('secure', { on: !!CRYPT });
    prepareDb(); loadFx();
    await saveNow();   /* also stores any upgrade of an older database */
    render();
    if (getSetting('auto_update', '1') === '1') { const uc = getSetting('update_checked'); if (!uc || Date.now() - new Date(uc) > 3600000) setTimeout(() => checkUpdate(false), 4000); }
    const last = getSetting('prices_updated');
    if (getSetting('auto_prices', '1') === '1' && (!last || Date.now() - new Date(last) > 15 * 60000)) updatePrices(true);
  } catch (e) {
    view().innerHTML = `<div class="card"><h2>Could not start</h2><p class="sub">${esc(e && e.message || e)}</p></div>`;
  }
})();
