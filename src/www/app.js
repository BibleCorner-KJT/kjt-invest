/* KJT Invest 1.9 (Knowing Jesus Today) - one screen code for the Android and Linux apps.
   All data stays in one SQLite file on the device. The only network calls are the
   price updates (metal prices from gold-api.com, exchange rates from the European Central Bank). */
'use strict';

const APP_VERSION = '1.9';
const SCHEMA = 8;
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
const ACCT_TYPES = { chequing: 'Chequing', savings: 'Savings', cash: 'Cash', gic: 'GIC / term deposit', credit: 'Credit card', other: 'Other' };
const ACCT_GROUP = { credit: 'Credit cards' };
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
const LEAVES_APP = ['exportDb', 'importDb', 'bioUnlock', 'bioEnable', 'print'];
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
    else if (cmd === 'print') { window.print(); reply({ ok: true }); }
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
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER, kind TEXT NOT NULL DEFAULT 'out', sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, amount REAL NOT NULL,
  category_id INTEGER, payee TEXT, note TEXT, to_account_id INTEGER, link TEXT, recurring_id INTEGER, created INTEGER);
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS tx_acct ON transactions(account_id, date);
CREATE TABLE IF NOT EXISTS recurring (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, kind TEXT NOT NULL, amount REAL NOT NULL, category_id INTEGER,
  payee TEXT, note TEXT, to_account_id INTEGER, link TEXT, freq TEXT NOT NULL, next_date TEXT NOT NULL, end_date TEXT, auto INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS loans (id INTEGER PRIMARY KEY, person TEXT NOT NULL, amount REAL NOT NULL, currency TEXT, date TEXT NOT NULL, due_date TEXT,
  rate REAL, notes TEXT, closed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS loan_payments (id INTEGER PRIMARY KEY, loan_id INTEGER NOT NULL, date TEXT NOT NULL, principal REAL DEFAULT 0, interest REAL DEFAULT 0,
  account_id INTEGER, note TEXT);
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
  /* 1.8: credit card limits; your share as a percentage (unequal shares) and the co-owners' names */
  const acols = q('PRAGMA table_info(accounts)').map(r => r.name);
  if (!acols.includes('credit_limit')) run('ALTER TABLE accounts ADD COLUMN credit_limit REAL');
  /* when a transaction and a balance check fall on the same day, the one entered later counts as later */
  if (!q('PRAGMA table_info(account_balances)').some(r => r.name === 'created')) run('ALTER TABLE account_balances ADD COLUMN created INTEGER');
  if (!q('PRAGMA table_info(transactions)').some(r => r.name === 'created')) run('ALTER TABLE transactions ADD COLUMN created INTEGER');
  /* 1.9: bank file import remembers what it imported; categories for transfers and loans */
  if (!q('PRAGMA table_info(transactions)').some(r => r.name === 'import_id')) run('ALTER TABLE transactions ADD COLUMN import_id TEXT');
  run('CREATE INDEX IF NOT EXISTS tx_import ON transactions(import_id)');
  for (const tb of ['properties', 'accounts', 'other_assets']) {
    const tc = q(`PRAGMA table_info(${tb})`).map(r => r.name);
    if (!tc.includes('share_pct')) { run(`ALTER TABLE ${tb} ADD COLUMN share_pct REAL`); run(`UPDATE ${tb} SET share_pct = 100.0 / owners WHERE owners > 1`); }
    if (!tc.includes('co_owners')) run(`ALTER TABLE ${tb} ADD COLUMN co_owners TEXT`);
  }
  if (!getSetting('cats_seeded')) { seedCategories(); setSetting('cats_seeded', '1'); }
  if (!getSetting('cats_v19')) {
    const addCat = (name, kind, subs) => { if (q('SELECT id FROM categories WHERE parent_id IS NULL AND name=?', [name]).length) return;
      run('INSERT INTO categories(name,parent_id,kind,sort) VALUES(?,?,?,?)', [name, null, kind, 900]); const pid = q('SELECT last_insert_rowid() id')[0].id;
      for (const sname of subs) run('INSERT INTO categories(name,parent_id,kind,sort) VALUES(?,?,?,?)', [sname, pid, kind, 901]); };
    addCat('Transfers & card payments', 'save', []); addCat('Loans', 'save', ['Lent', 'Repaid']);
    setSetting('cats_v19', '1'); clearCats();
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
  const share = shareOf(p), owners = share < 1 ? Math.max(2, Math.round(1 / share)) : 1;
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
/* your share of something owned with others: a percentage (1.8), or equal shares from earlier versions */
function shareOf(r) { if (r && r.share_pct > 0 && r.share_pct <= 100) return r.share_pct / 100; return 1 / Math.max(1, (r && r.owners) || 1); }
function shareLbl(r) { return +(shareOf(r) * 100).toFixed(2) + '%'; }
function shareFields(r) {
  return `<div class="f2">${field('share_pct', 'Your share (%)', r && r.share_pct ? +(+r.share_pct).toFixed(4) : (r && r.owners > 1 ? +(100 / r.owners).toFixed(4) : 100), 'inputmode="decimal"')}
    ${field('co_owners', 'Owned with (optional)', r && r.co_owners, 'autocomplete="off" placeholder="names"')}</div>
    <p class="hint">100% if it is all yours. Enter the whole amounts; the app shows your share.</p>`;
}
function readShare(d) {   /* -> [share_pct, owners, co_owners] or null */
  const s = num(String(d.share_pct == null ? '100' : d.share_pct).replace('%', ''));
  if (s == null) return [100, 1, (d.co_owners || '').trim()];
  if (!(s > 0 && s <= 100)) return null;
  return [s, s >= 100 ? 1 : Math.max(2, Math.round(100 / s)), (d.co_owners || '').trim()];
}
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
  let cash = 0, debt = 0;
  for (const a of q('SELECT * FROM accounts')) {
    const b = acctBalance(a.id); if (!b) continue;
    const v = conv(b.balance * shareOf(a), a.currency || H, H);
    if (v == null) { missing = true; continue; } cash += v; if (v < 0) debt -= v;
  }
  const lt = loansTotal();
  let other = 0, otherCost = 0;
  for (const a of q('SELECT * FROM other_assets')) {
    const v = assetValue(a.id); if (!v) continue; const k = shareOf(a);
    const hv = conv(v.value * k, a.currency || H, H); if (hv == null) { missing = true; continue; }
    other += hv; otherCost += conv((a.purchase_price != null ? a.purchase_price : v.value) * k, a.currency || H, H) || 0;
  }
  return { other, otherCost, cash, metals, metalsCost, metalsM, metalsCostM, re, reInvested, reIncome, reLastNet, reLastYear, debt, loans: lt.total, total: metals + re + cash + other + lt.total, missing: missing || lt.missing };
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
/* Menus: Overview · Assets (Metals, Property, Accounts, Loans, Other assets) · Cash flow · Prices (metal prices, currencies) */
/* small coloured pictures for the sub-menus */
const SUBICON = {
  metals: () => metalIcon('XAU', 'bar', 22),
  property: () => `<svg class="sico" viewBox="0 0 24 24"><path class="f" d="M5 10.5 12 5l7 5.5V20H5z"/><path d="M3 11.5 12 4l9 7.5M5 10v10h14V10M10 20v-5.5h4V20"/></svg>`,
  accounts: () => `<svg class="sico" viewBox="0 0 24 24"><rect class="f" x="3" y="7.5" width="18" height="12.5" rx="2.5"/><path d="M5.5 7.5 15.5 4l1.2 3.5M21 12h-4.5a1.75 1.75 0 0 0 0 3.5H21"/></svg>`,
  loans: () => `<svg class="sico" viewBox="0 0 24 24"><circle class="f" cx="15.5" cy="6.5" r="3"/><path d="M2.5 16l3.5-.5 4 2.5h4a1.5 1.5 0 0 0 0-3h-3M6 15.5l4.2-3.2a2 2 0 0 1 2.3-.1l2.5 1.8 4.5-1.6"/><circle cx="15.5" cy="6.5" r="3"/></svg>`,
  assets: () => `<svg class="sico" viewBox="0 0 24 24"><path class="f" d="M3 16v-3l2-5h14l2 5v3z"/><path d="M3 16v-3l2-5h14l2 5v3zM5 13h14"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/></svg>`,
  tx: () => `<svg class="sico" viewBox="0 0 24 24"><rect class="f" x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`,
  reports: () => `<svg class="sico" viewBox="0 0 24 24"><path class="f" d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M12 3a9 9 0 1 0 9 9h-9zM15 3.5A8 8 0 0 1 20.5 9H15z"/></svg>`,
  recurring: () => `<svg class="sico" viewBox="0 0 24 24"><circle class="f" cx="12" cy="12" r="8.5" stroke="none"/><path d="M19.5 9A8 8 0 0 0 5 7.5M4.5 15A8 8 0 0 0 19 16.5M5 3.5v4h4M19 20.5v-4h-4"/></svg>`,
  categories: () => `<svg class="sico" viewBox="0 0 24 24"><path class="f" d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8" cy="8" r="1.5"/></svg>`,
};
const subBtn = (k, l, on, attr) => `<button class="${on ? 'on' : ''}" ${attr}="${k}">${SUBICON[k] ? SUBICON[k]() : ''}<span>${l}</span></button>`;
const ASECS = [['metals', 'Metals'], ['property', 'Property'], ['accounts', 'Accounts'], ['loans', 'Loans'], ['assets', 'Other']];
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
  else if (state.tab === 'loans') state.loanId ? renderLoan(state.loanId) : renderLoans();
  else if (state.tab === 'currency') renderMarkets();
  else if (state.tab === 'money') renderMoney();
  else renderMore();
  const inDetail = state.propertyId && state.tab === 'property' || state.accountId && state.tab === 'accounts' || state.assetId && state.tab === 'assets' || state.loanId && state.tab === 'loans';
  if (isAsset(state.tab) && !inDetail) {
    setTitle('Assets');
    view().insertAdjacentHTML('afterbegin', `<div class="subnav">${ASECS.map(([k, l]) => subBtn(k, l, k === state.tab, 'data-asec')).join('')}</div>`);
  }
  enhanceView();
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
  const nAll = ['metal_holdings', 'properties', 'accounts', 'other_assets', 'loans'].reduce((n, tb) => n + q(`SELECT COUNT(*) n FROM ${tb}`)[0].n, 0);
  let h = missingWarn() + `<h2 class="sect">Summary <span class="sub">swipe the box for more</span></h2>` + heroHtml(t);
  if (!nAll) {
    h += `<div class="card"><h2>Welcome</h2><p class="sub">Add what you own. Everything stays on this device, in one file you can export at any time.</p>
      <div class="btns"><button class="btn" data-act="add-metal">Add precious metal</button><button class="btn" data-act="add-property">Add property</button><button class="btn" data-act="add-account">Add bank account</button><button class="btn" data-act="add-asset">Add other asset</button></div></div>`;
  }
  const M = mcur(), mGain = t.metalsM - t.metalsCostM;
  h += remindersCard();
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
    <div class="row strong"><span class="k">Balance${t.debt > 0.005 ? ' (less credit cards)' : ''}</span><span class="v ${t.cash < 0 ? 'down' : ''}">${whole(t.cash, H)}</span></div>
    ${t.debt > 0.005 ? `<div class="row"><span class="k">Owed on credit cards</span><span class="v down">${whole(t.debt, H)}</span></div>` : ''}</div>`;
  h += `<div class="card tap" data-go="assets"><div class="phead"><span class="pbadge">${assetIcon('car')}</span><h2 style="margin:0">Other assets</h2></div>
    <div class="row strong"><span class="k">Value (your estimate)</span><span class="v">${whole(t.other, H)}</span></div>
    ${t.otherCost ? `<div class="row"><span class="k">Paid</span><span class="v">${whole(t.otherCost, H)}</span></div>` : ''}</div>`;
  if (q('SELECT COUNT(*) n FROM loans')[0].n) h += `<div class="card tap" data-go="loans"><div class="phead"><span class="pbadge">${loanIcon()}</span><h2 style="margin:0">Loans you made</h2></div>
    <div class="row strong"><span class="k">Owed to you</span><span class="v">${whole(t.loans, H)}</span></div></div>`;
  h += `<h2 class="sect">Income & expenses</h2>` + ieCard();
  h += `<h2 class="sect">Current prices <span class="sub">${mcur()} per troy ounce</span></h2><div class="card">${priceStrip()}</div>`;
  if (nAll) h += `<button class="btn wide light" data-act="print-report">Print the report or save it as a PDF</button>`;
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
    const v = assetValue(a.id), c = a.currency || H, k = shareOf(a);
    const val = v ? v.value * k : null, cost = a.purchase_price != null ? a.purchase_price * k : null;
    const hv = conv(val, c, H); if (hv != null) { total += hv; paid += conv(cost, c, H) || 0; }
    const ch = val != null && cost ? val / cost - 1 : null;
    body += `<div class="txn" data-asset="${a.id}"><div class="txn-top"><span class="ticon">${assetIcon(a.type, 22)}</span><span class="txn-date">${a.purchase_date ? 'bought ' + fmtDate(a.purchase_date, true) : (ASSET_TYPES[a.type] || ASSET_TYPES.other)[0]}</span><span class="txn-desc">${esc(a.name)}</span></div>
      <div class="txn-body"><div class="sub">${(ASSET_TYPES[a.type] || ASSET_TYPES.other)[0]}${cost != null ? ' · paid ' + money(cost, c, { dec: 0 }) : ''}${shareOf(a) < 1 ? ' · your share ' + shareLbl(a) : ''}</div>
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
  const c = a.currency || home(), k = shareOf(a), vs = q('SELECT * FROM asset_values WHERE asset_id=? ORDER BY date DESC, id DESC', [id]), v = vs[0];
  const val = v ? v.value * k : null, cost = a.purchase_price != null ? a.purchase_price * k : null;
  let h = `<div class="card"><div class="phead"><span class="pbadge">${assetIcon(a.type)}</span><div><h3>${(ASSET_TYPES[a.type] || ASSET_TYPES.other)[0]}</h3>${a.purchase_date ? `<div class="sub">Bought ${fmtDate(a.purchase_date)}</div>` : ''}</div></div>
    ${shareOf(a) < 1 ? `<div class="note" style="margin-top:10px">Your share is ${shareLbl(a)}${a.co_owners ? ' (owned with ' + esc(a.co_owners) + ')' : ''}: amounts show your share.</div>` : ''}
    <div class="row strong" style="margin-top:8px"><span class="k">Value (your estimate)</span><span class="v">${val == null ? '—' : money(val, c, { dec: 0 })}</span></div>
    ${cost != null ? `<div class="row"><span class="k">Paid</span><span class="v">${money(cost, c, { dec: 0 })}</span></div>
    <div class="row"><span class="k">Change</span><span class="v ${signCls(val - cost)}">${val == null ? '—' : money(val - cost, c, { dec: 0 }) + ' (' + pct(val / cost - 1) + ')'}</span></div>` : ''}
    <div class="btns"><button class="btn" data-act="add-avalue" data-id="${a.id}">Update value</button><button class="btn light" data-act="edit-asset" data-id="${a.id}">Edit</button></div></div>`;
  h += `<div class="card"><h2>Value history</h2>` + (vs.length ? `<div class="txns">` + vs.map((r, i) => { const p = vs[i + 1], ch = p ? r.value - p.value : null;
    return `<div class="txn" data-aval="${r.id}"><div class="txn-top"><span class="txn-date">${fmtDate(r.date)}</span><span class="txn-desc">${esc(r.note || '')}</span></div>
      <div class="txn-body"><div class="sub ${signCls(ch)}">${ch == null ? '' : (ch >= 0 ? '+' : '') + money(ch, c, { dec: 0 })}</div><div class="r"><div class="strongv">${money(r.value, c, { dec: 0 })}</div></div></div></div>`; }).join('') + `</div>` : '<p class="sub">No values yet.</p>') + `</div>`;
  h += linkedTxHtml('asset:' + a.id, 'Transactions linked to this') + `<button class="btn wide light" data-act="add-tx" data-link="asset:${a.id}">+ Transaction for this</button>`;
  view().innerHTML = h;
}
function assetForm(id, copyOf) {
  const a = id ? q('SELECT * FROM other_assets WHERE id=?', [id])[0] : copyOf || { type: 'car', currency: home(), purchase_date: today() };
  openSheet(`<h2>${id ? 'Edit' : copyOf ? 'Copy of' : 'Add'} asset</h2>
    <div class="f"><span class="flabel">Type</span><div class="ptypes">${Object.entries(ASSET_TYPES).map(([k, [l]]) => `<label class="ptype"><input type="radio" name="type" value="${k}"${k === (a.type || 'car') ? ' checked' : ''}><span>${assetIcon(k, 28)}<b>${l}</b></span></label>`).join('')}</div></div>
    ${field('name', 'Name', a.name, 'autocomplete="off" placeholder="e.g. 2021 Toyota RAV4"')}
    <div class="f2">${field('purchase_date', 'Date bought', a.purchase_date, 'type="date"')}<label class="f"><span>Currency</span><select name="currency">${curOptions(a.currency || home())}</select></label></div>
    <div class="f2">${field('purchase_price', 'Price paid', a.purchase_price)}${id ? '' : field('value', 'Worth today (your estimate)', null)}</div>
    ${shareFields(a)}
    <label class="f"><span>Notes</span><textarea name="notes">${esc(a.notes)}</textarea></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn light" data-f="dup">Duplicate</button><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'dup') { const cp = Object.assign({}, a); delete cp.id; cp.name = a.name + ' (copy)'; return assetForm(null, cp); }
      if (f === 'delete') { ask('Delete this asset and its value history?').then(y => { if (!y) return;
        run('DELETE FROM asset_values WHERE asset_id=?', [id]); run('DELETE FROM other_assets WHERE id=?', [id]); run('UPDATE transactions SET link=NULL WHERE link=?', ['asset:' + id]); run('UPDATE recurring SET link=NULL WHERE link=?', ['asset:' + id]); state.assetId = null; save(); closeSheet(); render(); }); return; }
      const d = formData(box), pp = num(d.purchase_price), v = id ? null : num(d.value);
      if (!d.name.trim()) return bad('Give it a name.');
      if (Number.isNaN(pp) || Number.isNaN(v)) return bad('Check the amounts.');
      const sh = readShare(d); if (!sh) return bad('Your share is a percentage from 1 to 100.');
      const vals = [d.name.trim(), d.type || 'other', d.purchase_date || null, pp, d.currency, sh[1], d.notes.trim(), sh[0], sh[2]];
      if (id) run('UPDATE other_assets SET name=?,type=?,purchase_date=?,purchase_price=?,currency=?,owners=?,notes=?,share_pct=?,co_owners=? WHERE id=?', vals.concat([id]));
      else { run('INSERT INTO other_assets(name,type,purchase_date,purchase_price,currency,owners,notes,share_pct,co_owners) VALUES(?,?,?,?,?,?,?,?,?)', vals);
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
  for (const a of q('SELECT * FROM accounts')) { const k = shareOf(a), c = a.currency || H;
    const f1 = q('SELECT MIN(date) d FROM account_balances WHERE account_id=?', [a.id])[0].d, f2 = q('SELECT MIN(date) d FROM transactions WHERE account_id=? OR to_account_id=?', [a.id, a.id])[0].d;
    const from = [f1, f2].filter(Boolean).sort()[0]; if (!from) continue;
    items.push({ kind: 'c', from, at: d => { const b = acctBalance(a.id, d); return b == null ? 0 : convOn(b.balance * k, c, H, d); }, paid: null }); }
  for (const l of q('SELECT * FROM loans')) { const c = l.currency || H;
    items.push({ kind: 'l', from: l.date, at: d => convOn(loanStats(l, d).owed, c, H, d), paid: d => convOn(loanStats(l, d).owed, c, H, d) }); }
  for (const a of q('SELECT * FROM other_assets')) { const k = shareOf(a), c = a.currency || H;
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
  const H = home(), parts = { metals: t.metals, re: t.re, cash: Math.max(0, t.cash), other: t.other + (t.loans || 0) };
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
      <div class="sub" style="margin-top:6px"><a href="#" data-go="markets">Prices, sources and the price chart are under Prices ›</a></div></div>`
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
  h += linkedTxHtml('metal:%', 'Transactions linked to your metals');
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
      <div class="sub">${(PROP_TYPES[p.type] || PROP_TYPES.house)[0]}${p.address ? ' · ' + esc(p.address) : ''}${s.share < 1 ? ' · your share ' + shareLbl(p) : ''}</div></div></div>
      <div class="grid2" style="margin-top:10px">
        <div class="stat"><div class="k">Value${s.share < 1 ? ' (your share)' : ''}</div><div class="v">${whole(s.value * k, c)}</div></div>
        <div class="stat"><div class="k">Invested${s.share < 1 ? ' (your share)' : ''}</div><div class="v">${whole(s.invested * k, c)}</div></div>
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
    ${s.share < 1 ? `<div class="note" style="margin-top:10px">Your share is ${shareLbl(p)}${p.co_owners ? ' (owned with ' + esc(p.co_owners) + ')' : ''}: amounts show your share. Whole property value ${whole(s.value, c)}.</div>` : ''}
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
      <div class="txn-body"><div class="sub">Rent${s.share < 1 ? ' (whole property)' : ''}</div><div class="r"><div class="strongv">${money(r.monthly_rent, c, { dec: 0 })} <span class="freq">a month</span></div></div></div></div>`).join('') + `</div>`;
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
      <div class="txn-body"><div class="sub">${s.share < 1 ? 'whole property' : ''}</div><div class="r"><div class="strongv">${money(r.value, c, { dec: 0 })}</div></div></div></div>`).join('') + `</div>` : '<p class="sub">Add what you think it is worth now and then; the value between dates is drawn as a straight line.</p>') +
    `<button class="btn wide light" data-act="add-pvalue" data-id="${p.id}">+ Update value</button></div>`;
  h += linkedTxHtml('property:' + p.id, 'Transactions linked to this property') + `<button class="btn wide light" data-act="add-tx" data-link="property:${p.id}">+ Transaction for this property</button>`;
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
  state.txAcct = '';
  const H = home(), as = q('SELECT * FROM accounts ORDER BY type, name');
  let h = missingWarn(), total = 0, yearly = 0;
  const groups = {};
  for (const a of as) (groups[a.type] = groups[a.type] || []).push(a);
  let body = '';
  let owed = 0;
  for (const [type, label] of Object.entries(ACCT_TYPES)) {
    const list = groups[type]; if (!list) continue;
    body += `<div class="card"><h2>${ACCT_GROUP[type] || label}</h2><div class="txns">` + list.map(a => {
      const b = acctBalance(a.id), c = a.currency || H, share = shareOf(a), cr = a.type === 'credit';
      const mine = b ? b.balance * share : null, hv = conv(mine, c, H); if (hv != null) { total += hv; if (cr) owed -= hv; }
      if (mine != null && a.interest_rate && !cr) yearly += conv(mine * a.interest_rate / 100, c, H) || 0;
      const used = cr && a.credit_limit > 0 && b ? -b.balance / a.credit_limit : null;
      return `<div class="txn${cr ? ' cost' : ''}" data-acct="${a.id}"><div class="txn-top"><span class="txn-date">${b ? (cr ? 'owed ' : '') + 'as of ' + fmtDate(b.date) : 'no balance yet'}</span><span class="txn-desc">${esc(a.name)}</span></div>
        <div class="txn-body"><div class="sub">${esc(a.institution || label)}${a.interest_rate && !cr ? ' · ' + a.interest_rate + '% interest' : ''}${cr && a.credit_limit ? ' · limit ' + money(a.credit_limit, c, { dec: 0 }) : ''}${shareOf(a) < 1 ? ' · your share ' + shareLbl(a) : ''}</div>
        <div class="r"><div class="strongv${cr && mine < 0 ? ' down' : ''}">${mine == null ? '—' : money(mine, c)}</div>${used != null ? `<div class="sub${used > .7 ? ' down' : ''}">${Math.round(used * 100)}% used</div>` : ''}</div></div>
        ${used != null ? limitBar(used) : ''}</div>`; }).join('') + `</div></div>`;
  }
  h += `<h2 class="sect">Total</h2><div class="card hero"><div class="label">Cash & bank (${H})</div><div class="big">${whole(total, H)}</div>
    ${owed > 0.005 ? `<div class="sub">${whole(total + owed, H)} in accounts and cash, less ${whole(owed, H)} owed on credit cards</div>` : ''}
    ${yearly ? `<div class="sub">About ${whole(yearly, H)} interest a year</div>` : ''}</div>`;
  h += `<h2 class="sect">Your accounts</h2>`;
  h += as.length ? body : `<div class="card empty">No accounts yet. Add your chequing and savings accounts, credit cards, and cash on hand.</div>`;
  h += `<button class="btn wide" data-act="add-account">+ Add account</button>`;
  view().innerHTML = h;
}
function limitBar(used) { const u = Math.max(0, Math.min(1, used)); return `<div class="limitbar${used > .7 ? ' hi' : ''}"><i style="width:${(u * 100).toFixed(1)}%"></i></div>`; }
function renderAccount(id) {
  const a = q('SELECT * FROM accounts WHERE id=?', [id])[0];
  if (!a) { state.accountId = null; return renderAccounts(); }
  setTitle(a.name, true);
  const c = a.currency || home(), cr = a.type === 'credit', bs = q('SELECT * FROM account_balances WHERE account_id=? ORDER BY date DESC, id DESC', [id]);
  const share = shareOf(a), b = acctBalance(id);
  let h;
  if (cr) {
    const owed = b ? -b.balance : 0, lim = a.credit_limit || 0, used = lim ? owed / lim : null;
    h = `<div class="card hero"><div class="label">Credit card${a.institution ? ' · ' + esc(a.institution) : ''}</div>
      <div class="big ${owed > 0 ? 'down' : ''}">${b ? money(owed, c) : '—'}</div><div class="sub">owed${b ? ' as of ' + fmtDate(b.date) : ''}${share < 1 ? ' · your share ' + shareLbl(a) + ': ' + money(owed * share, c) : ''}</div>
      ${lim ? `${limitBar(used)}<div class="ie3" style="margin-top:10px"><div class="stat"><div class="k">Limit</div><div class="v">${money(lim, c, { dec: 0 })}</div></div><div class="stat"><div class="k">Available</div><div class="v ${lim - owed < 0 ? 'down' : 'up'}">${money(lim - owed, c, { dec: 0 })}</div></div><div class="stat"><div class="k">Used</div><div class="v ${used > .7 ? 'down' : ''}">${Math.round(used * 100)}%</div></div></div>` : '<p class="sub">Add the credit limit (Edit) to see what is still available.</p>'}
      ${a.interest_rate ? `<div class="sub" style="margin-top:8px">${a.interest_rate}% interest a year on what is not paid in time</div>` : ''}
      <div class="btns"><button class="btn" data-act="add-tx" data-acct-id="${a.id}">+ Expense</button><button class="btn light" data-act="pay-card" data-id="${a.id}">Pay the card</button></div>
      <div class="btns"><button class="btn light" data-act="add-balance" data-id="${a.id}">Statement / what you owe</button><button class="btn light" data-act="bank-import" data-id="${a.id}">Import bank file</button></div>
      <div class="btns"><button class="btn light" data-act="edit-account" data-id="${a.id}">Edit</button></div></div>`;
  } else {
    h = `<div class="card hero"><div class="label">${esc(ACCT_TYPES[a.type] || 'Account')}${a.institution ? ' · ' + esc(a.institution) : ''}</div>
      <div class="big">${b ? money(b.balance * share, c) : '—'}</div>
      <div class="sub">${b ? 'as of ' + fmtDate(b.date) : 'no balance yet'}${share < 1 ? ' · your share (' + shareLbl(a) + ') of ' + money(b ? b.balance : 0, c) : ''}${a.interest_rate ? ' · ' + a.interest_rate + '% interest' : ''}</div>
      <div class="btns"><button class="btn" data-act="add-tx" data-acct-id="${a.id}">+ Transaction</button><button class="btn light" data-act="add-balance" data-id="${a.id}">Update balance</button></div>
      <div class="btns"><button class="btn light" data-act="bank-import" data-id="${a.id}">Import bank file</button><button class="btn light" data-act="edit-account" data-id="${a.id}">Edit</button></div></div>`;
  }
  const txs = q('SELECT * FROM transactions WHERE account_id=? OR to_account_id=? ORDER BY date DESC, id DESC LIMIT 60', [id, id]);
  if (txs.length) {
    const A = Object.fromEntries(q('SELECT * FROM accounts').map(x => [x.id, x]));
    h += `<h2 class="sect">Transactions <span class="sub">latest</span></h2><div class="card"><div class="txlist">` + txs.map(t => `<div class="txday small">${fmtDate(t.date)}</div>` + txRow(t, A)).join('') + `</div>
      <div class="btns"><button class="btn light" data-act="tx-of" data-id="${a.id}">All of them under Cash flow</button></div></div>`;
  }
  h += `<h2 class="sect">${cr ? 'Statements' : 'Balance checks'} <span class="sub">${cr ? 'what you owed' : 'the real balance from your bank'}</span></h2><div class="card">`;
  if (!bs.length) h += `<p class="sub">None yet.</p>`;
  else h += `<div class="txns" style="margin-top:0">` + bs.map((r, i) => { const prev = bs[i + 1], ch = prev ? r.balance - prev.balance : null;
    return `<div class="txn" data-bal="${r.id}"><div class="txn-top"><span class="txn-date">${fmtDate(r.date)}</span><span class="txn-desc">${esc(r.note || '')}</span></div>
      <div class="txn-body"><div class="sub ${cr ? signCls(ch == null ? null : -ch) : signCls(ch)}">${ch == null ? '' : (ch >= 0 ? '+' : '') + money(ch, c)}</div><div class="r"><div class="strongv">${money(cr ? Math.abs(r.balance) : r.balance, c)}</div></div></div></div>`; }).join('') + `</div>`;
  h += `<p class="sub" style="margin:8px 0 0">The balance is the last ${cr ? 'statement' : 'balance check'} plus the transactions after it.</p></div>`;
  view().innerHTML = h;
}
function accountForm(id, copyOf) {
  const a = id ? q('SELECT * FROM accounts WHERE id=?', [id])[0] : copyOf || { type: 'savings', currency: home() };
  openSheet(`<h2>${id ? 'Edit' : copyOf ? 'Copy of' : 'Add'} account</h2>
    ${field('name', 'Name', a.name, 'autocomplete="off" placeholder="e.g. Everyday chequing"')}
    <div class="f2"><label class="f"><span>Type</span><select name="type">${Object.entries(ACCT_TYPES).map(([k, l]) => `<option value="${k}"${k === a.type ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>Currency</span><select name="currency">${curOptions(a.currency || home())}</select></label></div>
    ${field('institution', 'Bank (optional)', a.institution, 'autocomplete="off"')}
    ${id ? '' : `<span id="bal-wrap">${field('balance', 'Balance today', null)}</span>`}
    <div class="f2">${field('interest_rate', 'Interest % a year (optional)', a.interest_rate)}
<span id="limit-wrap">${field('credit_limit', 'Credit limit', a.credit_limit)}</span></div>
    ${shareFields(a)}
    <label class="f"><span>Notes</span><textarea name="notes">${esc(a.notes)}</textarea></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn light" data-f="dup">Duplicate</button><button class="btn danger" data-f="delete">Delete account</button></div>' : ''}`, box => {
    const ts = box.querySelector('[name=type]'), sync = () => { const cr = ts.value === 'credit';
      box.querySelector('#limit-wrap').style.display = cr ? '' : 'none';
      const bl = box.querySelector('#bal-wrap span'); if (bl) bl.textContent = cr ? 'What you owe today' : 'Balance today';
      const ir = box.querySelector('[name=interest_rate]').closest('label').querySelector('span'); ir.textContent = cr ? 'Interest % a year (optional)' : 'Interest % a year (optional)'; };
    ts.onchange = sync; sync();
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'dup') { const cp = Object.assign({}, a); delete cp.id; cp.name = a.name + ' (copy)'; return accountForm(null, cp); }
      if (f === 'delete') { ask('Delete this account, its balance history and its transactions?').then(y => { if (!y) return;
        run('DELETE FROM account_balances WHERE account_id=?', [id]);
        run('DELETE FROM transactions WHERE account_id=? OR to_account_id=?', [id, id]); run('DELETE FROM recurring WHERE account_id=? OR to_account_id=?', [id, id]); run('DELETE FROM accounts WHERE id=?', [id]); state.accountId = null; save(); closeSheet(); render(); }); return; }
      const d = formData(box), rate = num(d.interest_rate), bal = id ? null : num(d.balance);
      if (!d.name.trim()) return bad('Give the account a name.');
      if (Number.isNaN(rate) || Number.isNaN(bal)) return bad('Check the amounts.');
      const sh = readShare(d); if (!sh) return bad('Your share is a percentage from 1 to 100.');
      const lim = d.type === 'credit' ? num(d.credit_limit) : null; if (Number.isNaN(lim)) return bad('Check the credit limit.');
      const vals = [d.name.trim(), d.type, d.institution.trim(), d.currency, rate, sh[1], d.notes.trim(), sh[0], sh[2], lim];
      if (id) run('UPDATE accounts SET name=?,type=?,institution=?,currency=?,interest_rate=?,owners=?,notes=?,share_pct=?,co_owners=?,credit_limit=? WHERE id=?', vals.concat([id]));
      else { run('INSERT INTO accounts(name,type,institution,currency,interest_rate,owners,notes,share_pct,co_owners,credit_limit) VALUES(?,?,?,?,?,?,?,?,?,?)', vals);
        const nid = q('SELECT last_insert_rowid() id')[0].id;
        if (bal != null) run('INSERT INTO account_balances(account_id,date,balance,note,created) VALUES(?,?,?,?,?)', [nid, today(), bal, 'Opening balance', Date.now()]);
        state.tab = 'accounts'; state.accountId = nid; }
      save(); closeSheet(); render(); };
  });
}
function balanceForm(accountId, balId) {
  const a = q('SELECT * FROM accounts WHERE id=?', [accountId])[0]; if (!a) return;
  const r = balId ? q('SELECT * FROM account_balances WHERE id=?', [balId])[0] : { date: today() };
  openSheet(`<h2>${esc(a.name)}: ${balId ? 'edit' : 'new'} balance</h2>
    <div class="f2">${field('date', 'Date', r.date, 'type="date"')}${field('balance', (a.type === 'credit' ? 'What you owe (' : 'Balance (') + (a.currency || home()) + ', whole account)', a.type === 'credit' && r.balance != null ? Math.abs(r.balance) : r.balance)}</div>
    ${field('note', 'Note (optional)', r.note, 'autocomplete="off" placeholder="e.g. interest paid, transfer"')}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${balId ? '<div class="btns"><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'delete') { ask('Delete this balance?').then(y => { if (!y) return; run('DELETE FROM account_balances WHERE id=?', [balId]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), v = num(d.balance);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return bad('Enter the date.');
      if (v == null || Number.isNaN(v)) return bad('Enter the balance.');
      if (a.type === 'credit' && v < 0) return bad('Enter what you owe as a positive amount.');
      if (balId) run('UPDATE account_balances SET date=?,balance=?,note=? WHERE id=?', [d.date, v, d.note.trim(), balId]);
      else run('INSERT INTO account_balances(account_id,date,balance,note,created) VALUES(?,?,?,?,?)', [accountId, d.date, v, d.note.trim(), Date.now()]);
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
  setTitle('Prices');
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
    <div class="switch"><span>Update by itself</span><input type="checkbox" id="set-upd"${getSetting('auto_update', '1') === '1' ? ' checked' : ''}></div>
    <p class="sub">This is version ${APP_VERSION}. Last checked ${when(getSetting('update_checked'))}.${updateInfo ? ' Version ' + esc(updateInfo.version) + ' is ready.' : ''} It looks for a new version at every start and every few hours. Android: the first update asks you to press Update once; after that (Android 12 and newer) updates install quietly when you leave the app. Linux: the update installs by itself and a bar offers to restart.</p>
    <div class="btns"><button class="btn light" data-act="check-update">Check for updates now</button>${updateInfo ? '<button class="btn" data-act="install-update">Update</button>' : ''}</div></div>`;
  h += `<h2 class="sect">Security</h2><div id="sec"></div>`;
  h += `<h2 class="sect">Your data</h2><div class="card">
    <p class="sub">Everything is kept in one SQLite database file on this device. Export it to back it up or to move it to another phone or computer; import it there.</p>
    <div class="btns"><button class="btn" data-act="export">Export database</button><button class="btn light" data-act="import">Import database</button></div>
    <h3 class="ieh">From your bank</h3><p class="sub">In your online banking, download your account's history (OFX, QFX, QIF or CSV), then import it here. Your bank password is never needed and the file is read only on this device. Transactions already here are skipped.</p>
    <div class="btns"><button class="btn" data-act="bank-import">Import bank file</button></div>
    <h3 class="ieh">Printable report</h3><p class="sub">A clean summary on paper: net worth, every holding, income & expenses, bills coming. Print it, or choose "Save as PDF" (Android) / "Print to File" (Linux) to keep a PDF.</p>
    <div class="btns"><button class="btn" data-act="print-report">Print or save as PDF</button></div>
    <h3 class="ieh">For a spreadsheet (CSV)</h3><p class="sub">Opens in LibreOffice Calc, Excel or Google Sheets. Amounts in each item's own currency, with your share.</p>
    <div class="btns"><button class="btn light" data-act="csv" data-which="tx">Transactions</button><button class="btn light" data-act="csv" data-which="assets">Assets</button><button class="btn light" data-act="csv" data-which="propcf">Property cashflow</button></div></div>`;
  h += `<h2 class="sect">About</h2><div class="card"><p class="sub">KJT Invest ${APP_VERSION}, by Knowing Jesus Today (knowingjesus.today). Open source (GPL-2.0-or-later), no accounts, no analytics, no tracking.
    The app only goes online to update prices and to look for app updates. Metals: gold-api.com, Yahoo Finance, Currency API. Exchange rates: European Central Bank, Bank of Canada, ExchangeRate-API (exchangerate-api.com), Currency API. Past prices: DataHub, Yahoo Finance, Frankfurter. Nothing about you or your holdings is sent.</p></div>`;
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
  const sh = document.getElementById('sheet'), bx = sh.querySelector('.sheet-box'); bx.oninput = bx.onclick = bx.onchange = null; bx.innerHTML = html; sh.hidden = false;
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
      if (a === 'delete') { ask('Delete this holding?').then(y => { if (!y) return; run('DELETE FROM metal_holdings WHERE id=?', [id]); run('UPDATE transactions SET link=NULL WHERE link=?', ['metal:' + id]); run('UPDATE recurring SET link=NULL WHERE link=?', ['metal:' + id]); save(); closeSheet(); render(); }); return; }
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
    ${shareFields(p)}
    <label class="f"><span>Notes</span><textarea name="notes">${esc(p.notes)}</textarea></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn danger" data-f="delete">Delete property</button></div>' : ''}`, box => {
    box.onclick = e => { const a = e.target.dataset.f; if (!a) return;
      if (a === 'cancel') return closeSheet();
      if (a === 'delete') { ask('Delete this property and all its years?').then(y => { if (!y) return;
        for (const tb of ['property_years', 'rent_periods', 'property_items', 'property_values']) run(`DELETE FROM ${tb} WHERE property_id=?`, [id]);
        run('DELETE FROM properties WHERE id=?', [id]); run("UPDATE transactions SET link=NULL WHERE link=?", ['property:' + id]); run("UPDATE recurring SET link=NULL WHERE link=?", ['property:' + id]);
        state.propertyId = null; save(); closeSheet(); render(); }); return; }
      const d = formData(box), pp = num(d.purchase_price), pc = num(d.purchase_costs), cv = id ? null : num(d.current_value);
      if (!d.name.trim()) return bad('Give the property a name.');
      if (!(pp > 0)) return bad('Enter the purchase price.');
      if (Number.isNaN(pc) || Number.isNaN(cv)) return bad('Check the amounts.');
      const ty = (box.querySelector('[name=type]:checked') || {}).value || 'house';
      const sh = readShare(d); if (!sh) return bad('Your share is a percentage from 1 to 100.');
      const vals = [d.name.trim(), d.address.trim(), d.currency, d.purchase_date, pp, pc || 0, d.notes.trim(), sh[1], ty, sh[0], sh[2]];
      if (id) run('UPDATE properties SET name=?,address=?,currency=?,purchase_date=?,purchase_price=?,purchase_costs=?,notes=?,owners=?,type=?,share_pct=?,co_owners=? WHERE id=?', vals.concat([id]));
      else { run('INSERT INTO properties(name,address,currency,purchase_date,purchase_price,purchase_costs,notes,owners,type,share_pct,co_owners) VALUES(?,?,?,?,?,?,?,?,?,?,?)', vals);
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
    run('INSERT INTO properties(name,address,currency,purchase_date,purchase_price,purchase_costs,current_value,notes,owners,type,share_pct,co_owners) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      [p.name + ' (copy)', p.address, p.currency, p.purchase_date, p.purchase_price, p.purchase_costs, p.current_value, p.notes, p.owners || 1, p.type || 'house', p.share_pct, p.co_owners]);
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
  if (state.tab === t || b.dataset.tab === 'assetsgroup') { state.propertyId = null; state.accountId = null; state.assetId = null; state.loanId = null; }
  state.tab = t; render(); view().scrollTop = 0; };
document.getElementById('refresh').onclick = () => updatePrices(false);
document.getElementById('fab').onclick = () => txForm(null, null, state.txAcct ? { account_id: +state.txAcct } : null);
document.getElementById('settings').onclick = () => { state.tab = 'more'; render(); view().scrollTop = 0; };
document.getElementById('back').onclick = () => goBack();
function goBack() {
  const dl = document.getElementById('dlg'); if (!dl.hidden) { dl.querySelector('[data-n]').click(); return true; }
  if (!document.getElementById('sheet').hidden) { closeSheet(); return true; }
  if (state.tab === 'property' && state.propertyId) { state.propertyId = null; render(); return true; }
  if (state.tab === 'accounts' && state.accountId) { state.accountId = null; render(); return true; }
  if (state.tab === 'assets' && state.assetId) { state.assetId = null; render(); return true; }
  if (state.tab === 'loans' && state.loanId) { state.loanId = null; render(); return true; }
  if (state.tab !== 'overview') { state.tab = 'overview'; render(); return true; }
  return false;
}
window.__onBack = () => goBack();
window.addEventListener('resize', () => { for (const [id, k] of [['heroS', 'hpage'], ['cfS', 'cfPage']]) { const el = document.getElementById(id); if (el) fitSwipe(el, state[k] || 0); } });
view().addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-go],[data-metal],[data-prop],[data-item],[data-pval],[data-cfy],[data-cfp],[data-rent],[data-price],[data-fx],[data-chart],[data-range],[data-acct],[data-bal],[data-asset],[data-aval],[data-hpage],[data-prange],[data-unfav],[data-ie],[data-asec],[data-msec],[data-txm],[data-tx],[data-rec],[data-cat],[data-addsub],[data-addcat],[data-rp],[data-remdo],[data-remskip],[data-loan],[data-lpay]'); if (!el) return;
  const d = el.dataset;
  if (d.chart) { state.chart = d.chart; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.range) { state.range = d.range; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.go) { e.preventDefault(); state.tab = d.go; state.propertyId = null; state.accountId = null; state.assetId = null; state.loanId = d.loanid ? +d.loanid : null; render(); view().scrollTop = 0; }
  else if (d.metal) metalForm(+d.metal);
  else if (d.prop) { state.propertyId = +d.prop; render(); view().scrollTop = 0; }
  else if (d.item) itemForm(state.propertyId, +d.item);
  else if (d.pval) propertyValueForm(state.propertyId, +d.pval);
  else if (d.cfy) { state.cfYear = +d.cfy; if (el.classList.contains('yrow')) state.cfPage = 0; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.cfp) { state.cfPage = +d.cfp; const sc = document.getElementById('cfS'); if (sc) sc.scrollTo({ left: +d.cfp * sc.clientWidth, behavior: 'smooth' }); document.querySelectorAll('.cftabs .seg').forEach((b, j) => b.classList.toggle('on', j === +d.cfp)); }
  else if (d.rent) rentForm(state.propertyId, +d.rent);
  else if (d.asec) { state.tab = d.asec; state.propertyId = null; state.accountId = null; state.assetId = null; state.loanId = null; render(); view().scrollTop = 0; }
  else if (d.msec) { state.msec = d.msec; render(); view().scrollTop = 0; }
  else if (d.txm) { state.txMonth = d.txm; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.tx) txForm(+d.tx);
  else if (d.loan) { state.loanId = +d.loan; render(); view().scrollTop = 0; }
  else if (d.lpay) loanPayForm(state.loanId, +d.lpay);
  else if (d.rec) recForm(+d.rec);
  else if (d.cat) catForm(+d.cat);
  else if (d.addsub) catForm(null, +d.addsub);
  else if (d.addcat) catForm(null, null, d.addcat);
  else if (d.rp) { state.rp = d.rp; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.remdo) { const r = q('SELECT * FROM recurring WHERE id=?', [+d.remdo])[0]; if (r) { addFromRecurring(r, r.next_date); advance(r); save(); toast('Added'); render(); } }
  else if (d.remskip) { const r = q('SELECT * FROM recurring WHERE id=?', [+d.remskip])[0]; if (r) { advance(r); save(); toast('Skipped this time'); render(); } }
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
    case 'add-tx': txForm(null, null, Object.assign(d.acctId ? { account_id: +d.acctId } : {}, d.link ? { link: d.link } : {})); break;
    case 'pay-card': { const bank = q("SELECT id FROM accounts WHERE type<>'credit' ORDER BY type='chequing' DESC, name LIMIT 1")[0];
      if (!bank) { toast('First add the bank account you pay the card from.'); break; }
      const ow = acctBalance(+d.id); txForm(null, null, { kind: 'transfer', account_id: bank.id, to_account_id: +d.id, amount: ow && ow.balance < 0 ? +(-ow.balance).toFixed(2) : null, note: 'Card payment' }); break; }
    case 'tx-of': state.tab = 'money'; state.msec = 'tx'; state.txAcct = d.id; state.accountId = null; render(); view().scrollTop = 0; break;
    case 'csv': exportCsv(d.which); break;
    case 'add-loan': loanForm(); break;
    case 'edit-loan': loanForm(+d.id); break;
    case 'add-loanpay': loanPayForm(+d.id); break;
    case 'bank-import': bankImport(d.id ? +d.id : null); break;
    case 'print-report': printReport(); break;
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
  const slot = key => (m[key] = m[key] || { rent: 0, other: 0, interest: 0, hin: 0, costs: 0, byKind: {} });
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
  /* your own transactions: not transfers, not those linked to a property (already counted above), not savings */
  const A = Object.fromEntries(q('SELECT * FROM accounts').map(x => [x.id, x])), C = cats();
  for (const t of q("SELECT * FROM transactions WHERE kind<>'transfer'")) {
    if (t.link && t.link.startsWith('property:') || t.date > now) continue;
    const top = C.top(t.category_id); if (top && top.kind === 'save') continue;
    const a = A[t.account_id] || {}, v = convOn(t.amount * shareOf(a), a.currency || H, H, t.date) || 0, x = slot(t.date.slice(0, 7));
    if (t.kind === 'in') x.hin += v; else { x.costs += v; const kk = 'cat:' + (top ? top.name : 'No category'); x.byKind[kk] = (x.byKind[kk] || 0) + v; }
  }
  /* interest from loans you made, received outside your accounts (in your accounts it is already a transaction) */
  for (const p of q('SELECT p.*, l.currency FROM loan_payments p JOIN loans l ON l.id=p.loan_id WHERE p.interest>0 AND p.account_id IS NULL'))
    if (p.date <= now) slot(p.date.slice(0, 7)).hin += convOn(p.interest, p.currency || H, H, p.date) || 0;
  for (const a of q("SELECT * FROM accounts WHERE interest_rate > 0 AND type<>'credit'")) {
    const bs = q('SELECT date, balance FROM account_balances WHERE account_id=? ORDER BY date, id', [a.id]).map(r => [r.date, r.balance]);
    if (!bs.length) continue;
    const k = shareOf(a), c = a.currency || H;
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
  const t = { rent: 0, other: 0, interest: 0, hin: 0, costs: 0, byKind: {}, months: [] };
  for (const key of keys) { const x = model[key] || { rent: 0, other: 0, interest: 0, hin: 0, costs: 0, byKind: {} };
    t.rent += x.rent; t.other += x.other; t.interest += x.interest; t.hin += x.hin || 0; t.costs += x.costs;
    for (const [kk, v] of Object.entries(x.byKind)) t.byKind[kk] = (t.byKind[kk] || 0) + v;
    t.months.push({ key, inc: x.rent + x.other + x.interest + (x.hin || 0), out: x.costs, current: key === ym }); }
  t.income = t.rent + t.other + t.interest + t.hin; t.net = t.income - t.costs;
  return t;
}
function ieCard() {
  const H = home(), model = ieModel();
  if (!Object.keys(model).length) return `<div class="card"><p class="sub">Add transactions under Cash flow, rent periods and costs to your properties, and interest rates to your savings accounts, to see your income and expenses here.</p></div>`;
  state.ieRange = state.ieRange || 'L12';
  const t = ieRange(model, state.ieRange), yNow = new Date().getFullYear();
  const segs = [['L12', 'Last 12 months'], ['Y', String(yNow) + ' so far'], ['PY', String(yNow - 1)]].map(([kk, l]) => `<button class="seg${state.ieRange === kk ? ' on' : ''}" data-ie="${kk}">${l}</button>`).join('');
  const max = Math.max(1, ...t.months.map(x => Math.max(x.inc, x.out)));
  const bars = `<div class="iebars">${t.months.map(x => `<div class="ieb${x.current ? ' cur' : ''}"><div class="iebp"><i class="in" style="height:${(x.inc / max * 100).toFixed(1)}%"></i><i class="out" style="height:${(x.out / max * 100).toFixed(1)}%"></i></div><span>${MONTHS[+x.key.slice(5, 7) - 1][0]}</span></div>`).join('')}</div>
    <div class="legend"><span><i class="lin"></i>Income</span><span><i class="lout"></i>Expenses</span></div>`;
  const rows = (list, total) => list.filter(([, v]) => v > 0.5).map(([l, v]) => `<div class="arow ie"><span class="al">${l}</span><span class="av">${whole(v, H)}</span><span class="ap">${total ? Math.round(v / total * 100) + '%' : ''}</span></div>`).join('') || '<p class="sub">None in this period.</p>';
  const inc = [['Your income (transactions)', t.hin], ['Rent', t.rent], ['Other property income', t.other], ['Interest (estimated)', t.interest]];
  const exp = Object.entries(t.byKind).sort((a, b) => b[1] - a[1]).map(([kk, v]) => [esc(kk.startsWith('cat:') ? kk.slice(4) : (PITEMS[kk] || PITEMS.other_cost)[0] + ' (property)'), v]);
  const n = t.months.length || 1;
  return `<div class="card"><div class="segs">${segs}</div>
    <div class="ie3"><div class="stat"><div class="k">Income</div><div class="v up">${whole(t.income, H)}</div></div>
      <div class="stat"><div class="k">Expenses</div><div class="v down">${whole(t.costs, H)}</div></div>
      <div class="stat"><div class="k">Net</div><div class="v ${signCls(t.net)}">${whole(t.net, H)}</div></div></div>
    <p class="sub" style="margin:8px 0">${whole(t.income / n, H)} in and ${whole(t.costs / n, H)} out a month on average${t.income ? ` · you keep <b class="${signCls(t.net)}">${Math.round(t.net / t.income * 100)}%</b> of your income` : ''}.</p>
    ${bars}
    <h3 class="ieh">Income</h3><div class="alloc">${rows(inc, t.income)}</div>
    <h3 class="ieh">Expenses</h3><div class="alloc">${rows(exp, t.costs)}</div>
    <p class="sub" style="margin:10px 0 0">From your transactions (savings and transfers left out), your properties (your share) and the interest your accounts earn, estimated from their rate and balance. Details under Cash flow › Reports.</p></div>`;
}

/* ---------------- Money: transactions, recurring, reminders, categories, reports ----------------
   Kept simple on purpose: a category can have subcategories, and no deeper.
   An account's balance = its last balance check (the real balance from the bank) + the transactions after it.
   Credit cards are accounts too: purchases raise what you owe, a payment is a transfer from a bank account.
   A transaction can be linked to something you own (a property, a metal holding, another asset): it then
   shows on that item's page. Transactions linked to a property are not counted again in Income & expenses,
   because the property's rent and costs already are. "Savings & investments" are not spending. */
const DEFAULT_CATS = [
  ['out', 'Home', ['Maintenance', 'Furniture']], ['out', 'Food', ['Groceries', 'Restaurants']],
  ['out', 'Transport', ['Fuel', 'Car costs', 'Transit']], ['out', 'Bills', ['Phone & internet', 'Utilities', 'Insurance']],
  ['out', 'Health', []], ['out', 'Church & giving', []], ['out', 'Personal', []], ['out', 'Gifts', []],
  ['out', 'Travel', []], ['out', 'Taxes', []], ['out', 'Other', []],
  ['in', 'Salary', []], ['in', 'Rent received', []], ['in', 'Interest', []], ['in', 'Gifts received', []], ['in', 'Other income', []],
  ['save', 'Savings & investments', ['Precious metals', 'Property', 'Big purchases']],
  ['save', 'Transfers & card payments', []], ['save', 'Loans', ['Lent', 'Repaid']],
];
const KIND_NAME = { out: 'Expense', in: 'Income', transfer: 'Transfer' };
const FREQS = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year' };
function seedCategories() {
  if (q('SELECT COUNT(*) n FROM categories')[0].n) return;
  let i = 0;
  for (const [kind, name, subs] of DEFAULT_CATS) {
    run('INSERT INTO categories(name,parent_id,kind,sort) VALUES(?,?,?,?)', [name, null, kind, i++]);
    const pid = q('SELECT last_insert_rowid() id')[0].id;
    for (const sname of subs) run('INSERT INTO categories(name,parent_id,kind,sort) VALUES(?,?,?,?)', [sname, pid, kind, i++]);
  }
}
let TXCATS = null;
function cats() {
  if (TXCATS) return TXCATS;
  const rows = q('SELECT * FROM categories ORDER BY sort, name'), byId = {};
  for (const r of rows) byId[r.id] = r;
  TXCATS = { rows, byId, label: id => { const c = byId[id]; if (!c) return 'No category'; const p = c.parent_id && byId[c.parent_id]; return p ? p.name + ' › ' + c.name : c.name; },
    top: id => { const c = byId[id]; return c && c.parent_id ? byId[c.parent_id] || c : c; } };
  return TXCATS;
}
function clearCats() { TXCATS = null; }
function catOptions(kind, sel) {
  const C = cats(), tops = C.rows.filter(c => !c.parent_id && (kind === 'any' || c.kind === kind || (kind === 'out' && c.kind === 'save')));
  return `<option value="">No category</option>` + tops.map(t => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}</option>` +
    C.rows.filter(c => c.parent_id === t.id).map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>   ${esc(t.name)} › ${esc(c.name)}</option>`).join('')).join('');
}
/* ---- balances ---- */
function txEffect(t, accountId, cur) {   /* what one transaction does to one account's balance */
  if (t.kind === 'transfer') {
    if (t.account_id === accountId) return -t.amount;
    if (t.to_account_id === accountId) { const from = q('SELECT currency FROM accounts WHERE id=?', [t.account_id])[0]; return conv(t.amount, (from && from.currency) || home(), cur) || t.amount; }
    return 0;
  }
  if (t.account_id !== accountId) return 0;
  return t.kind === 'in' ? t.amount : -t.amount;
}
function acctBalance(id, onDate) {
  const d = onDate || today(), a = q('SELECT * FROM accounts WHERE id=?', [id])[0]; if (!a) return null;
  const snap = q('SELECT * FROM account_balances WHERE account_id=? AND date<=? ORDER BY date DESC, id DESC LIMIT 1', [id, d])[0];
  const from = snap ? snap.date : '0000-00-00', made = snap ? snap.created || 0 : 0;
  const txs = q('SELECT * FROM transactions WHERE (account_id=? OR to_account_id=?) AND date<=? AND (date>? OR (date=? AND COALESCE(created,0)>?))', [id, id, d, from, from, made]);
  if (!snap && !txs.length) return null;
  let bal = snap ? (a.type === 'credit' ? -Math.abs(snap.balance) : snap.balance) : 0;
  for (const t of txs) bal += txEffect(t, id, a.currency || home());
  const lastTx = txs.reduce((m, t) => t.date > m ? t.date : m, from);
  return { balance: bal, date: lastTx > from ? lastTx : from, checked: snap ? snap.date : null };
}
/* ---- recurring and reminders ---- */
function nextDate(d, freq) {
  const n = dnum(d);
  if (freq === 'weekly') return dstr(n + 7);
  if (freq === 'biweekly') return dstr(n + 14);
  const y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10);
  const ny = freq === 'yearly' ? y + 1 : (m === 12 ? y + 1 : y), nm = freq === 'yearly' ? m : (m === 12 ? 1 : m + 1);
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
function addFromRecurring(r, date) {
  run('INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,to_account_id,link,recurring_id,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [r.account_id, date, r.kind, r.amount, r.category_id, r.payee, r.note, r.to_account_id, r.link, r.id, Date.now()]);
}
function advance(r) {
  const nd = nextDate(r.next_date, r.freq);
  if (r.end_date && nd > r.end_date) run('UPDATE recurring SET next_date=?, active=0 WHERE id=?', [nd, r.id]);
  else run('UPDATE recurring SET next_date=? WHERE id=?', [nd, r.id]);
}
function processRecurring() {   /* automatic ones are added by themselves; the others wait as reminders */
  let added = 0;
  for (let guard = 0; guard < 400; guard++) {
    const r = q("SELECT * FROM recurring WHERE active=1 AND auto=1 AND next_date<=? ORDER BY next_date LIMIT 1", [today()])[0];
    if (!r) break; addFromRecurring(r, r.next_date); advance(r); added++;
  }
  if (added) { save(); toast(added + ' recurring transaction' + (added > 1 ? 's' : '') + ' added'); }
}
function reminders(days) {   /* due (or overdue) reminders, and what is coming in the next days */
  const until = dstr(dnum(today()) + (days || 14));
  return q('SELECT * FROM recurring WHERE active=1 AND next_date<=? ORDER BY next_date', [until]);
}
function remindersCard() {
  const rs = reminders(14), now = today(), until = dstr(dnum(now) + 14);
  const ls = q('SELECT * FROM loans WHERE closed=0 AND due_date IS NOT NULL AND due_date<=? ORDER BY due_date', [until]);
  if (!rs.length && !ls.length) return '';
  const loanRows = ls.map(l => { const s = loanStats(l); if (s.owed <= 0.005) return ''; const late = l.due_date < now;
    return `<div class="txn ${late ? 'cost' : 'inc'}" data-go="loans" data-loanid="${l.id}"><div class="txn-top"><span class="txn-date${late ? ' warn-t' : ''}">${late ? 'overdue · ' : ''}${fmtDate(l.due_date)}</span><span class="txn-desc">${esc(l.person)} repays you</span></div>
      <div class="txn-body"><div class="sub">loan of ${money(l.amount, l.currency || home(), { dec: 0 })}</div><div class="r"><div class="strongv">${money(s.owed, l.currency || home())}</div></div></div></div>`; }).join('');
  return `<h2 class="sect">Coming up <span class="sub">next 14 days</span></h2><div class="card"><div class="txns" style="margin-top:0">` + loanRows + rs.map(r => {
    const a = q('SELECT * FROM accounts WHERE id=?', [r.account_id])[0], c = (a && a.currency) || home(), due = r.next_date <= now;
    return `<div class="txn ${r.kind === 'in' ? 'inc' : 'cost'}"><div class="txn-top"><span class="txn-date${due ? ' warn-t' : ''}">${due ? (r.next_date < now ? 'overdue · ' : 'today · ') : ''}${fmtDate(r.next_date)}</span><span class="txn-desc">${esc(r.payee || cats().label(r.category_id))}</span></div>
      <div class="txn-body"><div class="sub">${esc(FREQS[r.freq] || '')} · ${esc(a ? a.name : '')}${r.auto ? ' · added by itself' : ''}</div><div class="r"><div class="strongv">${r.kind === 'in' ? '+' : '−'}${money(r.amount, c)}</div></div></div>
      ${!r.auto && due ? `<div class="btns" style="margin-top:6px"><button class="btn" data-remdo="${r.id}">Add it</button><button class="btn light" data-remskip="${r.id}">Skip this time</button></div>` : ''}</div>`; }).join('') + `</div></div>`;
}
/* ---- money tab ---- */
const MSECS = [['tx', 'Transactions'], ['reports', 'Reports'], ['recurring', 'Recurring'], ['categories', 'Categories']];
function renderMoney() {
  setTitle('Cash flow');
  state.msec = state.msec || 'tx';
  let h = `<div class="subnav">${MSECS.map(([k, l]) => subBtn(k, l, k === state.msec, 'data-msec')).join('')}</div>`;
  if (!q('SELECT COUNT(*) n FROM accounts')[0].n) {
    view().innerHTML = h + `<div class="card empty">First add a bank account, a credit card or cash under Assets › Accounts; then your transactions go here.<div class="btns"><button class="btn" data-act="add-account">Add an account</button></div></div>`; return;
  }
  if (state.msec === 'reports') h += reportsHtml();
  else if (state.msec === 'recurring') h += recurringHtml();
  else if (state.msec === 'categories') h += categoriesHtml();
  else h += remindersCard() + txListHtml();
  view().innerHTML = h;
  const s = document.getElementById('tx-search'); if (s) { s.oninput = () => { state.txSearch = s.value; clearTimeout(s._t); s._t = setTimeout(() => { const pos = s.selectionStart; render(); const n = document.getElementById('tx-search'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 350); }; }
  const fa = document.getElementById('tx-acct'); if (fa) fa.onchange = () => { state.txAcct = fa.value; render(); };
}
function txListHtml() {
  const ym = state.txMonth || today().slice(0, 7), y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`, next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const accts = q('SELECT * FROM accounts ORDER BY name'), A = Object.fromEntries(accts.map(a => [a.id, a]));
  let sql = 'SELECT * FROM transactions WHERE date>=? AND date<=?', p = [ym + '-01', ym + '-31'];
  if (state.txAcct) { sql += ' AND (account_id=? OR to_account_id=?)'; p.push(+state.txAcct, +state.txAcct); }
  const srch = (state.txSearch || '').trim().toLowerCase();
  let txs = q(sql + ' ORDER BY date DESC, id DESC', p);
  if (srch) txs = txs.filter(t => (t.payee || '').toLowerCase().includes(srch) || (t.note || '').toLowerCase().includes(srch) || cats().label(t.category_id).toLowerCase().includes(srch) || String(t.amount).includes(srch));
  const H = home(); let inn = 0, out = 0;
  for (const t of txs) { if (t.kind === 'transfer') continue; const v = conv(t.amount, (A[t.account_id] || {}).currency || H, H) || 0; if (t.kind === 'in') inn += v; else out += v; }
  let h = `<h2 class="sect">Transactions</h2><div class="card">
    <div class="ysel"><button data-txm="${prev}" aria-label="Previous month">‹</button><b>${new Date(ym + '-15T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'long' })}</b><button data-txm="${next}" aria-label="Next month">›</button></div>
    <div class="f2"><label class="f"><span>Account</span><select id="tx-acct"><option value="">All accounts</option>${accts.map(a => `<option value="${a.id}"${String(a.id) === String(state.txAcct || '') ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Search</span><input id="tx-search" value="${esc(state.txSearch || '')}" placeholder="payee, category, note…" autocomplete="off"></label></div>
    <div class="ie3"><div class="stat"><div class="k">In</div><div class="v up">${whole(inn, H)}</div></div><div class="stat"><div class="k">Out</div><div class="v down">${whole(out, H)}</div></div><div class="stat"><div class="k">Net</div><div class="v ${signCls(inn - out)}">${whole(inn - out, H)}</div></div></div>
    <div class="btns"><button class="btn" data-act="add-tx">+ Add transaction</button><button class="btn light" data-act="bank-import"${state.txAcct ? ` data-id="${state.txAcct}"` : ''}>Import bank file</button></div></div>`;
  if (!txs.length) return h + `<div class="card empty">No transactions in this month${srch ? ' match your search' : ''}.</div>`;
  let day = '';
  h += `<div class="card"><div class="txlist">`;
  for (const t of txs) {
    if (t.date !== day) { day = t.date; h += `<div class="txday">${new Date(day + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}</div>`; }
    h += txRow(t, A);
  }
  return h + `</div></div>`;
}
function txRow(t, A) {
  A = A || Object.fromEntries(q('SELECT * FROM accounts').map(a => [a.id, a]));
  const a = A[t.account_id] || {}, c = a.currency || home(), to = t.to_account_id ? A[t.to_account_id] : null;
  const title = t.kind === 'transfer' ? `Transfer to ${esc(to ? to.name : '?')}` : esc(t.payee || cats().label(t.category_id));
  const sub = t.kind === 'transfer' ? esc(a.name || '') + (t.note ? ' · ' + esc(t.note) : '') : `${esc(cats().label(t.category_id))} · ${esc(a.name || '')}${t.note ? ' · ' + esc(t.note) : ''}`;
  const sign = t.kind === 'in' ? '+' : t.kind === 'out' ? '−' : '';
  return `<div class="txrow" data-tx="${t.id}"><div class="txl"><div class="txt">${title}${t.recurring_id ? ' <span class="badge">↻</span>' : ''}${t.link ? ' <span class="badge">' + esc(linkLabel(t.link)) + '</span>' : ''}</div><div class="sub">${sub}</div></div>
    <div class="txa ${t.kind === 'in' ? 'up' : t.kind === 'out' ? 'down' : ''}">${sign}${money(t.amount, c)}</div></div>`;
}
function linkOptions(sel) {
  const o = [`<option value="">Not linked</option>`];
  const ps = q('SELECT id, name FROM properties ORDER BY name'), ms = q('SELECT id, description, metal FROM metal_holdings ORDER BY description'), os = q('SELECT id, name FROM other_assets ORDER BY name');
  if (ps.length) o.push(`<optgroup label="Property">${ps.map(p => `<option value="property:${p.id}"${sel === 'property:' + p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`);
  if (ms.length) o.push(`<optgroup label="Precious metals">${ms.map(m => `<option value="metal:${m.id}"${sel === 'metal:' + m.id ? ' selected' : ''}>${esc(m.description || METAL[m.metal].name)}</option>`).join('')}</optgroup>`);
  if (os.length) o.push(`<optgroup label="Other assets">${os.map(x => `<option value="asset:${x.id}"${sel === 'asset:' + x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`);
  return o.join('');
}
function linkLabel(link) {
  const [k, id] = String(link).split(':');
  const r = k === 'property' ? q('SELECT name n FROM properties WHERE id=?', [+id])[0] : k === 'metal' ? q('SELECT description n FROM metal_holdings WHERE id=?', [+id])[0] : q('SELECT name n FROM other_assets WHERE id=?', [+id])[0];
  return r ? r.n || 'linked' : 'linked';
}
function linkedTxHtml(link, title) {
  const txs = q(`SELECT * FROM transactions WHERE link ${link.endsWith('%') ? 'LIKE' : '='} ? ORDER BY date DESC, id DESC LIMIT 50`, [link]);
  if (!txs.length) return '';
  const A = Object.fromEntries(q('SELECT * FROM accounts').map(a => [a.id, a]));
  return `<h2 class="sect">${title || 'Transactions linked to this'}</h2><div class="card"><div class="txlist">${txs.map(t => `<div class="txday small">${fmtDate(t.date)}</div>` + txRow(t, A)).join('')}</div></div>`;
}
function txForm(id, copyOf, preset) {
  const accts = q('SELECT * FROM accounts ORDER BY name'); if (!accts.length) return toast('First add an account under Assets › Accounts.');
  const t = id ? q('SELECT * FROM transactions WHERE id=?', [id])[0] : Object.assign({ kind: 'out', date: today(), account_id: +(state.txAcct || accts[0].id) }, copyOf || {}, preset || {});
  if (copyOf) t.date = today();
  const payees = q("SELECT DISTINCT payee FROM transactions WHERE payee IS NOT NULL AND payee<>'' ORDER BY payee LIMIT 300").map(r => r.payee);
  const rec = t.recurring_id ? q('SELECT * FROM recurring WHERE id=?', [t.recurring_id])[0] : null;
  openSheet(`<h2>${id ? 'Edit' : copyOf ? 'Copy of' : 'New'} transaction</h2>
    <div class="freqs">${Object.entries(KIND_NAME).map(([k, l]) => `<label class="freqo"><input type="radio" name="kind" value="${k}"${k === t.kind ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <div class="f2">${field('amount', 'Amount', t.amount)}${field('date', 'Date', t.date, 'type="date"')}</div>
    <div class="f2"><label class="f"><span id="acct-l">Account</span><select name="account_id">${accts.map(a => `<option value="${a.id}"${a.id === t.account_id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <label class="f" id="to-wrap"><span>To account</span><select name="to_account_id">${accts.map(a => `<option value="${a.id}"${a.id === t.to_account_id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div>
    <div id="cat-wrap"><label class="f"><span>Category</span><select name="category_id"></select></label>
    ${field('payee', 'Paid to / received from (optional)', t.payee, 'autocomplete="off" list="payees"')}<datalist id="payees">${payees.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>
    ${field('note', 'Note (optional)', t.note, 'autocomplete="off"')}
    <label class="f"><span>Linked to something you own (optional)</span><select name="link">${linkOptions(t.link || '')}</select></label>
    ${id ? (rec ? `<p class="hint">Part of a repeating transaction (${esc(FREQS[rec.freq])}); change the repeat under Cash flow › Recurring.</p>` : '') : `<div class="f2"><label class="f"><span>Repeat</span><select name="freq"><option value="">Only once</option>${Object.entries(FREQS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="f" id="auto-wrap"><span>Next times</span><select name="auto"><option value="0">Remind me</option><option value="1">Add by itself</option></select></label></div>`}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn light" data-f="dup">Duplicate</button><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    const sync = () => { const k = (box.querySelector('[name=kind]:checked') || {}).value || 'out';
      box.querySelector('#to-wrap').style.display = k === 'transfer' ? '' : 'none';
      box.querySelector('#cat-wrap').style.display = k === 'transfer' ? 'none' : '';
      box.querySelector('#acct-l').textContent = k === 'transfer' ? 'From account' : 'Account';
      const cs = box.querySelector('[name=category_id]'), cur = +cs.value || t.category_id; cs.innerHTML = catOptions(k === 'in' ? 'in' : 'out', cur);
      const fr = box.querySelector('[name=freq]'); if (fr) box.querySelector('#auto-wrap').style.display = fr.value ? '' : 'none'; };
    box.querySelectorAll('[name=kind]').forEach(r => r.onchange = sync); const fr = box.querySelector('[name=freq]'); if (fr) fr.onchange = sync; sync();
    const pe = box.querySelector('[name=payee]');   /* a payee you used before brings back its category */
    if (pe && !id) pe.onchange = () => { const cs = box.querySelector('[name=category_id]'); if (cs.value) return;
      const last = q("SELECT category_id, kind FROM transactions WHERE payee=? AND category_id IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1", [pe.value.trim()])[0];
      if (!last) return; const kr = box.querySelector(`[name=kind][value="${last.kind}"]`); if (kr && !kr.checked) { kr.checked = true; sync(); } cs.value = String(last.category_id); };
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'dup') { const cp = Object.assign({}, t); delete cp.id; delete cp.recurring_id; return txForm(null, cp); }
      if (f === 'delete') { ask('Delete this transaction?').then(y => { if (!y) return; run('DELETE FROM transactions WHERE id=?', [id]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), amt = num(d.amount), kind = d.kind || 'out';
      if (!(amt > 0)) return bad('Enter the amount.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return bad('Enter the date.');
      if (kind === 'transfer' && d.to_account_id === d.account_id) return bad('Choose two different accounts.');
      const vals = [+d.account_id, d.date, kind, amt, kind === 'transfer' ? null : (+d.category_id || null), kind === 'transfer' ? null : (d.payee || '').trim(), (d.note || '').trim(), kind === 'transfer' ? +d.to_account_id : null, d.link || null];
      if (id) run('UPDATE transactions SET account_id=?,date=?,kind=?,amount=?,category_id=?,payee=?,note=?,to_account_id=?,link=? WHERE id=?', vals.concat([id]));
      else {
        let rid = null;
        if (d.freq) { run('INSERT INTO recurring(account_id,kind,amount,category_id,payee,note,to_account_id,link,freq,next_date,auto,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)',
          [vals[0], kind, amt, vals[4], vals[5], vals[6], vals[7], vals[8], d.freq, nextDate(d.date, d.freq), +d.auto || 0]); rid = q('SELECT last_insert_rowid() id')[0].id; }
        run('INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,to_account_id,link,recurring_id,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)', vals.concat([rid, Date.now()]));
        state.txMonth = d.date.slice(0, 7);
      }
      save(); closeSheet(); render();
      /* sorting one transaction can sort the others from the same payee */
      const cat = vals[4], py = vals[5];
      if (cat && py) { const others = q("SELECT id, payee FROM transactions WHERE category_id IS NULL AND kind<>'transfer' AND payee<>'' AND id<>?", [id || -1]).filter(o => firstWord(o.payee) === firstWord(py) && firstWord(py));
        if (others.length) ask(`Put the ${others.length} other transaction${others.length > 1 ? 's' : ''} from ${py} in ${cats().label(cat)} too?`, 'Yes, sort them').then(y => {
          if (!y) return; for (const o of others) run('UPDATE transactions SET category_id=? WHERE id=?', [cat, o.id]); save(); toast(others.length + ' more sorted'); render(); }); } };
  });
}
/* ---- recurring list ---- */
function recurringHtml() {
  const rs = q('SELECT * FROM recurring ORDER BY active DESC, next_date'), A = Object.fromEntries(q('SELECT * FROM accounts').map(a => [a.id, a])), H = home();
  let monthlyOut = 0, monthlyIn = 0;
  const perMonth = r => r.amount * ({ weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, yearly: 1 / 12 }[r.freq] || 1);
  for (const r of rs) if (r.active && r.kind !== 'transfer') { const v = conv(perMonth(r), (A[r.account_id] || {}).currency || H, H) || 0; if (r.kind === 'in') monthlyIn += v; else monthlyOut += v; }
  let h = `<h2 class="sect">Recurring <span class="sub">bills, salary, subscriptions…</span></h2>`;
  if (rs.length) h += `<div class="card"><div class="ie3"><div class="stat"><div class="k">In a month</div><div class="v up">${whole(monthlyIn, H)}</div></div><div class="stat"><div class="k">Out a month</div><div class="v down">${whole(monthlyOut, H)}</div></div><div class="stat"><div class="k">Net</div><div class="v ${signCls(monthlyIn - monthlyOut)}">${whole(monthlyIn - monthlyOut, H)}</div></div></div></div>`;
  h += `<div class="card">` + (rs.length ? `<div class="txns" style="margin-top:0">` + rs.map(r => { const a = A[r.account_id] || {};
    return `<div class="txn ${r.kind === 'in' ? 'inc' : 'cost'}${r.active ? '' : ' off'}" data-rec="${r.id}"><div class="txn-top"><span class="txn-date">${r.active ? 'next ' + fmtDate(r.next_date) : 'ended'}</span><span class="txn-desc">${esc(r.kind === 'transfer' ? 'Transfer' : (r.payee || cats().label(r.category_id)))}</span></div>
      <div class="txn-body"><div class="sub">${esc(FREQS[r.freq])} · ${esc(a.name || '')} · ${r.auto ? 'added by itself' : 'reminder'}</div><div class="r"><div class="strongv">${r.kind === 'in' ? '+' : r.kind === 'out' ? '−' : ''}${money(r.amount, a.currency || H)}</div></div></div></div>`; }).join('') + `</div>`
    : `<p class="sub">Nothing repeats yet. When you add a transaction, choose "Repeat" (every week, 2 weeks, month or year) and whether the app adds it by itself or reminds you.</p>`) +
    `<div class="btns"><button class="btn" data-act="add-tx">+ Add transaction</button></div></div>`;
  return h;
}
function recForm(id) {
  const r = q('SELECT * FROM recurring WHERE id=?', [id])[0]; if (!r) return;
  const a = q('SELECT * FROM accounts WHERE id=?', [r.account_id])[0] || {};
  openSheet(`<h2>Repeating: ${esc(r.payee || cats().label(r.category_id))}</h2>
    <div class="f2">${field('amount', 'Amount (' + (a.currency || home()) + ')', r.amount)}<label class="f"><span>Repeat</span><select name="freq">${Object.entries(FREQS).map(([k, l]) => `<option value="${k}"${k === r.freq ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="f2">${field('next_date', 'Next time', r.next_date, 'type="date"')}${field('end_date', 'Last time (optional)', r.end_date, 'type="date"')}</div>
    <label class="f"><span>Next times</span><select name="auto"><option value="0"${r.auto ? '' : ' selected'}>Remind me</option><option value="1"${r.auto ? ' selected' : ''}>Add by itself</option></select></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    <div class="btns">${r.active ? '<button class="btn light" data-f="stop">Stop repeating</button>' : '<button class="btn light" data-f="resume">Repeat again</button>'}<button class="btn danger" data-f="delete">Delete</button></div>
    <p class="hint">Stopping or deleting keeps the transactions already added.</p>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'stop' || f === 'resume') { run('UPDATE recurring SET active=? WHERE id=?', [f === 'resume' ? 1 : 0, id]); save(); closeSheet(); render(); return; }
      if (f === 'delete') { ask('Delete this repeat? The transactions already added stay.').then(y => { if (!y) return; run('UPDATE transactions SET recurring_id=NULL WHERE recurring_id=?', [id]); run('DELETE FROM recurring WHERE id=?', [id]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), amt = num(d.amount);
      if (!(amt > 0)) return bad('Enter the amount.');
      run('UPDATE recurring SET amount=?,freq=?,next_date=?,end_date=?,auto=? WHERE id=?', [amt, d.freq, d.next_date, d.end_date || null, +d.auto, id]);
      save(); closeSheet(); render(); };
  });
}
/* ---- categories ---- */
function categoriesHtml() {
  const C = cats();
  const block = (kind, title) => { const tops = C.rows.filter(c => !c.parent_id && c.kind === kind);
    return `<h2 class="sect">${title}</h2><div class="card"><div class="catlist">${tops.map(t => `<div class="cat"><button class="catn" data-cat="${t.id}">${esc(t.name)} <span class="sub">${q('SELECT COUNT(*) n FROM transactions WHERE category_id=?', [t.id])[0].n || ''}</span></button>
      ${C.rows.filter(c => c.parent_id === t.id).map(c => `<button class="catn sub2" data-cat="${c.id}">› ${esc(c.name)}</button>`).join('')}
      <button class="catadd" data-addsub="${t.id}">+ subcategory</button></div>`).join('')}</div>
      <div class="btns"><button class="btn light" data-addcat="${kind}">+ ${title.replace(/s$/, '')} category</button></div></div>`; };
  return block('out', 'Expenses') + block('in', 'Income') + block('save', 'Savings & investments') +
    `<p class="sub" style="padding:0 6px">Tap a name to rename it. Subcategories go one level deep only, to keep things simple. Savings & investments (like buying metals) are not counted as spending.</p>`;
}
function catForm(id, parentId, kind) {
  const c = id ? q('SELECT * FROM categories WHERE id=?', [id])[0] : { parent_id: parentId || null, kind: kind || (parentId ? q('SELECT kind FROM categories WHERE id=?', [parentId])[0].kind : 'out') };
  const parent = c.parent_id ? q('SELECT name FROM categories WHERE id=?', [c.parent_id])[0] : null;
  openSheet(`<h2>${id ? 'Rename' : 'New'} ${c.parent_id ? 'subcategory' : 'category'}${parent ? ' of ' + esc(parent.name) : ''}</h2>
    ${field('name', 'Name', c.name, 'autocomplete="off"')}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn danger" data-f="delete">Delete</button></div><p class="hint">Deleting moves its transactions to ' + (c.parent_id ? 'the main category' : '"No category"') + '.</p>' : ''}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'delete') { ask('Delete this category?').then(y => { if (!y) return;
        for (const tb of ['transactions', 'recurring']) run(`UPDATE ${tb} SET category_id=? WHERE category_id=?`, [c.parent_id || null, id]);
        for (const sub of q('SELECT id FROM categories WHERE parent_id=?', [id])) { for (const tb of ['transactions', 'recurring']) run(`UPDATE ${tb} SET category_id=NULL WHERE category_id=?`, [sub.id]); run('DELETE FROM categories WHERE id=?', [sub.id]); }
        run('DELETE FROM categories WHERE id=?', [id]); clearCats(); save(); closeSheet(); render(); }); return; }
      const name = (formData(box).name || '').trim(); if (!name) return bad('Enter a name.');
      if (id) run('UPDATE categories SET name=? WHERE id=?', [name, id]);
      else run('INSERT INTO categories(name,parent_id,kind,sort) VALUES(?,?,?,?)', [name, c.parent_id, c.kind, 999]);
      clearCats(); save(); closeSheet(); render(); };
  });
}
/* ---- reports: where the money goes, what changed, what is coming ---- */
const RPERIODS = [['m', 'This month'], ['pm', 'Last month'], ['3m', '3 months'], ['12m', '12 months'], ['y', 'This year']];
function periodRange(k) {
  const t = today(), y = +t.slice(0, 4), m = +t.slice(5, 7), ym = (yy, mm) => { while (mm < 1) { mm += 12; yy--; } return `${yy}-${String(mm).padStart(2, '0')}`; };
  const end = mm => dstr(dnum(ym(y, mm + 1).replace(/$/, '-01')) - 1);
  if (k === 'pm') return [ym(y, m - 1) + '-01', end(m - 1), 1];
  if (k === '3m') return [ym(y, m - 2) + '-01', t, 3];
  if (k === '12m') return [ym(y, m - 11) + '-01', t, 12];
  if (k === 'y') return [`${y}-01-01`, t, m];
  return [ym(y, m) + '-01', t, 1];
}
function spendBy(a, b) {   /* household spending by top category (in home currency), and income */
  const H = home(), A = Object.fromEntries(q('SELECT * FROM accounts').map(x => [x.id, x])), C = cats();
  const out = {}, inc = {}, payees = {}; let total = 0, totalIn = 0, count = 0, big = [];
  for (const t of q("SELECT * FROM transactions WHERE kind<>'transfer' AND date>=? AND date<=?", [a, b])) {
    if (t.link && t.link.startsWith('property:')) continue;
    const top = C.top(t.category_id), v = conv(t.amount, (A[t.account_id] || {}).currency || H, H) || 0;
    if (top && top.kind === 'save') continue;
    const name = top ? top.name : 'No category';
    if (t.kind === 'in') { inc[name] = (inc[name] || 0) + v; totalIn += v; }
    else { out[name] = (out[name] || 0) + v; total += v; count++; if (t.payee) payees[t.payee] = (payees[t.payee] || 0) + v; big.push([v, t]); }
  }
  return { out, inc, total, totalIn, count, payees, big: big.sort((x, y) => y[0] - x[0]) };
}
function reportsHtml() {
  const H = home(); state.rp = state.rp || 'm';
  const [a, b, months] = periodRange(state.rp), len = dnum(b) - dnum(a) + 1;
  const pa = dstr(dnum(a) - len), pb = dstr(dnum(a) - 1);
  const cur = spendBy(a, b), prev = spendBy(pa, pb);
  const segs = RPERIODS.map(([k, l]) => `<button class="seg${state.rp === k ? ' on' : ''}" data-rp="${k}">${l}</button>`).join('');
  /* smart notes */
  const notes = [];
  const sorted = Object.entries(cur.out).sort((x, y) => y[1] - x[1]);
  if (sorted.length) notes.push(`Most of your spending went to <b>${esc(sorted[0][0])}</b>: ${whole(sorted[0][1], H)} (${Math.round(sorted[0][1] / (cur.total || 1) * 100)}%).`);
  if (prev.total > 0 && cur.total > 0) { const ch = cur.total / prev.total - 1; notes.push(`You spent <b class="${ch > 0 ? 'down' : 'up'}">${Math.abs(Math.round(ch * 100))}% ${ch > 0 ? 'more' : 'less'}</b> than in the period before (${whole(prev.total, H)}).`); }
  let bigChange = null;
  for (const [k, v] of Object.entries(cur.out)) { const pv = prev.out[k] || 0, d = v - pv; if (Math.abs(d) > 20 && (!bigChange || Math.abs(d) > Math.abs(bigChange[1]))) bigChange = [k, d, pv]; }
  if (bigChange && prev.total > 0) notes.push(`Biggest change: <b>${esc(bigChange[0])}</b> ${bigChange[1] > 0 ? 'up' : 'down'} ${whole(Math.abs(bigChange[1]), H)}.`);
  if (cur.totalIn > 0) notes.push(`You kept <b class="${signCls(cur.totalIn - cur.total)}">${Math.round((cur.totalIn - cur.total) / cur.totalIn * 100)}%</b> of your income (household only).`);
  if (cur.count) notes.push(`On average ${whole(cur.total / len, H)} a day, ${whole(cur.total / months, H)} a month.`);
  const unsorted = q("SELECT COUNT(*) n FROM transactions WHERE category_id IS NULL AND kind<>'transfer' AND date>=? AND date<=?", [a, b])[0].n;
  if (unsorted) notes.push(`<b>${unsorted}</b> transaction${unsorted > 1 ? 's have' : ' has'} no category yet: tap one under Transactions to choose; the others from the same payee follow, and future imports remember it.`);
  if (cur.big.length) { const [v, t] = cur.big[0]; notes.push(`Largest expense: ${whole(v, H)}${t.payee ? ' to ' + esc(t.payee) : ''} on ${fmtDate(t.date)}.`); }
  const due = reminders(30).filter(r => r.kind === 'out');
  if (due.length) { let s = 0; for (const r of due) s += r.amount; notes.push(`Coming in the next 30 days: <b>${due.length}</b> bill${due.length > 1 ? 's' : ''}, about ${whole(s, H)}.`); }
  for (const l of q('SELECT * FROM loans WHERE closed=0 AND due_date<?', [today()])) { const s = loanStats(l); if (s.owed > 0.005) notes.push(`<span class="down">${esc(l.person)} is late repaying ${money(s.owed, l.currency || H)} (due ${fmtDate(l.due_date)}).</span>`); }
  for (const c of q("SELECT * FROM accounts WHERE type='credit' AND credit_limit>0")) { const bl = acctBalance(c.id); if (bl && -bl.balance / c.credit_limit > 0.7) notes.push(`<span class="down">${esc(c.name)} is at ${Math.round(-bl.balance / c.credit_limit * 100)}% of its limit.</span>`); }
  const max = sorted.length ? sorted[0][1] : 1;
  let h = `<h2 class="sect">Reports</h2><div class="card"><div class="segs">${segs}</div>
    <div class="ie3"><div class="stat"><div class="k">Income</div><div class="v up">${whole(cur.totalIn, H)}</div></div><div class="stat"><div class="k">Spending</div><div class="v down">${whole(cur.total, H)}</div></div><div class="stat"><div class="k">Left over</div><div class="v ${signCls(cur.totalIn - cur.total)}">${whole(cur.totalIn - cur.total, H)}</div></div></div>
    ${notes.length ? `<ul class="notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : '<p class="sub">Add transactions to see your reports.</p>'}</div>`;
  if (sorted.length) h += `<h2 class="sect">Where the money goes</h2><div class="card"><div class="catbars">${sorted.map(([k, v]) => { const pv = prev.out[k] || 0, ch = pv ? v / pv - 1 : null;
    return `<div class="cb"><div class="cbt"><span>${esc(k)}</span><span><b>${whole(v, H)}</b> <small class="sub">${Math.round(v / (cur.total || 1) * 100)}%${ch != null ? ` · <span class="${ch > 0 ? 'down' : 'up'}">${ch > 0 ? '+' : ''}${Math.round(ch * 100)}%</span>` : ''}</small></span></div><div class="cbb"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>`; }).join('')}</div>
    <p class="sub" style="margin:8px 0 0">The % after each one compares with the period before.</p></div>`;
  const inc = Object.entries(cur.inc).sort((x, y) => y[1] - x[1]);
  if (inc.length) h += `<h2 class="sect">Where the money comes from</h2><div class="card"><div class="alloc">${inc.map(([k, v]) => `<div class="arow ie"><span class="al">${esc(k)}</span><span class="av">${whole(v, H)}</span><span class="ap">${Math.round(v / (cur.totalIn || 1) * 100)}%</span></div>`).join('')}</div></div>`;
  const pay = Object.entries(cur.payees).sort((x, y) => y[1] - x[1]).slice(0, 6);
  if (pay.length) h += `<h2 class="sect">Paid to most</h2><div class="card"><div class="alloc">${pay.map(([k, v]) => `<div class="arow ie"><span class="al">${esc(k)}</span><span class="av">${whole(v, H)}</span><span class="ap"></span></div>`).join('')}</div></div>`;
  h += `<button class="btn wide light" data-act="print-report">Print the full report or save it as a PDF</button>`;
  h += `<p class="sub" style="padding:0 6px">Reports count your own transactions. Rent and costs of your properties are in Overview › Income & expenses, together with these.</p>`;
  return h;
}
/* ---- CSV for spreadsheets ---- */
function csvCell(v) { if (v == null) return ''; const s = String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
async function exportCsv(which) {
  const H = home(); let rows, name;
  if (which === 'tx') {
    const A = Object.fromEntries(q('SELECT * FROM accounts').map(a => [a.id, a]));
    rows = [['Date', 'Type', 'Amount', 'Currency', 'Account', 'To account', 'Category', 'Paid to / from', 'Note', 'Linked to']].concat(
      q('SELECT * FROM transactions ORDER BY date, id').map(t => [t.date, KIND_NAME[t.kind], t.amount, (A[t.account_id] || {}).currency || H, (A[t.account_id] || {}).name, t.to_account_id ? (A[t.to_account_id] || {}).name : '', t.kind === 'transfer' ? '' : cats().label(t.category_id), t.payee, t.note, t.link ? linkLabel(t.link) : '']));
    name = 'kjt-invest-transactions-' + today() + '.csv';
  } else if (which === 'assets') {
    rows = [['Kind', 'Name', 'Detail', 'Currency', 'Paid', 'Value now', 'Your share %', 'Your value in ' + H]];
    for (const h of q('SELECT * FROM metal_holdings')) { const s = holdingStats(h); rows.push(['Precious metal', h.description || METAL[h.metal].name, `${METAL[h.metal].name}, ${FORMS[h.form] || 'Coin'}, ${s.oz.toFixed(4)} oz pure, bought ${h.purchase_date || ''}`, h.currency, s.cost != null ? s.cost.toFixed(2) : '', s.value != null ? s.value.toFixed(2) : '', 100, s.valueHome != null ? s.valueHome.toFixed(2) : '']); }
    for (const p of q('SELECT * FROM properties')) { const s = propertyStats(p); rows.push(['Property', p.name, (PROP_TYPES[p.type] || PROP_TYPES.house)[0] + (p.address ? ', ' + p.address : ''), p.currency, s.invested.toFixed(2), s.value.toFixed(2), (s.share * 100).toFixed(2), (conv(s.value * s.share, p.currency, H) || 0).toFixed(2)]); }
    for (const a of q('SELECT * FROM accounts')) { const b = acctBalance(a.id), k = shareOf(a); rows.push([a.type === 'credit' ? 'Credit card' : 'Account', a.name, (ACCT_TYPES[a.type] || '') + (a.institution ? ', ' + a.institution : ''), a.currency, '', b ? b.balance.toFixed(2) : '', (k * 100).toFixed(2), b ? (conv(b.balance * k, a.currency, H) || 0).toFixed(2) : '']); }
    for (const o of q('SELECT * FROM other_assets')) { const v = assetValue(o.id), k = shareOf(o); rows.push(['Other asset', o.name, (ASSET_TYPES[o.type] || ASSET_TYPES.other)[0], o.currency, o.purchase_price, v ? v.value : '', (k * 100).toFixed(2), v ? (conv(v.value * k, o.currency, H) || 0).toFixed(2) : '']); }
    for (const l of q('SELECT * FROM loans')) { const s = loanStats(l); rows.push(['Loan you made', l.person, 'lent ' + l.date + (l.due_date ? ', due ' + l.due_date : '') + (l.closed ? ', repaid' : ''), l.currency, l.amount, s.owed.toFixed(2), 100, (conv(s.owed, l.currency || H, H) || 0).toFixed(2)]); }
    name = 'kjt-invest-assets-' + today() + '.csv';
  } else {
    rows = [['Property', 'Month', 'Rent', 'Other income', 'Costs', 'Net', 'Months empty', 'Your share %', 'Currency']];
    for (const p of q('SELECT * FROM properties')) { const s = propertyStats(p);
      for (const yr of s.rows) for (const f of yr.months) if (f.owned && !f.future) rows.push([p.name, `${f.y}-${String(f.m + 1).padStart(2, '0')}`, f.rent.toFixed(2), f.income.toFixed(2), f.costs.toFixed(2), f.net.toFixed(2), f.empty.toFixed(2), (s.share * 100).toFixed(2), p.currency]); }
    name = 'kjt-invest-property-cashflow-' + today() + '.csv';
  }
  const bytes = new TextEncoder().encode(toCsv(rows));
  const r = await native('exportDb', { b64: bytesToB64(bytes), name });
  if (r.ok) toast('Saved' + (r.where ? ' to ' + r.where : '')); else if (r.error) toast('Not saved: ' + r.error);
}

/* ---------------- printable report (print it, or save it as a PDF) ----------------
   A clean black-on-white summary of everything, made for paper. It is separate from the database export:
   it is for reading, filing or giving to an accountant, not for moving your data. */
function printReport() {
  const H = home(), t = totals(), now = today(), M = mcur();
  const m = v => v == null ? '—' : whole(v, H), td = (v, cls) => `<td class="n${cls ? ' ' + cls : ''}">${v}</td>`;
  const sgn = v => v == null ? '' : v >= 0 ? 'up' : 'down';
  let h = `<header class="ph"><div><h1>Financial report</h1><div class="pmeta">${new Date(now + 'T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })} · amounts in ${H}, your share</div></div>
    <div class="plogo">KJT Invest</div></header>`;
  /* net worth */
  const debt = t.debt || 0, cashOnly = t.cash + debt;
  h += `<h2>Net worth</h2><table><tbody>
    <tr><td>Precious metals</td>${td(m(t.metals))}</tr>
    <tr><td>Real estate (your estimate)</td>${td(m(t.re))}</tr>
    <tr><td>Bank accounts & cash</td>${td(m(cashOnly))}</tr>
    ${debt > 0.005 ? `<tr><td>Owed on credit cards</td>${td('−' + m(debt), 'down')}</tr>` : ''}
    <tr><td>Other assets</td>${td(m(t.other))}</tr>
    ${t.loans ? `<tr><td>Loans you made (still owed to you)</td>${td(m(t.loans))}</tr>` : ''}
    <tr class="tot"><td>Total</td>${td(m(t.total))}</tr></tbody></table>
    ${t.missing ? '<p class="pnote">Some items have no price or exchange rate yet and are left out.</p>' : ''}`;
  /* metals */
  const hs = q('SELECT * FROM metal_holdings ORDER BY metal, description');
  if (hs.length) {
    let tv = 0, tc = 0;
    h += `<h2>Precious metals <small>${M} per troy ounce: ${METALS.map(x => { const p = spotIn(x.sym, M); return p == null ? '' : x.name + ' ' + money(p, M); }).filter(Boolean).join(' · ')}</small></h2>
      <table><thead><tr><th>Holding</th><th>Bought</th><th class="n">Pure oz</th><th class="n">Paid</th><th class="n">Value</th><th class="n">Gain</th></tr></thead><tbody>` +
      hs.map(x => { const s = holdingStats(x); if (s.valueHome != null) tv += s.valueHome; if (s.costHome != null) tc += s.costHome;
        return `<tr><td>${esc(x.description || METAL[x.metal].name)}<div class="psub">${METAL[x.metal].name} · ${FORMS[x.form] || 'Coin'}${x.quantity > 1 ? ' · ' + x.quantity + ' pieces' : ''}</div></td><td>${x.purchase_date ? fmtDate(x.purchase_date) : ''}</td>
          ${td(s.oz.toFixed(3))}${td(m(s.costHome))}${td(m(s.valueHome))}${td(s.costHome ? pct((s.valueHome - s.costHome) / s.costHome) : '', sgn(s.valueHome - s.costHome))}</tr>`; }).join('') +
      `<tr class="tot"><td>Total</td><td></td><td></td>${td(m(tc))}${td(m(tv))}${td(tc ? pct((tv - tc) / tc) : '', sgn(tv - tc))}</tr></tbody></table>`;
  }
  /* property */
  const ps = q('SELECT * FROM properties ORDER BY name');
  if (ps.length) {
    h += `<h2>Real estate</h2><table><thead><tr><th>Property</th><th class="n">Share</th><th class="n">Invested</th><th class="n">Value</th><th class="n">Net cashflow, last 12 months</th></tr></thead><tbody>` +
      ps.map(p => { const s = propertyStats(p), k = s.share, c = p.currency || H, cv = v => conv(v * k, c, H);
        let l12 = 0; const fl = []; for (const yr of s.rows) for (const f of yr.months) if (!f.future && f.owned) fl.push(f); for (const f of fl.slice(-12)) l12 += f.net;
        return `<tr><td>${esc(p.name)}<div class="psub">${(PROP_TYPES[p.type] || PROP_TYPES.house)[0]}${p.address ? ' · ' + esc(p.address) : ''}${p.co_owners ? ' · with ' + esc(p.co_owners) : ''}</div></td>
          ${td(shareLbl(p))}${td(m(cv(s.invested)))}${td(m(cv(s.value)))}${td(m(cv(l12)), sgn(l12))}</tr>`; }).join('') + `</tbody></table>`;
  }
  /* accounts */
  const as = q('SELECT * FROM accounts ORDER BY type, name');
  if (as.length) {
    h += `<h2>Bank accounts, cash & credit cards</h2><table><thead><tr><th>Account</th><th>As of</th><th class="n">Share</th><th class="n">Balance</th></tr></thead><tbody>` +
      as.map(a => { const b = acctBalance(a.id), v = b ? conv(b.balance * shareOf(a), a.currency || H, H) : null, cr = a.type === 'credit';
        return `<tr><td>${esc(a.name)}<div class="psub">${ACCT_TYPES[a.type] || ''}${a.institution ? ' · ' + esc(a.institution) : ''}${cr && a.credit_limit ? ' · limit ' + money(a.credit_limit, a.currency || H, { dec: 0 }) : ''}${(a.currency || H) !== H && b ? ' · ' + money(b.balance, a.currency) : ''}</div></td>
          <td>${b ? fmtDate(b.date) : ''}</td>${td(shareLbl(a))}${td(m(v), v < 0 ? 'down' : '')}</tr>`; }).join('') + `</tbody></table>`;
  }
  /* other assets */
  const os = q('SELECT * FROM other_assets ORDER BY name');
  if (os.length) {
    h += `<h2>Other assets</h2><table><thead><tr><th>Asset</th><th class="n">Share</th><th class="n">Paid</th><th class="n">Value</th></tr></thead><tbody>` +
      os.map(o => { const v = assetValue(o.id), k = shareOf(o), c = o.currency || H;
        return `<tr><td>${esc(o.name)}<div class="psub">${(ASSET_TYPES[o.type] || ASSET_TYPES.other)[0]}${o.purchase_date ? ' · bought ' + fmtDate(o.purchase_date) : ''}</div></td>
          ${td(shareLbl(o))}${td(m(o.purchase_price != null ? conv(o.purchase_price * k, c, H) : null))}${td(m(v ? conv(v.value * k, c, H) : null))}</tr>`; }).join('') + `</tbody></table>`;
  }
  /* loans */
  const lns = q('SELECT * FROM loans ORDER BY closed, person');
  if (lns.length) {
    h += `<h2>Loans you made</h2><table><thead><tr><th>Lent to</th><th>Lent on</th><th>Due</th><th class="n">Lent</th><th class="n">Repaid</th><th class="n">Still owed</th></tr></thead><tbody>` +
      lns.map(l => { const s = loanStats(l), c = l.currency || H;
        return `<tr><td>${esc(l.person)}${l.rate ? `<div class="psub">${l.rate}% a year</div>` : ''}</td><td>${fmtDate(l.date)}</td><td class="${s.overdue ? 'down' : ''}">${l.closed ? 'repaid' : l.due_date ? fmtDate(l.due_date) : ''}</td>${td(money(l.amount, c, { dec: 0 }))}${td(money(s.repaid, c, { dec: 0 }))}${td(money(s.owed, c, { dec: 0 }))}</tr>`; }).join('') + `</tbody></table>`;
  }
  /* income & expenses, last 12 months */
  const model = ieModel();
  if (Object.keys(model).length) {
    const r = ieRange(model, 'L12');
    const inc = [['Your income (transactions)', r.hin], ['Rent', r.rent], ['Other property income', r.other], ['Interest (estimated)', r.interest]].filter(x => x[1] > 0.5);
    const exp = Object.entries(r.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k.startsWith('cat:') ? k.slice(4) : (PITEMS[k] || PITEMS.other_cost)[0] + ' (property)', v]);
    h += `<h2>Income & expenses <small>last 12 months</small></h2><div class="pcols"><table><thead><tr><th>Income</th><th class="n"></th><th class="n">%</th></tr></thead><tbody>` +
      inc.map(([l, v]) => `<tr><td>${esc(l)}</td>${td(m(v))}${td(Math.round(v / (r.income || 1) * 100) + '%')}</tr>`).join('') + `<tr class="tot"><td>Total</td>${td(m(r.income))}<td></td></tr></tbody></table>
      <table><thead><tr><th>Expenses</th><th class="n"></th><th class="n">%</th></tr></thead><tbody>` +
      exp.map(([l, v]) => `<tr><td>${esc(l)}</td>${td(m(v))}${td(Math.round(v / (r.costs || 1) * 100) + '%')}</tr>`).join('') + `<tr class="tot"><td>Total</td>${td(m(r.costs))}<td></td></tr></tbody></table></div>
      <table><tbody><tr class="tot"><td>Net (income less expenses)</td>${td(m(r.net), sgn(r.net))}</tr>
      <tr><td>A month on average</td>${td(m(r.income / (r.months.length || 1)) + ' in · ' + m(r.costs / (r.months.length || 1)) + ' out')}</tr>
      ${r.income ? `<tr><td>Share of income kept</td>${td(Math.round(r.net / r.income * 100) + '%', sgn(r.net))}</tr>` : ''}</tbody></table>`;
    /* month by month */
    h += `<table class="pmonths"><thead><tr><th>Month</th>${r.months.map(x => `<th class="n">${MONTHS[+x.key.slice(5, 7) - 1]}</th>`).join('')}</tr></thead><tbody>
      <tr><td>In</td>${r.months.map(x => td(fmtNum(Math.round(x.inc)))).join('')}</tr><tr><td>Out</td>${r.months.map(x => td(fmtNum(Math.round(x.out)))).join('')}</tr>
      <tr class="tot"><td>Net</td>${r.months.map(x => td(fmtNum(Math.round(x.inc - x.out)), sgn(x.inc - x.out))).join('')}</tr></tbody></table>`;
  }
  /* bills coming */
  const due = reminders(30);
  if (due.length) {
    const A = Object.fromEntries(q('SELECT * FROM accounts').map(x => [x.id, x]));
    h += `<h2>Coming in the next 30 days</h2><table><thead><tr><th>Date</th><th>What</th><th>Account</th><th class="n">Amount</th></tr></thead><tbody>` +
      due.map(r => `<tr><td>${fmtDate(r.next_date)}</td><td>${esc(r.kind === 'transfer' ? 'Transfer' : (r.payee || cats().label(r.category_id)))}<div class="psub">${esc(FREQS[r.freq] || '')}</div></td><td>${esc((A[r.account_id] || {}).name || '')}</td>${td((r.kind === 'in' ? '+' : r.kind === 'out' ? '−' : '') + money(r.amount, (A[r.account_id] || {}).currency || H), r.kind === 'in' ? 'up' : '')}</tr>`).join('') + `</tbody></table>`;
  }
  h += `<footer class="pf">Made with KJT Invest ${APP_VERSION} · knowingjesus.today · printed from your own device; nothing was sent anywhere.</footer>`;
  document.getElementById('print').innerHTML = h;
  native('print', { title: 'KJT Invest report ' + now }).then(r => {
    if (r && r.error === 'unknown command') window.print();
    else if (r && r.error) toast('Could not print: ' + r.error);
  });
}

/* ---------------- Loans you make to people ----------------
   Each loan: who, how much, when, an optional due date and interest rate. Repayments lower what is still owed;
   interest received is income. A loan can take the money from one of your accounts, and a repayment can go into one:
   those movements are recorded as transactions in the "Loans" category, which is not counted as spending or income. */
function loanCat(sub) {
  const C = cats(), top = C.rows.find(c => !c.parent_id && c.name === 'Loans');
  if (!top) return null; const s = C.rows.find(c => c.parent_id === top.id && c.name === sub); return s ? s.id : top.id;
}
function interestCat() { const r = cats().rows.find(c => !c.parent_id && c.kind === 'in' && c.name === 'Interest'); return r ? r.id : null; }
function loanStats(l, onDate) {
  const d = onDate || today();
  const pays = q('SELECT * FROM loan_payments WHERE loan_id=? ORDER BY date DESC, id DESC', [l.id]);
  let repaid = 0, interest = 0;
  for (const p of pays) if (p.date <= d) { repaid += p.principal || 0; interest += p.interest || 0; }
  const owed = l.date > d ? 0 : Math.max(0, l.amount - repaid);
  const overdue = !l.closed && owed > 0.005 && l.due_date && l.due_date < today();
  return { pays, repaid, interest, owed, overdue, paidPct: l.amount ? Math.min(1, repaid / l.amount) : 0 };
}
function loansTotal() {   /* what people owe you, in your home currency */
  const H = home(); let total = 0, missing = false;
  for (const l of q('SELECT * FROM loans WHERE closed=0')) { const v = conv(loanStats(l).owed, l.currency || H, H); if (v == null) missing = true; else total += v; }
  return { total, missing };
}
const loanIcon = (size) => `<svg class="picon" viewBox="0 0 24 24" width="${size || 26}" height="${size || 26}" aria-hidden="true"><path d="M3 15.5l3.5-.5 4 2.5h4a1.5 1.5 0 0 0 0-3h-3"/><path d="M6.5 15l4.2-3.2a2 2 0 0 1 2.3-.1L16 13.5l4-1.5"/><circle cx="15.5" cy="6" r="2.6"/></svg>`;
function renderLoans() {
  setTitle('Assets');
  const H = home(), ls = q('SELECT * FROM loans ORDER BY closed, COALESCE(due_date, "9999"), person');
  let h = missingWarn(), open = 0, n = 0;
  const rows = ls.map(l => { const s = loanStats(l), c = l.currency || H; if (!l.closed) { open += conv(s.owed, c, H) || 0; n++; }
    return `<div class="txn${l.closed ? ' off' : s.overdue ? ' cost' : ' inc'}" data-loan="${l.id}"><div class="txn-top"><span class="txn-date${s.overdue ? ' warn-t' : ''}">${l.closed ? 'repaid' : l.due_date ? (s.overdue ? 'overdue since ' : 'due ') + fmtDate(l.due_date) : 'lent ' + fmtDate(l.date)}</span><span class="txn-desc">${esc(l.person)}</span></div>
      <div class="txn-body"><div class="sub">lent ${money(l.amount, c, { dec: 0 })}${l.rate ? ' · ' + l.rate + '% a year' : ''}${s.repaid ? ' · repaid ' + money(s.repaid, c, { dec: 0 }) : ''}</div>
      <div class="r"><div class="strongv">${money(s.owed, c)}</div><div class="sub">still owed</div></div></div>${limitBar(s.paidPct).replace('limitbar', 'limitbar paid')}</div>`; });
  h += `<h2 class="sect">Total</h2><div class="card hero"><div class="label">Owed to you (${H})</div><div class="big">${whole(open, H)}</div><div class="sub">${n} open loan${n === 1 ? '' : 's'}</div></div>`;
  h += `<h2 class="sect">Your loans <span class="sub">money you lent</span></h2>` + (ls.length ? `<div class="card"><div class="txns" style="margin-top:0">${rows.join('')}</div></div>` : `<div class="card empty">No loans yet. Add money you lent to someone: the app keeps track of what is repaid and what is still owed.</div>`);
  h += `<button class="btn wide" data-act="add-loan">+ Add a loan</button>`;
  view().innerHTML = h;
}
function renderLoan(id) {
  const l = q('SELECT * FROM loans WHERE id=?', [id])[0];
  if (!l) { state.loanId = null; return renderLoans(); }
  setTitle(l.person, true);
  const c = l.currency || home(), s = loanStats(l);
  let h = `<div class="card hero"><div class="label">Lent to ${esc(l.person)} · ${fmtDate(l.date)}</div>
    <div class="big ${s.overdue ? 'down' : ''}">${money(s.owed, c)}</div><div class="sub">${l.closed ? 'repaid in full' : 'still owed'}${l.due_date ? ' · due ' + fmtDate(l.due_date) : ''}${s.overdue ? ' · <b class="down">overdue</b>' : ''}</div>
    ${limitBar(s.paidPct).replace('limitbar', 'limitbar paid')}
    <div class="ie3" style="margin-top:10px"><div class="stat"><div class="k">Lent</div><div class="v">${money(l.amount, c, { dec: 0 })}</div></div><div class="stat"><div class="k">Repaid</div><div class="v up">${money(s.repaid, c, { dec: 0 })}</div></div><div class="stat"><div class="k">Interest</div><div class="v up">${money(s.interest, c, { dec: 0 })}</div></div></div>
    ${l.rate ? `<p class="sub" style="margin:8px 0 0">${l.rate}% a year: about ${money(s.owed * l.rate / 100 / 12, c)} interest a month on what is owed now.</p>` : ''}
    ${l.notes ? `<div class="note" style="margin-top:10px;text-align:left">${esc(l.notes)}</div>` : ''}
    <div class="btns">${l.closed ? '' : `<button class="btn" data-act="add-loanpay" data-id="${l.id}">+ Repayment</button>`}<button class="btn light" data-act="edit-loan" data-id="${l.id}">Edit</button></div></div>`;
  h += `<h2 class="sect">Repayments</h2><div class="card">` + (s.pays.length ? `<div class="txns" style="margin-top:0">` + s.pays.map(p => `<div class="txn inc" data-lpay="${p.id}"><div class="txn-top"><span class="txn-date">${fmtDate(p.date)}</span><span class="txn-desc">${esc(p.note || 'Repayment')}</span></div>
      <div class="txn-body"><div class="sub">${p.interest ? 'interest ' + money(p.interest, c) : ''}${p.account_id ? (p.interest ? ' · ' : '') + 'into ' + esc((q('SELECT name FROM accounts WHERE id=?', [p.account_id])[0] || {}).name || '') : ''}</div><div class="r"><div class="strongv">${money((p.principal || 0) + (p.interest || 0), c)}</div></div></div></div>`).join('') + `</div>` : '<p class="sub">No repayments yet.</p>') + `</div>`;
  view().innerHTML = h;
}
function loanForm(id) {
  const l = id ? q('SELECT * FROM loans WHERE id=?', [id])[0] : { date: today(), currency: home() };
  const accts = q("SELECT * FROM accounts WHERE type<>'credit' ORDER BY name");
  const people = q('SELECT DISTINCT person FROM loans ORDER BY person').map(r => r.person);
  openSheet(`<h2>${id ? 'Edit' : 'New'} loan</h2>
    ${field('person', 'Lent to', l.person, 'autocomplete="off" list="lpeople" placeholder="name"')}<datalist id="lpeople">${people.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
    <div class="f2">${field('amount', 'Amount lent', l.amount)}<label class="f"><span>Currency</span><select name="currency">${curOptions(l.currency || home())}</select></label></div>
    <div class="f2">${field('date', 'Date lent', l.date, 'type="date"')}${field('due_date', 'Due date (optional)', l.due_date, 'type="date"')}</div>
    ${field('rate', 'Interest % a year (optional)', l.rate)}
    ${id ? '' : `<label class="f"><span>The money came from (optional)</span><select name="account_id"><option value="">Not from an account here</option>${accts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>`}
    <label class="f"><span>Notes</span><textarea name="notes">${esc(l.notes)}</textarea></label>
    ${id ? `<label class="switch"><span>Repaid in full / closed</span><input type="checkbox" name="closed"${l.closed ? ' checked' : ''}></label>` : ''}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn danger" data-f="delete">Delete loan</button></div>' : ''}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'delete') { ask('Delete this loan and its repayments? Transactions already in your accounts stay.').then(y => { if (!y) return;
        run('DELETE FROM loan_payments WHERE loan_id=?', [id]); run('DELETE FROM loans WHERE id=?', [id]); run('UPDATE transactions SET link=NULL WHERE link=?', ['loan:' + id]);
        state.loanId = null; save(); closeSheet(); render(); }); return; }
      const d = formData(box), amt = num(d.amount), rate = num(d.rate);
      if (!(d.person || '').trim()) return bad('Who did you lend to?');
      if (!(amt > 0)) return bad('Enter the amount lent.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return bad('Enter the date.');
      if (Number.isNaN(rate)) return bad('Check the interest rate.');
      const closed = box.querySelector('[name=closed]') && box.querySelector('[name=closed]').checked ? 1 : 0;
      const vals = [d.person.trim(), amt, d.currency, d.date, d.due_date || null, rate, (d.notes || '').trim()];
      if (id) run('UPDATE loans SET person=?,amount=?,currency=?,date=?,due_date=?,rate=?,notes=?,closed=? WHERE id=?', vals.concat([closed, id]));
      else {
        run('INSERT INTO loans(person,amount,currency,date,due_date,rate,notes,closed) VALUES(?,?,?,?,?,?,?,0)', vals);
        const nid = q('SELECT last_insert_rowid() id')[0].id;
        if (d.account_id) run('INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,to_account_id,link,recurring_id,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          [+d.account_id, d.date, 'out', amt, loanCat('Lent'), d.person.trim(), 'Loan', null, 'loan:' + nid, null, Date.now()]);
        state.tab = 'loans'; state.loanId = nid;
      }
      save(); closeSheet(); render(); };
  });
}
function loanPayForm(loanId, payId) {
  const l = q('SELECT * FROM loans WHERE id=?', [loanId])[0]; if (!l) return;
  const p = payId ? q('SELECT * FROM loan_payments WHERE id=?', [payId])[0] : { date: today() };
  const s = loanStats(l), c = l.currency || home(), accts = q("SELECT * FROM accounts WHERE type<>'credit' ORDER BY name");
  openSheet(`<h2>${esc(l.person)}: ${payId ? 'edit' : 'new'} repayment</h2>
    <p class="sub">Still owed: <b>${money(s.owed, c)}</b></p>
    <div class="f2">${field('principal', 'Repaid (' + c + ')', p.principal)}${field('interest', 'Interest received (optional)', p.interest)}</div>
    ${field('date', 'Date', p.date, 'type="date"')}
    ${payId ? '' : `<label class="f"><span>Paid into (optional)</span><select name="account_id"><option value="">Not into an account here (cash in hand…)</option>${accts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>`}
    ${field('note', 'Note (optional)', p.note, 'autocomplete="off"')}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${payId ? '<div class="btns"><button class="btn danger" data-f="delete">Delete</button></div>' : `<div class="btns"><button class="btn light" data-f="all">All of it (${money(s.owed, c)})</button></div>`}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'all') { box.querySelector('[name=principal]').value = fmtNum(+s.owed.toFixed(2)); return; }
      if (f === 'delete') { ask('Delete this repayment? A transaction already in your account stays.').then(y => { if (!y) return; run('DELETE FROM loan_payments WHERE id=?', [payId]); run('UPDATE loans SET closed=0 WHERE id=?', [loanId]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), pr = num(d.principal) || 0, it = num(d.interest) || 0;
      if (Number.isNaN(pr) || Number.isNaN(it) || !(pr + it > 0)) return bad('Enter the amount repaid.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return bad('Enter the date.');
      if (payId) run('UPDATE loan_payments SET date=?,principal=?,interest=?,note=? WHERE id=?', [d.date, pr, it, (d.note || '').trim(), payId]);
      else {
        run('INSERT INTO loan_payments(loan_id,date,principal,interest,account_id,note) VALUES(?,?,?,?,?,?)', [loanId, d.date, pr, it, +d.account_id || null, (d.note || '').trim()]);
        if (d.account_id) {
          const ins = (amt, cat, note) => run('INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,to_account_id,link,recurring_id,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            [+d.account_id, d.date, 'in', amt, cat, l.person, note, null, 'loan:' + loanId, null, Date.now()]);
          if (pr > 0) ins(pr, loanCat('Repaid'), 'Loan repayment');
          if (it > 0) ins(it, interestCat(), 'Loan interest');
        }
      }
      const st = loanStats(l); if (st.owed <= 0.005) { run('UPDATE loans SET closed=1 WHERE id=?', [loanId]); toast(l.person + ' has repaid everything'); }
      save(); closeSheet(); render(); };
  });
}

/* ---------------- Bank files: OFX / QFX / QIF / CSV downloaded from online banking ----------------
   Fully private: you download the file from your bank yourself; the app reads it on this device.
   No bank password is ever asked for and nothing is sent anywhere.
   - Transactions already in the app are skipped (bank reference number, or same date + amount + description,
     or one you typed in yourself with the same amount within 3 days).
   - Categories are guessed from what you chose before for the same payee.
   - The balance in the file (OFX, or a CSV balance column) becomes a balance check. */
function bankText(bytes) {
  let t = new TextDecoder('utf-8').decode(bytes);
  if (t.includes('�')) t = new TextDecoder('windows-1252').decode(bytes);
  return t.replace(/^﻿/, '');
}
function ofxDate(s) { const m = /^(\d{4})(\d{2})(\d{2})/.exec(s || ''); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; }
function ofxTag(block, tag) { const m = new RegExp('<' + tag + '>\\s*([^<\\r\\n]*)', 'i').exec(block); return m ? m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null; }
function parseOfx(t) {
  const credit = /<CCSTMTRS>/i.test(t), out = { format: 'OFX', credit, txs: [] };
  out.acctId = ofxTag(t, 'ACCTID'); out.currency = ofxTag(t, 'CURDEF');
  const lb = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i.exec(t);
  if (lb) { const v = num(ofxTag(lb[1], 'BALAMT')); if (v != null && !Number.isNaN(v)) { out.balance = v; out.balDate = ofxDate(ofxTag(lb[1], 'DTASOF')); } }
  const re = /<STMTTRN>([\s\S]*?)(<\/STMTTRN>|(?=<STMTTRN>)|<\/BANKTRANLIST>)/gi; let m;
  while ((m = re.exec(t))) {
    const b = m[1], amt = num(ofxTag(b, 'TRNAMT')), date = ofxDate(ofxTag(b, 'DTPOSTED') || ofxTag(b, 'DTUSER'));
    if (amt == null || Number.isNaN(amt) || !date) continue;
    const name = ofxTag(b, 'NAME') || '', memo = ofxTag(b, 'MEMO') || '';
    out.txs.push({ date, amount: amt, payee: name || memo, memo: name && memo && memo !== name ? memo : '', ref: ofxTag(b, 'FITID') });
  }
  return out;
}
/* dates written as 2026-11-26, 11/26/2026, 26/11/2026, 26-Nov-2026, Nov 26, 2026, 20261126 … */
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function dateParts(s) {
  s = String(s || '').trim().replace(/'/g, '/'); let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return { y: +m[1], a: +m[2], b: +m[3], iso: true };
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return { y: +m[1], a: +m[2], b: +m[3], iso: true };
  if ((m = /^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*\.?[-/. ,]+(\d{2,4})/.exec(s)) && MON[m[2].toLowerCase()]) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], a: MON[m[2].toLowerCase()], b: +m[1], iso: true };
  if ((m = /^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})/.exec(s)) && MON[m[1].toLowerCase()]) return { y: +m[3], a: MON[m[1].toLowerCase()], b: +m[2], iso: true };
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], a: +m[1], b: +m[2], iso: false };
  return null;
}
function guessDayFirst(values) { for (const v of values) { const p = dateParts(v); if (p && !p.iso) { if (p.a > 12) return true; if (p.b > 12) return false; } } return null; }
function toIso(v, dayFirst) {
  const p = dateParts(v); if (!p) return null;
  const mo = p.iso ? p.a : dayFirst ? p.b : p.a, d = p.iso ? p.b : dayFirst ? p.a : p.b;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || p.y < 1900) return null;
  return `${p.y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function moneyNum(s) {
  if (s == null) return null; let t = String(s).trim(); if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /-$/.test(t) || /^-/.test(t.replace(/^[^\d-]*/, '')) || /\bDR\b/i.test(t);
  t = t.replace(/[()]/g, '').replace(/\bCR\b|\bDR\b/ig, '').replace(/[^\d.,-]/g, '').replace(/-/g, '');
  if (/,\d{2}$/.test(t) && !/\.\d/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  if (!t) return null; const n = Number(t); return isFinite(n) ? (neg ? -n : n) : null;
}
function parseQif(t) {
  const out = { format: 'QIF', txs: [], credit: /!Type:(CCard)/i.test(t) }, raw = [];
  let cur = {};
  for (const line of t.split(/\r?\n/)) {
    const k = line[0], v = line.slice(1).trim();
    if (k === '^') { if (cur.D && cur.T != null) raw.push(cur); cur = {}; }
    else if (k === 'D') cur.D = v; else if (k === 'T' || k === 'U') cur.T = v; else if (k === 'P') cur.P = v; else if (k === 'M') cur.M = v; else if (k === 'N') cur.N = v;
  }
  const df = guessDayFirst(raw.map(r => r.D));
  for (const r of raw) { const date = toIso(r.D, df), amount = moneyNum(r.T); if (date && amount != null) out.txs.push({ date, amount, payee: r.P || r.M || '', memo: r.P && r.M ? r.M : '', ref: r.N || null }); }
  return out;
}
function csvRows(t) {
  const first = t.split(/\r?\n/, 1)[0], delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(x => x !== '')) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell.trim()); if (row.some(x => x !== '')) rows.push(row);
  return rows;
}
function guessCsv(rows) {   /* which column is which, from the header words and the values */
  const hasHeader = rows.length > 1 && !rows[0].some(c => dateParts(c)) ; const head = hasHeader ? rows[0].map(h => h.toLowerCase()) : [];
  const body = hasHeader ? rows.slice(1) : rows, n = Math.max(...rows.map(r => r.length));
  const find = re => head.findIndex(h => re.test(h));
  const score = (i, f) => body.slice(0, 40).filter(r => f(r[i])).length;
  const isNum = v => v != null && v !== '' && moneyNum(v) != null && /\d/.test(v);
  let date = find(/date|posted/); if (date < 0) { let best = -1, bs = 0; for (let i = 0; i < n; i++) { const s = score(i, v => dateParts(v)); if (s > bs) { bs = s; best = i; } } date = best; }
  let out = find(/debit|withdraw|paid out|money out|^out|charge/), inn = find(/credit|deposit|paid in|money in|^in$|payment/);
  let amount = find(/amount|cad\$|montant|value/);
  let bal = find(/balance|solde/);
  let desc = [/^desc|description( 1)?$|payee|^name|merchant|libell/, /detail|memo|narrative/, /transaction(?! date)/].reduce((f, re) => f >= 0 ? f : head.findIndex((h, i) => i !== date && re.test(h)), -1);
  let desc2 = head.findIndex((h, i) => i !== desc && /description 2|desc.*2|memo|detail/.test(h));
  const numericCols = []; for (let i = 0; i < n; i++) { if (i === date) continue; const vals = body.slice(0, 40).map(r => r[i]).filter(v => v != null && v !== '');
    if (vals.length && vals.every(isNum) && !vals.every(v => /^\d{4,}[-\d]*$/.test(v.replace(/\s/g, '')))) numericCols.push(i); }
  if (amount < 0 && out < 0 && inn < 0) {
    if (!hasHeader && numericCols.length >= 2) { out = numericCols[0]; inn = numericCols[1]; if (numericCols.length >= 3 && bal < 0) bal = numericCols[2]; }   /* TD style: date, description, out, in, balance */
    else if (numericCols.length) amount = numericCols[0];
  }
  if (desc < 0) { let best = -1, bl = 0; for (let i = 0; i < n; i++) { if (i === date || numericCols.includes(i)) continue; const l = body.slice(0, 20).reduce((s, r) => s + String(r[i] || '').length, 0); if (l > bl) { bl = l; best = i; } } desc = best; }
  return { hasHeader, date, desc, desc2, amount: out >= 0 || inn >= 0 ? -1 : amount, out, inn, bal, dayFirst: guessDayFirst(body.map(r => r[date])) };
}
function csvToTxs(rows, map) {
  const body = map.hasHeader ? rows.slice(1) : rows, txs = []; let balance = null, balDate = null;
  for (const r of body) {
    const date = toIso(r[map.date], map.dayFirst); if (!date) continue;
    let amt = null;
    if (map.amount >= 0) amt = moneyNum(r[map.amount]);
    else { const o = map.out >= 0 ? moneyNum(r[map.out]) : null, i = map.inn >= 0 ? moneyNum(r[map.inn]) : null; if (o == null && i == null) continue; amt = (i ? Math.abs(i) : 0) - (o ? Math.abs(o) : 0); }
    if (amt == null || amt === 0) continue;
    if (map.flip) amt = -amt;
    const extra = (map.desc2 >= 0 && r[map.desc2]) ? r[map.desc2] : '';
    txs.push({ date, amount: amt, payee: r[map.desc] || extra || '', memo: r[map.desc] && extra ? extra : '' });
    if (map.bal >= 0) { const b = moneyNum(r[map.bal]); if (b != null && (!balDate || date >= balDate)) { balance = b; balDate = date; } }
  }
  return { format: 'CSV', txs, balance, balDate };
}
/* ---- matching and guessing ---- */
const normPayee = s => String(s || '').toLowerCase().replace(/[#*]\s*\d+|\d{3,}|\s+/g, ' ').replace(/[^a-z& ]/g, '').trim();
const firstWord = s => (normPayee(s).split(' ').find(w => w.length >= 4) || '');
function payeeMemory() {   /* the category you chose most recently for each payee (or, failing that, its first word: "METRO #456" like "METRO #123") */
  const full = {}, first = {};
  for (const t of q("SELECT payee, category_id FROM transactions WHERE payee IS NOT NULL AND payee<>'' AND category_id IS NOT NULL ORDER BY date, id")) {
    full[normPayee(t.payee)] = t.category_id; const w = firstWord(t.payee); if (w) first[w] = t.category_id; }
  return { get: p => full[normPayee(p)] || first[firstWord(p)] || null };
}
function prepareImport(parsed, accountId) {
  const a = q('SELECT * FROM accounts WHERE id=?', [accountId])[0], credit = a && a.type === 'credit';
  const have = q('SELECT * FROM transactions WHERE account_id=? OR to_account_id=?', [accountId, accountId]);
  const refs = new Set(have.filter(t => t.import_id).map(t => t.import_id)), used = new Set(), mem = payeeMemory(), cardPay = transferCat();
  const seen = {}, rows = [];
  for (const x of parsed.txs) {
    const base = `${x.date}|${x.amount.toFixed(2)}|${normPayee(x.payee)}`; seen[base] = (seen[base] || 0) + 1;
    const iid = x.ref ? `ref:${parsed.acctId || ''}:${x.ref}` : `h:${base}|${seen[base]}`;
    let dup = refs.has(iid);
    if (!dup) {   /* typed in by hand before: same account, same amount, within 3 days, not imported */
      const kind = x.amount >= 0 ? 'in' : 'out', abs = Math.abs(x.amount);
      const hit = have.find(t => !t.import_id && !used.has(t.id) && Math.abs(t.amount - abs) < 0.005 && Math.abs(dnum(t.date) - dnum(x.date)) <= 3 &&
        (t.kind === kind || (t.kind === 'transfer' && ((kind === 'out' && t.account_id === accountId) || (kind === 'in' && t.to_account_id === accountId)))));
      if (hit) { used.add(hit.id); dup = 'match'; x.matchId = hit.id; }
      /* already imported from another kind of file (a CSV after an OFX…): same day, same amount, same payee */
      else if (have.some(t => t.import_id && !used.has(t.id) && Math.abs(dnum(t.date) - dnum(x.date)) <= 3 && Math.abs(t.amount - abs) < 0.005 && firstWord(t.payee) === firstWord(x.payee) && used.add(t.id))) dup = true;
    }
    const kind = x.amount >= 0 ? 'in' : 'out';
    let cat = mem.get(x.payee);
    if (!cat && credit && kind === 'in') cat = cardPay;   /* a payment to the card is not income */
    rows.push(Object.assign({}, x, { iid, dup, kind, cat }));
  }
  return { rows, account: a };
}
function transferCat() { const r = cats().rows.find(c => !c.parent_id && c.name === 'Transfers & card payments'); return r ? r.id : null; }
/* ---- the screens ---- */
async function bankImport(accountId) {
  if (!q('SELECT COUNT(*) n FROM accounts')[0].n) return toast('First add the account (Assets › Accounts), then import its bank file.');
  const r = await native('importDb', { title: 'Choose the file from your bank', filter: 'bank' });
  if (!r.b64) { if (r.error) toast('Could not open the file: ' + r.error); return; }
  const t = bankText(b64ToBytes(r.b64));
  let parsed;
  if (/<OFX>|OFXHEADER/i.test(t)) parsed = parseOfx(t);
  else if (/^\s*!Type:/i.test(t)) parsed = parseQif(t);
  else { const rows = csvRows(t); if (rows.length < 1) return toast('This file has no transactions in it.'); return csvMapForm(rows, accountId); }
  if (!parsed.txs.length) return toast('No transactions found in this file.');
  importReview(parsed, accountId);
}
function csvMapForm(rows, accountId) {
  const g0 = guessCsv(rows), sig = 'csvmap:' + (g0.hasHeader ? rows[0].join('|').toLowerCase() : 'cols' + Math.max(...rows.map(r => r.length)));
  let saved = null; try { saved = JSON.parse(getSetting(sig, 'null')); } catch (e) { saved = null; }
  const g = Object.assign(g0, saved || {}), head = g.hasHeader ? rows[0] : rows[0].map((_, i) => 'Column ' + (i + 1));
  const opt = (sel, none) => (none ? `<option value="-1">${none}</option>` : '') + head.map((h, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(h || 'Column ' + (i + 1))}${g.hasHeader ? '' : ' (' + esc(String(rows[0][i] || '').slice(0, 18)) + ')'}</option>`).join('');
  const two = g.amount < 0;
  openSheet(`<h2>Which column is which?</h2><p class="sub">The app guessed from your file; correct anything that is wrong. It is remembered for next time.</p>
    <div class="f2"><label class="f"><span>Date</span><select name="date">${opt(g.date)}</select></label><label class="f"><span>Date written as</span><select name="df"><option value="0"${g.dayFirst ? '' : ' selected'}>month / day</option><option value="1"${g.dayFirst ? ' selected' : ''}>day / month</option></select></label></div>
    <div class="f2"><label class="f"><span>Description</span><select name="desc">${opt(g.desc)}</select></label><label class="f"><span>More description</span><select name="desc2">${opt(g.desc2 == null ? -1 : g.desc2, 'none')}</select></label></div>
    <div class="freqs" style="grid-template-columns:1fr 1fr"><label class="freqo"><input type="radio" name="mode" value="one"${two ? '' : ' checked'}><span>One amount column</span></label><label class="freqo"><input type="radio" name="mode" value="two"${two ? ' checked' : ''}><span>Money out / in</span></label></div>
    <div id="m-one"><label class="f"><span>Amount</span><select name="amount">${opt(Math.max(0, g.amount))}</select></label>
      <label class="switch"><span>Spending is shown as a positive number</span><input type="checkbox" name="flip"${g.flip ? ' checked' : ''}></label></div>
    <div id="m-two" class="f2"><label class="f"><span>Money out</span><select name="out">${opt(g.out, 'none')}</select></label><label class="f"><span>Money in</span><select name="inn">${opt(g.inn, 'none')}</select></label></div>
    <label class="f"><span>Balance (optional)</span><select name="bal">${opt(g.bal, 'none')}</select></label>
    <div id="csv-prev" class="preview"></div>
    <div class="btns"><button class="btn" data-f="next">Next</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    const read = () => { const d = formData(box), m = (box.querySelector('[name=mode]:checked') || {}).value;
      return { hasHeader: g.hasHeader, date: +d.date, desc: +d.desc, desc2: +d.desc2, dayFirst: d.df === '1', amount: m === 'one' ? +d.amount : -1, out: m === 'two' ? +d.out : -1, inn: m === 'two' ? +d.inn : -1, bal: +d.bal, flip: m === 'one' && box.querySelector('[name=flip]').checked }; };
    const show = () => { const m = (box.querySelector('[name=mode]:checked') || {}).value;
      box.querySelector('#m-one').style.display = m === 'one' ? '' : 'none'; box.querySelector('#m-two').style.display = m === 'two' ? '' : 'none';
      const p = csvToTxs(rows, read()), H = home();
      box.querySelector('#csv-prev').innerHTML = p.txs.length ? `<b>${p.txs.length}</b> transactions found. First ones:<br>` + p.txs.slice(0, 4).map(x => `${fmtDate(x.date)} · ${esc(x.payee.slice(0, 28))} · <span class="${x.amount < 0 ? 'down' : 'up'}">${x.amount < 0 ? '−' : '+'}${money(Math.abs(x.amount), H)}</span>`).join('<br>') : '<span class="down">No transactions with these columns.</span>'; };
    box.oninput = show; box.onchange = show; show();
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      const mp = read(), p = csvToTxs(rows, mp); if (!p.txs.length) return bad('No transactions with these columns.');
      setSetting(sig, JSON.stringify(mp));
      importReview(p, accountId); };
  });
}
function importReview(parsed, accountId) {
  const accts = q('SELECT * FROM accounts ORDER BY name');
  let map = {}; try { map = JSON.parse(getSetting('import_map', '{}')) || {}; } catch (e) { map = {}; }
  let acc = accountId || (parsed.acctId && map[parsed.acctId]) || (accts.find(a => parsed.credit ? a.type === 'credit' : a.type !== 'credit') || accts[0]).id;
  if (!accts.some(a => a.id === +acc)) acc = accts[0].id;
  const dates = parsed.txs.map(x => x.date).sort();
  openSheet(`<h2>Import ${parsed.format} file</h2>
    <label class="f"><span>Into which account?</span><select name="acct">${accts.map(a => `<option value="${a.id}"${a.id === +acc ? ' selected' : ''}>${esc(a.name)}${a.type === 'credit' ? ' (credit card)' : ''}</option>`).join('')}</select></label>
    <div id="imp-sum"></div>
    <div class="btns"><button class="btn" data-f="go">Import</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    let prep = null;
    const show = () => {
      const id = +box.querySelector('[name=acct]').value; prep = prepareImport(parsed, id);
      const a = prep.account, c = a.currency || home(), fresh = prep.rows.filter(r => !r.dup), dup = prep.rows.length - fresh.length;
      const guessed = fresh.filter(r => r.cat).length;
      box.querySelector('#imp-sum').innerHTML = `<div class="ie3"><div class="stat"><div class="k">New</div><div class="v">${fresh.length}</div></div><div class="stat"><div class="k">Already here</div><div class="v">${dup}</div></div><div class="stat"><div class="k">Categorised</div><div class="v">${guessed}</div></div></div>
        <p class="sub" style="margin:8px 0">${fmtDate(dates[0])} to ${fmtDate(dates[dates.length - 1])}${parsed.balance != null ? ` · balance in the file: <b>${money(a.type === 'credit' ? Math.abs(parsed.balance) : parsed.balance, c)}</b>${a.type === 'credit' ? ' owed' : ''} on ${fmtDate(parsed.balDate || dates[dates.length - 1])}` : ''}</p>
        ${parsed.currency && a.currency && parsed.currency !== a.currency ? `<div class="warn">The file is in ${esc(parsed.currency)} but this account is in ${esc(a.currency)}.</div>` : ''}
        ${fresh.length ? `<div class="preview">${fresh.slice(0, 6).map(r => `${fmtDate(r.date)} · ${esc((r.payee || '').slice(0, 26))} · <span class="${r.amount < 0 ? 'down' : 'up'}">${r.amount < 0 ? '−' : '+'}${money(Math.abs(r.amount), c)}</span>${r.cat ? ' · <i>' + esc(cats().label(r.cat)) + '</i>' : ''}`).join('<br>')}${fresh.length > 6 ? '<br>…and ' + (fresh.length - 6) + ' more' : ''}</div>` : '<p class="sub">Everything in this file is already in the app.</p>'}
        <p class="hint">Transactions without a category can be sorted later: tap one under Cash flow. Next time, the same payee gets the same category by itself.</p>`;
      box.querySelector('[data-f=go]').textContent = fresh.length ? `Import ${fresh.length}` : 'Update the balance only';
    };
    box.querySelector('[name=acct]').onchange = show; show();
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      const id = +box.querySelector('[name=acct]').value, a = prep.account, now = Date.now(); let n = 0;
      db.exec('BEGIN');
      try {
        for (const r of prep.rows) {
          if (r.dup === 'match') { run('UPDATE transactions SET import_id=? WHERE id=?', [r.iid, r.matchId]); continue; }
          if (r.dup) continue;
          run('INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,to_account_id,link,recurring_id,created,import_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            [id, r.date, r.kind, Math.abs(r.amount), r.cat, r.payee.slice(0, 120), (r.memo || '').slice(0, 200), null, null, null, now, r.iid]); n++;
        }
        if (parsed.balance != null) {
          const bd = parsed.balDate || dates[dates.length - 1], bv = a.type === 'credit' ? Math.abs(parsed.balance) : parsed.balance;
          if (!q('SELECT id FROM account_balances WHERE account_id=? AND date=? AND ABS(balance-?)<0.005', [id, bd, bv]).length)
            run('INSERT INTO account_balances(account_id,date,balance,note,created) VALUES(?,?,?,?,?)', [id, bd, bv, 'From the bank file', now + 1]);
        }
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); return bad('Import failed: ' + err.message); }
      if (parsed.acctId) { map[parsed.acctId] = id; setSetting('import_map', JSON.stringify(map)); }
      save(); closeSheet(); toast(n ? n + ' transaction' + (n > 1 ? 's' : '') + ' imported' : 'Nothing new; balance updated');
      state.tab = 'accounts'; state.accountId = id; render(); view().scrollTop = 0; };
  });
}

/* ---------------- 1.9: every section folds; long lists show a few and "Show all" ----------------
   Runs after each screen is drawn. Tap a section's heading to fold or unfold it; the app remembers. */
let FOLDED = null;
function folded() { if (!FOLDED) { try { FOLDED = new Set(JSON.parse(getSetting('folded', '[]'))); } catch (e) { FOLDED = new Set(); } } return FOLDED; }
const LIST_SHOW = 6;
function enhanceView() {
  const v = view(), F = folded(), page = state.tab + (state.msec && state.tab === 'money' ? '/' + state.msec : '');
  /* sections */
  for (const h of Array.from(v.querySelectorAll(':scope > h2.sect'))) {
    const title = (h.childNodes[0] && h.childNodes[0].textContent || h.textContent).trim(), key = page + ':' + title;
    const body = document.createElement('div'); body.className = 'foldbody';
    let n = h.nextSibling;
    while (n && !(n.nodeType === 1 && n.matches('h2.sect'))) { const nx = n.nextSibling; body.appendChild(n); n = nx; }
    h.after(body);
    h.classList.add('foldh'); h.setAttribute('role', 'button'); h.tabIndex = 0;
    h.insertAdjacentHTML('beforeend', '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>');
    const set = closed => { h.classList.toggle('closed', closed); body.hidden = closed; h.setAttribute('aria-expanded', String(!closed)); };
    set(F.has(key));
    const toggle = () => { const c = !h.classList.contains('closed'); set(c); if (c) F.add(key); else F.delete(key); setSetting('folded', JSON.stringify(Array.from(F))); save();
      if (!c) for (const [id, k] of [['heroS', 'hpage'], ['cfS', 'cfPage']]) { const el = document.getElementById(id); if (el) fitSwipe(el, state[k] || 0); } };
    h.onclick = toggle; h.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  }
  /* long lists */
  state.showAll = state.showAll || {};
  v.querySelectorAll('.txns, .txlist, .catlist, .alloc, .catbars').forEach((list, li) => {
    const items = Array.from(list.children).filter(c => !c.classList.contains('txday') && !c.classList.contains('morebtn'));
    if (items.length <= LIST_SHOW + 2) return;
    const key = page + ':' + li + ':' + (state.propertyId || state.accountId || state.assetId || state.loanId || '');
    const open = !!state.showAll[key], cut = items[LIST_SHOW];
    let hide = false;
    for (const c of Array.from(list.children)) { if (c === cut) hide = true; if (hide && !open) c.classList.add('more-hidden'); }
    /* a day heading with nothing visible under it goes too */
    if (!open) list.querySelectorAll('.txday').forEach(d => { let s = d.nextElementSibling; if (!s || s.classList.contains('more-hidden') || s.classList.contains('txday')) d.classList.add('more-hidden'); });
    const b = document.createElement('button'); b.className = 'morebtn';
    b.textContent = open ? 'Show fewer' : `Show all ${items.length}`;
    b.onclick = e => { e.stopPropagation(); state.showAll[key] = !open; const st = view().scrollTop; render(); view().scrollTop = st; };
    list.appendChild(b);
  });
  /* quick add on the Cash flow pages */
  const fab = document.getElementById('fab');
  if (fab) { fab.hidden = !(state.tab === 'money' && q('SELECT COUNT(*) n FROM accounts')[0].n); v.style.paddingBottom = fab.hidden ? '' : '96px'; }
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
  if (it && newerThan(it.version, APP_VERSION)) {
    const fresh = !updateInfo || updateInfo.version !== it.version;
    updateInfo = Object.assign({ platform: plat }, it, fresh ? {} : { state: updateInfo.state });
    showUpdateBar();
    if (manual) toast('KJT Invest ' + it.version + ' is available');
    else if (fresh && getSetting('auto_update', '1') === '1') autoInstall();
  } else { updateInfo = null; showUpdateBar(); if (manual) toast('You have the newest version (' + APP_VERSION + ')'); }
}
/* updating by itself: Android installs quietly when you leave the app (after the first update, which the phone asks you to
   confirm once); Linux installs it at once and offers to restart. */
async function autoInstall() {
  if (!updateInfo || updateInfo.state) return;
  if (updateInfo.platform === 'android' && appInfo.silentUpdate) {
    updateInfo.state = 'downloading'; showUpdateBar();
    const r = await native('installUpdate', { url: updateInfo.url, sha256: updateInfo.sha256 || '', background: true });
    updateInfo.state = r.error ? null : 'waiting'; showUpdateBar();
  } else if (updateInfo.platform === 'linux') {
    updateInfo.state = 'downloading'; showUpdateBar();
    const r = await native('installUpdate', linuxUpdateArgs(true));
    updateInfo.state = r.installed ? 'installed' : r.opened ? 'opened' : null; showUpdateBar();
  }
}
function linuxUpdateArgs(quiet) {
  const f = updateInfo[(appInfo && appInfo.arch) || 'x86_64'] || {};
  return { quiet, flatpak: { url: f.url, sha256: f.sha256 }, zip: updateInfo.zip || null, url: f.url, sha256: f.sha256 };
}
function showUpdateBar() {
  const b = document.getElementById('upd'); if (!b) return;
  if (!updateInfo) { b.hidden = true; return; }
  const v = esc(updateInfo.version), st = updateInfo.state;
  let msg, btn = '';
  if (st === 'downloading') msg = `Downloading KJT Invest <b>${v}</b>…`;
  else if (st === 'waiting') { msg = `<b>KJT Invest ${v}</b> is ready. It installs by itself when you leave the app.`; btn = 'Install now'; }
  else if (st === 'installed') { msg = `<b>KJT Invest ${v}</b> is installed. Restart to use it.`; btn = 'Restart'; }
  else if (st === 'opened') msg = `Press <b>Install</b> in Software to finish updating to ${v}.`;
  else { msg = `<b>KJT Invest ${v}</b> is ready${updateInfo.notes ? ': ' + esc(updateInfo.notes) : ''}`; btn = 'Update'; }
  b.innerHTML = `<span>${msg}</span>${btn ? `<button class="btn" id="upd-go">${btn}</button>` : ''}`;
  b.hidden = false;
  const g = document.getElementById('upd-go'); if (g) g.onclick = installUpdate;
}
async function installUpdate() {
  if (!updateInfo) return;
  if (updateInfo.state === 'installed') { native('restartApp', {}); return; }
  if (updateInfo.platform === 'android') {
    toast('Downloading the update…');
    const r = await native('installUpdate', { url: updateInfo.url, sha256: updateInfo.sha256 || '' });
    if (r.error) toast('Update not installed: ' + r.error); else toast(appInfo && appInfo.silentUpdate ? 'Installing… the app closes and is updated' : 'Press Update on the screen that opens');
  } else if (updateInfo.platform === 'linux') {
    updateInfo.state = 'downloading'; showUpdateBar();
    const r = await native('installUpdate', linuxUpdateArgs(true));
    if (r.error) { updateInfo.state = null; toast('Update not installed: ' + r.error); }
    else updateInfo.state = r.installed ? 'installed' : 'opened';
    showUpdateBar();
  }
}
/* look again when you come back to the app, and every few hours while it stays open */
function maybeCheck(minMinutes) {
  if (getSetting('auto_update', '1') !== '1' || !db) return;
  const uc = getSetting('update_checked');
  if (!uc || Date.now() - new Date(uc) > minMinutes * 60000) checkUpdate(false);
}
window.__onResume = () => maybeCheck(30);
document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeCheck(30); });
setInterval(() => maybeCheck(180), 15 * 60000);
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
    prepareDb(); loadFx(); processRecurring();
    await saveNow();   /* also stores any upgrade of an older database */
    render();
    if (getSetting('auto_update', '1') === '1') setTimeout(() => checkUpdate(false), 3000);   /* every start */
    const last = getSetting('prices_updated');
    if (getSetting('auto_prices', '1') === '1' && (!last || Date.now() - new Date(last) > 15 * 60000)) updatePrices(true);
  } catch (e) {
    view().innerHTML = `<div class="card"><h2>Could not start</h2><p class="sub">${esc(e && e.message || e)}</p></div>`;
  }
})();
