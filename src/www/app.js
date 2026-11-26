/* KJT Invest 1.3 (Knowing Jesus Today) - one screen code for the Android and Linux apps.
   All data stays in one SQLite file on the device. The only network calls are the
   price updates (metal prices from gold-api.com, exchange rates from the European Central Bank). */
'use strict';

const APP_VERSION = '1.3';
const SCHEMA = 4;
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
    else if (cmd === 'secure' || cmd === 'bioDisable') reply({ ok: true });
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
function yearCosts(y) { return COSTS.reduce((s, [k]) => s + (y[k] || 0), 0); }
/* dates as 'YYYY-MM-DD' strings; day numbers for counting */
const dnum = s => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
const dstr = n => new Date(n * 864e5).toISOString().slice(0, 10);
function fmtDate(s, short) {
  if (!s) return '';
  return new Date(s + 'T12:00:00').toLocaleDateString('en-CA', short ? { year: 'numeric', month: 'short' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
/* rent of one year from the rent periods: whole months and part months, and the months it stood empty */
function rentForYear(p, periods, year) {
  const own0 = p.purchase_date ? dnum(p.purchase_date) : -Infinity;
  let rent = 0, empty = 0, ownedMonths = 0, open = false;
  for (let m = 0; m < 12; m++) {
    const a = dnum(`${year}-${String(m + 1).padStart(2, '0')}-01`);
    const b = dnum(m === 11 ? `${year + 1}-01-01` : `${year}-${String(m + 2).padStart(2, '0')}-01`) - 1;   // last day
    const days = b - a + 1, oa = Math.max(a, own0); if (oa > b) continue;
    const owned = b - oa + 1; let rented = 0;
    for (const r of periods) {
      const s = dnum(r.start_date), e = r.end_date ? dnum(r.end_date) : Infinity;
      if (!r.end_date && e >= a) open = true;
      const lo = Math.max(oa, s), hi = Math.min(b, e); if (hi < lo) continue;
      rent += (r.monthly_rent || 0) * (hi - lo + 1) / days; rented += hi - lo + 1;
    }
    ownedMonths += owned / days; empty += Math.max(0, owned - rented) / days;
  }
  return { rent, empty, ownedMonths, open };
}
function propertyStats(p) {
  const rows0 = q('SELECT * FROM property_years WHERE property_id=? ORDER BY year', [p.id]);
  const periods = q('SELECT * FROM rent_periods WHERE property_id=? ORDER BY start_date', [p.id]);
  const owners = Math.max(1, p.owners || 1), share = 1 / owners;
  const invested = (p.purchase_price || 0) + (p.purchase_costs || 0);
  const nowY = new Date().getFullYear();
  /* the years to show: years with costs entered, and years with rent */
  const years = new Set(rows0.map(y => y.year));
  for (const r of periods) {
    const y0 = +r.start_date.slice(0, 4), y1 = r.end_date ? +r.end_date.slice(0, 4) : nowY;
    for (let y = y0; y <= Math.min(y1, nowY); y++) years.add(y);
  }
  let prev = p.purchase_price || 0, sumNet = 0;
  const rows = Array.from(years).sort((a, b) => a - b).map(year => {
    const y = rows0.find(r => r.year === year) || { year, rent: 0, id: null };
    const rr = rentForYear(p, periods, year);
    const rent = rr.rent + (y.rent || 0), costs = yearCosts(y), net = rent - costs;
    const valChange = y.value_end == null ? null : y.value_end - prev;
    if (y.value_end != null) prev = y.value_end;
    sumNet += net;
    return { y, year, rent, periodRent: rr.rent, empty: rr.empty, expected: year === nowY && rr.open, noCosts: !y.id,
      costs, net, cash: invested ? net / invested : null, valChange,
      total: valChange == null || !invested ? null : (net + valChange) / invested };
  });
  const value = p.current_value != null ? p.current_value : prev;
  const valueGain = value - (p.purchase_price || 0);
  const gain = sumNet + valueGain - (p.purchase_costs || 0);
  const overall = invested ? gain / invested : null;
  let yearsHeld = null, annual = null;
  if (p.purchase_date) { yearsHeld = (Date.now() - new Date(p.purchase_date)) / (365.25 * 864e5); if (yearsHeld >= 1 && overall > -1) annual = Math.pow(1 + overall, 1 / yearsHeld) - 1; }
  const done = rows.filter(r => !r.expected), last = done.length ? done[done.length - 1] : rows.length ? rows[rows.length - 1] : null;
  return { rows, periods, owners, share, invested, value, valueGain, sumNet, gain, overall, annual, yearsHeld, last,
    avgCash: done.length ? done.reduce((s, r) => s + (r.cash || 0), 0) / done.length : null };
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
let updating = false;
async function updatePrices(quiet) {
  if (updating) return; updating = true;
  const btn = document.getElementById('refresh'); btn.classList.add('spin');
  const now = new Date().toISOString(); let ok = 0, fail = [];
  try {
    for (const m of METALS) {
      const r = await native('httpGet', { url: 'https://api.gold-api.com/price/' + m.sym });
      try {
        const d = JSON.parse(r.body || ''); const p = Number(d.price);
        if (r.status === 200 && p > 0) {
          run('INSERT INTO prices(symbol,price,currency,updated,source) VALUES(?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, currency=excluded.currency, updated=excluded.updated, source=excluded.source',
            [m.sym, p, d.currency || 'USD', now, 'gold-api.com']); ok++;
          if ((d.currency || 'USD') === 'USD') run('INSERT OR REPLACE INTO price_history(symbol,date,price,source) VALUES(?,?,?,?)', [m.sym, now.slice(0, 10), p, 'gold-api.com']);
        } else fail.push(m.name);
      } catch (e) { fail.push(m.name); }
    }
    let rates = null, src = '';
    const ecb = await native('httpGet', { url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml' });
    if (ecb.status === 200 && ecb.body) {
      rates = {}; const re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g; let m;
      while ((m = re.exec(ecb.body))) rates[m[1]] = Number(m[2]);
      if (!Object.keys(rates).length) rates = null; else src = 'European Central Bank';
    }
    if (!rates) {
      const fr = await native('httpGet', { url: 'https://api.frankfurter.dev/v1/latest' });
      try { const d = JSON.parse(fr.body || ''); if (d.rates) { rates = d.rates; src = 'Frankfurter (ECB data)'; } } catch (e) { /* none */ }
    }
    if (rates) { for (const [c, v] of Object.entries(rates)) if (v > 0)
      { run('INSERT INTO fx(currency,per_eur,updated,source) VALUES(?,?,?,?) ON CONFLICT(currency) DO UPDATE SET per_eur=excluded.per_eur, updated=excluded.updated, source=excluded.source', [c, v, now, src]);
        run('INSERT OR REPLACE INTO fx_history(currency,date,per_eur) VALUES(?,?,?)', [c, now.slice(0, 10), v]); } }
    else fail.push('exchange rates');
    if (ok || rates) { setSetting('prices_updated', now); loadFx(); save(); }
    if (!quiet || fail.length) toast(fail.length ? (ok || rates ? 'Updated, except ' + fail.join(', ') : 'No connection: prices not updated') : 'Prices updated');
  } finally { updating = false; btn.classList.remove('spin'); clearHist(); render(); }
  if (!getSetting('history_loaded') && getSetting('auto_prices', '1') === '1') loadHistory(true);
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
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  document.getElementById('settings').classList.toggle('on', state.tab === 'more');
  if (state.tab === 'overview') renderOverview();
  else if (state.tab === 'metals') renderMetals();
  else if (state.tab === 'property') state.propertyId ? renderProperty(state.propertyId) : renderProperties();
  else if (state.tab === 'accounts') state.accountId ? renderAccount(state.accountId) : renderAccounts();
  else if (state.tab === 'assets') state.assetId ? renderAsset(state.assetId) : renderAssets();
  else renderMore();
}
function priceStrip() {
  const H = mcur();
  const cells = METALS.map(m => { const p = spotIn(m.sym, H);
    return `<div class="price"><div class="m">${m.name} / oz</div><div class="p">${p == null ? '—' : money(p, H)}</div></div>`; }).join('');
  return `<div class="prices">${cells}</div><div class="sub" style="margin-top:8px">Prices updated ${when(getSetting('prices_updated'))}</div>`;
}
function missingWarn() {
  if (Object.keys(FX).length > 1) return '';
  return `<div class="warn">No exchange rates yet. Press <b>↻</b> (top right) when you are online, or enter rates under Settings (⚙) › Prices.</div>`;
}
function renderOverview() {
  setTitle('KJT Invest');
  const t = totals(), H = home();
  const nAll = ['metal_holdings', 'properties', 'accounts', 'other_assets'].reduce((n, tb) => n + q(`SELECT COUNT(*) n FROM ${tb}`)[0].n, 0);
  let h = missingWarn() + heroHtml(t);
  if (!nAll) {
    h += `<div class="card"><h2>Welcome</h2><p class="sub">Add what you own. Everything stays on this device, in one file you can export at any time.</p>
      <div class="btns"><button class="btn" data-act="add-metal">Add precious metal</button><button class="btn" data-act="add-property">Add property</button><button class="btn" data-act="add-account">Add bank account</button><button class="btn" data-act="add-asset">Add other asset</button></div></div>`;
  }
  const M = mcur(), mGain = t.metalsM - t.metalsCostM;
  h += `<div class="card tap" data-go="metals"><div class="phead"><span class="pbadge">${metalIcon('XAU', 'bar', 28)}</span><h2 style="margin:0">Precious metals${M !== H ? ' (' + M + ')' : ''}</h2></div>
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
  h += `<div class="card"><h2>Market prices (${mcur()})</h2>${priceStrip()}</div>`;
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
  let h = `<div class="card hero"><div class="label">Other assets (${H})</div><div class="big">${whole(total, H)}</div>
    ${paid ? `<div class="sub">Paid ${whole(paid, H)} · <span class="${signCls(total - paid)}">${pct(total / paid - 1)}</span></div>` : ''}</div>`;
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
    const an = [[p.purchase_date || '0000-01-01', p.purchase_price || 0]];
    for (const r of st.rows) if (r.y.value_end != null) an.push([r.year + '-12-31', r.y.value_end]);
    if (p.current_value != null) an.push([now, p.current_value]);
    an.sort((a, b) => a[0] < b[0] ? -1 : 1);
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
function bindHero() {
  const s = document.getElementById('heroS'); if (!s) return;
  s.scrollLeft = (state.hpage || 0) * s.clientWidth;
  s.addEventListener('scroll', () => { const i = Math.round(s.scrollLeft / s.clientWidth); if (i !== state.hpage) { state.hpage = i;
    s.parentNode.querySelectorAll('.hdots button').forEach((b, j) => b.classList.toggle('on', j === i)); } }, { passive: true });
}

/* ---------------- price history chart ---------------- */
const RANGES = [['1M', 31], ['6M', 183], ['1Y', 366], ['5Y', 1827], ['20Y', 7305], ['All', 0]];
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
      ${lineChart('metals', pts, two, M, state.range === '1M' || state.range === '6M', ['Value', 'Paid (fees included)'])}
      <p class="sub" style="margin:6px 0 0">${state.range === '1M' || state.range === '6M' ? 'Daily prices are kept from the day you started the app; older years are monthly.' : 'Monthly prices for past years; daily since you started using the app.'}</p>`;
  }
  return `<div class="card"><div class="segs">${tabs}</div><div class="segs">${ranges}</div>${body}</div>`;
}
function renderMetals() {
  setTitle('Precious metals');
  const H = mcur(), hs = q("SELECT * FROM metal_holdings ORDER BY metal, COALESCE(purchase_date,'') DESC, description");
  let h = missingWarn() + `<div class="card">${priceStrip()}</div>` + chartCard();
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
  view().innerHTML = h; bindChart();
}
function renderProperties() {
  setTitle('Real estate');
  const ps = q('SELECT * FROM properties ORDER BY name');
  let h = missingWarn();
  if (!ps.length) h += `<div class="card empty">No properties yet.</div>`;
  for (const p of ps) {
    const s = propertyStats(p), c = p.currency || home(), k = s.share;
    h += `<div class="card tap" data-prop="${p.id}"><div class="phead"><span class="pbadge">${propIcon(p.type)}</span><div><h3>${esc(p.name)}</h3>
      <div class="sub">${(PROP_TYPES[p.type] || PROP_TYPES.house)[0]}${p.address ? ' · ' + esc(p.address) : ''}${s.owners > 1 ? ' · your share 1/' + s.owners : ''}</div></div></div>
      <div class="grid2" style="margin-top:10px">
        <div class="stat"><div class="k">Value${s.owners > 1 ? ' (your share)' : ''}</div><div class="v">${whole(s.value * k, c)}</div></div>
        <div class="stat"><div class="k">Invested${s.owners > 1 ? ' (your share)' : ''}</div><div class="v">${whole(s.invested * k, c)}</div></div>
        <div class="stat"><div class="k">${s.last ? 'Cash return ' + s.last.year : 'Cash return'}</div><div class="v ${signCls(s.last && s.last.cash)}">${s.last ? pct(s.last.cash) : '—'}</div></div>
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
  let h = `<div class="card"><div class="phead"><span class="pbadge">${propIcon(p.type)}</span><div><h3>${(PROP_TYPES[p.type] || PROP_TYPES.house)[0]}</h3>${p.address ? `<div class="sub">${esc(p.address)}</div>` : ''}</div></div>${s.owners > 1 ? `<div class="note">Owned by ${s.owners} people: amounts show your share (1/${s.owners}). Whole property value ${whole(s.value, c)}.</div>` : ''}
    <div class="row strong"><span class="k">Value (your estimate)</span><span class="v">${sh(s.value)}</span></div>
    <div class="row"><span class="k">Purchase price</span><span class="v">${sh(p.purchase_price)}</span></div>
    ${p.purchase_costs ? `<div class="row"><span class="k">Purchase costs</span><span class="v">${sh(p.purchase_costs)}</span></div>` : ''}
    <div class="row"><span class="k">Value gain</span><span class="v ${signCls(s.valueGain)}">${sh(s.valueGain)}</span></div>
    <div class="row"><span class="k">Net income, all years</span><span class="v ${signCls(s.sumNet)}">${sh(s.sumNet)}</span></div>
    <div class="row strong"><span class="k">Total return</span><span class="v ${signCls(s.gain)}">${sh(s.gain)} (${pct(s.overall)})</span></div>
    ${s.annual != null ? `<div class="row"><span class="k">Per year, on average</span><span class="v ${signCls(s.annual)}">${pct(s.annual)}</span></div>` : ''}
    ${s.avgCash != null ? `<div class="row"><span class="k">Average cash return</span><span class="v ${signCls(s.avgCash)}">${pct(s.avgCash)}</span></div>` : ''}
    ${p.purchase_date ? `<div class="sub" style="margin-top:6px">Bought ${fmtDate(p.purchase_date)}${c !== home() ? ' · amounts in ' + c : ''}</div>` : ''}
    <div class="btns"><button class="btn light" data-act="edit-property" data-id="${p.id}">Edit</button><button class="btn light" data-act="dup-property" data-id="${p.id}">Duplicate</button></div></div>`;
  /* rent periods */
  h += `<div class="card"><h2>Rent</h2>`;
  if (!s.periods.length) h += `<p class="sub">Add each rental: from when, to when (leave the end empty while it is still rented) and the monthly rent. Months without rent show as empty.</p>`;
  else h += `<div class="txns">` + s.periods.slice().reverse().map(r => `<div class="txn" data-rent="${r.id}">
      <div class="txn-top"><span class="txn-date">${fmtDate(r.start_date)} – ${r.end_date ? fmtDate(r.end_date) : 'still rented'}</span><span class="txn-desc">${esc(r.tenant || 'Rental')}</span></div>
      <div class="txn-body"><div class="sub">${money(r.monthly_rent, c, { dec: 0 })} a month${s.owners > 1 ? ' (whole property)' : ''}</div></div></div>`).join('') + `</div>`;
  h += `<button class="btn wide light" data-act="add-rent" data-id="${p.id}">+ Add rent period</button></div>`;
  /* year by year */
  h += `<div class="card"><h2>Year by year</h2>`;
  if (!s.rows.length) h += `<p class="sub">Add rent periods and each year's costs to see the real return.</p>`;
  else {
    h += `<table class="years"><tr><th>Year</th><th>Rent</th><th>Net</th><th>Cash</th><th>Total</th></tr>`;
    for (const r of s.rows.slice().reverse())
      h += `<tr class="tap" data-year="${r.y.id || ''}" data-yr="${r.year}"><td><b>${r.year}</b>${r.expected ? '<div class="sub">expected</div>' : ''}${r.empty >= 0.05 ? `<div class="sub warn-t">${r.empty.toFixed(1).replace('.0', '')} mo empty</div>` : ''}${r.noCosts ? '<div class="sub warn-t">no costs yet</div>' : ''}</td>
        <td>${sh(r.rent)}</td><td class="${signCls(r.net)}">${sh(r.net)}</td><td>${pct(r.cash)}</td><td class="${signCls(r.total)}">${pct(r.total)}</td></tr>`;
    h += `</table><p class="sub">Cash = net income ÷ invested. Total also counts that year's value change. Tap a year to enter its costs.</p>`;
  }
  h += `<button class="btn wide light" data-act="add-year" data-id="${p.id}">+ Add year's costs</button></div>`;
  view().innerHTML = h;
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
  h += `<div class="card hero"><div class="label">Total (${H})</div><div class="big">${whole(total, H)}</div>
    ${yearly ? `<div class="sub">About ${whole(yearly, H)} interest a year</div>` : ''}</div>`;
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

function renderMore() {
  setTitle('Settings');
  const H = home(), fxRows = q('SELECT * FROM fx ORDER BY currency');
  let h = `<div class="card"><h2>Settings</h2>
    <label class="f"><span>Home currency (for totals)</span><select id="set-home">${curOptions(H)}</select></label>
    <label class="f"><span>Currency for precious metals</span><select id="set-mcur">${curOptions(mcur())}</select></label>
    <div class="switch"><span>Update prices when the app opens</span><input type="checkbox" id="set-auto"${getSetting('auto_prices', '1') === '1' ? ' checked' : ''}></div></div>`;
  h += `<div class="card"><h2>Prices</h2><p class="sub">Updated ${when(getSetting('prices_updated'))}. Tap one to enter it yourself (the next update replaces it).</p><div class="list">`;
  for (const m of METALS) { const s = spot(m.sym);
    h += `<div class="item" data-price="${m.sym}"><span>${m.name} (per troy oz)</span><span class="r">${s ? money(s.price, s.currency) : '—'}</span></div>`; }
  h += `</div><details class="fold"><summary><h2>Exchange rates</h2><span class="sub">${fxRows.length ? 'Value of 1 ' + H + ' in other currencies' : 'none yet'}</span></summary><div class="list">`;
  const shown = new Set(COMMON_CUR.concat(fxRows.map(r => r.currency)));
  for (const c of Array.from(shown).sort()) { if (c === H) continue;
    const r = conv(1, H, c);
    h += `<div class="item" data-fx="${c}"><span>${c}</span><span class="r">${r == null ? '—' : r.toFixed(4)}</span></div>`; }
  h += `</div></details><div class="btns"><button class="btn" data-act="update">Update now</button></div></div>`;
  const nh = q('SELECT COUNT(*) n, MIN(date) d FROM price_history')[0];
  h += `<div class="card"><h2>Price history</h2><p class="sub">${nh.n ? nh.n.toLocaleString('en-CA') + ' prices kept, from ' + esc(nh.d.slice(0, 4)) + '. Past years are monthly (DataHub); from the first update on, the app keeps each day\'s prices itself.' : 'No price history yet.'}</p>
    <div class="btns"><button class="btn light" data-act="history">${getSetting('history_loaded') ? 'Refresh past prices' : 'Load past prices'}</button></div></div>`;
  h += `<div class="card"><h2>Appearance</h2>
    <div class="f2"><label class="f"><span>Colours</span><select id="set-theme">${[['', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}"${(PREFS.theme || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>Text size</span><select id="set-size">${[['', 'Normal'], ['large', 'Large'], ['larger', 'Larger']].map(([v, l]) => `<option value="${v}"${(PREFS.size || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div></div>
    <div id="sec"></div>`;
  h += `<div class="card"><h2>Your data</h2>
    <p class="sub">Everything is kept in one SQLite database file on this device. Export it to back it up or to move it to another phone or computer; import it there.</p>
    <div class="btns"><button class="btn" data-act="export">Export database</button><button class="btn light" data-act="import">Import database</button></div></div>`;
  h += `<div class="card"><h2>About</h2><p class="sub">KJT Invest ${APP_VERSION}, by Knowing Jesus Today (knowingjesus.today). Open source (GPL-2.0-or-later), no accounts, no analytics, no tracking.
    The app only goes online to update prices: metal prices from gold-api.com, exchange rates from the European Central Bank, past prices from DataHub and Frankfurter. Nothing about you or your holdings is sent.</p></div>`;
  view().innerHTML = h;
  document.getElementById('set-home').onchange = e => { setSetting('home_currency', e.target.value); save(); render(); };
  document.getElementById('set-theme').onchange = e => { PREFS.theme = e.target.value; applyLook(); savePrefs(); };
  document.getElementById('set-size').onchange = e => { PREFS.size = e.target.value; applyLook(); savePrefs(); };
  securityCard().then(html => { const el = document.getElementById('sec'); if (el) { el.outerHTML = html; bindSecurity(); } });
  document.getElementById('set-mcur').onchange = e => { setSetting('metal_currency', e.target.value); save(); render(); };
  document.getElementById('set-auto').onchange = e => { setSetting('auto_prices', e.target.checked ? '1' : '0'); save(); };
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
    ${field('current_value', 'What it is worth today (your estimate)', p.current_value)}
    <label class="f"><span>Number of owners</span><select name="owners">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === (p.owners || 1) ? ' selected' : ''}>${n === 1 ? 'Just me' : n + ' people, equal shares'}</option>`).join('')}</select></label>
    <p class="hint">Enter the whole property's amounts; the app shows your share.</p>
    <label class="f"><span>Notes</span><textarea name="notes">${esc(p.notes)}</textarea></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn danger" data-f="delete">Delete property</button></div>' : ''}`, box => {
    box.onclick = e => { const a = e.target.dataset.f; if (!a) return;
      if (a === 'cancel') return closeSheet();
      if (a === 'delete') { ask('Delete this property and all its years?').then(y => { if (!y) return;
        run('DELETE FROM property_years WHERE property_id=?', [id]); run('DELETE FROM rent_periods WHERE property_id=?', [id]); run('DELETE FROM properties WHERE id=?', [id]);
        state.propertyId = null; save(); closeSheet(); render(); }); return; }
      const d = formData(box), pp = num(d.purchase_price), pc = num(d.purchase_costs), cv = num(d.current_value);
      if (!d.name.trim()) return bad('Give the property a name.');
      if (!(pp > 0)) return bad('Enter the purchase price.');
      if (Number.isNaN(pc) || Number.isNaN(cv)) return bad('Check the amounts.');
      const ty = (box.querySelector('[name=type]:checked') || {}).value || 'house';
      const vals = [d.name.trim(), d.address.trim(), d.currency, d.purchase_date, pp, pc || 0, cv, d.notes.trim(), +d.owners || 1, ty];
      if (id) run('UPDATE properties SET name=?,address=?,currency=?,purchase_date=?,purchase_price=?,purchase_costs=?,current_value=?,notes=?,owners=?,type=? WHERE id=?', vals.concat([id]));
      else { run('INSERT INTO properties(name,address,currency,purchase_date,purchase_price,purchase_costs,current_value,notes,owners,type) VALUES(?,?,?,?,?,?,?,?,?,?)', vals);
        state.propertyId = q('SELECT last_insert_rowid() id')[0].id; state.tab = 'property'; }
      save(); closeSheet(); render(); };
  });
}
function yearForm(propertyId, yearId, presetYear) {
  const p = q('SELECT * FROM properties WHERE id=?', [propertyId])[0]; if (!p) return;
  const used = q('SELECT year FROM property_years WHERE property_id=?', [propertyId]).map(r => r.year);
  let y = yearId ? q('SELECT * FROM property_years WHERE id=?', [yearId])[0] : null;
  if (!y) { let yr = presetYear || new Date().getFullYear(); if (!presetYear) while (used.includes(yr)) yr--; y = { year: yr }; }
  const c = p.currency || home(), periods = q('SELECT * FROM rent_periods WHERE property_id=?', [propertyId]);
  openSheet(`<h2>${esc(p.name)}: ${yearId ? 'edit' : 'add'} year</h2>
    ${field('year', 'Year', y.year, 'inputmode="numeric"')}
    <div class="note" id="rentnote"></div>
    ${field('rent', 'Other income in the year (parking, laundry…), optional', y.rent || '')}
    <p class="hint">Whole-property amounts for the year (${c}).</p>
    ${COSTS.map(([k, l]) => field(k, l, y[k])).join('')}
    ${field('value_end', 'Value at the end of the year (your estimate, optional)', y.value_end)}
    <label class="f"><span>Notes</span><textarea name="notes">${esc(y.notes)}</textarea></label>
    <div class="preview" id="pv"></div>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${yearId ? '<div class="btns"><button class="btn danger" data-f="delete">Delete year</button></div>' : ''}`, box => {
    const invested = (p.purchase_price || 0) + (p.purchase_costs || 0);
    const pv = () => { const d = formData(box); const yy = {}; COSTS.forEach(([k]) => yy[k] = num(d[k]) || 0);
      const yr = parseInt(d.year, 10), rr = yr > 1900 ? rentForYear(p, periods, yr) : { rent: 0, empty: 0 };
      box.querySelector('#rentnote').innerHTML = `Rent from your rent periods: <b>${whole(rr.rent, c)}</b>${rr.empty >= 0.05 ? ` · ${rr.empty.toFixed(1)} months empty` : ''}`;
      const net = rr.rent + (num(d.rent) || 0) - yearCosts(yy);
      box.querySelector('#pv').innerHTML = `Net income <b class="${signCls(net)}">${whole(net, c)}</b> · cash return <b class="${signCls(net)}">${pct(invested ? net / invested : null)}</b>`; };
    box.oninput = pv; pv();
    box.onclick = e => { const a = e.target.dataset.f; if (!a) return;
      if (a === 'cancel') return closeSheet();
      if (a === 'delete') { ask('Delete ' + y.year + '?').then(ok => { if (!ok) return; run('DELETE FROM property_years WHERE id=?', [yearId]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), yr = parseInt(d.year, 10);
      if (!(yr > 1900 && yr < 2200)) return bad('Enter a year, e.g. 2025.');
      if (q('SELECT id FROM property_years WHERE property_id=? AND year=? AND id<>?', [propertyId, yr, yearId || 0]).length) return bad(yr + ' is already there: tap it in the list to edit it.');
      const keys = ['rent'].concat(COSTS.map(x => x[0])).concat(['value_end']); const vals = [];
      for (const k of keys) { const n = num(d[k]); if (Number.isNaN(n)) return bad('Check the amounts.'); vals.push(k === 'value_end' ? n : (n || 0)); }
      if (yearId) run(`UPDATE property_years SET year=?,${keys.map(k => k + '=?').join(',')},notes=? WHERE id=?`, [yr].concat(vals, [d.notes.trim(), yearId]));
      else run(`INSERT INTO property_years(property_id,year,${keys.join(',')},notes) VALUES(?,?,${keys.map(() => '?').join(',')},?)`, [propertyId, yr].concat(vals, [d.notes.trim()]));
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
  ask('Make a copy of "' + p.name + '" with its rent periods and yearly costs? You can then change what differs.', 'Duplicate').then(y => { if (!y) return;
    run('INSERT INTO properties(name,address,currency,purchase_date,purchase_price,purchase_costs,current_value,notes,owners,type) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [p.name + ' (copy)', p.address, p.currency, p.purchase_date, p.purchase_price, p.purchase_costs, p.current_value, p.notes, p.owners || 1, p.type || 'house']);
    const nid = q('SELECT last_insert_rowid() id')[0].id;
    run('INSERT INTO rent_periods(property_id,start_date,end_date,monthly_rent,tenant,notes) SELECT ?,start_date,end_date,monthly_rent,tenant,notes FROM rent_periods WHERE property_id=?', [nid, id]);
    run(`INSERT INTO property_years(property_id,year,rent,${COSTS.map(x => x[0]).join(',')},value_end,notes) SELECT ?,year,rent,${COSTS.map(x => x[0]).join(',')},value_end,notes FROM property_years WHERE property_id=?`, [nid, id]);
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
  if (state.tab === b.dataset.tab) { state.propertyId = null; state.accountId = null; state.assetId = null; }
  state.tab = b.dataset.tab; render(); view().scrollTop = 0; };
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
view().addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-go],[data-metal],[data-prop],[data-year],[data-yr],[data-rent],[data-price],[data-fx],[data-chart],[data-range],[data-acct],[data-bal],[data-asset],[data-aval],[data-hpage],[data-prange]'); if (!el) return;
  const d = el.dataset;
  if (d.chart) { state.chart = d.chart; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.range) { state.range = d.range; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.go) { state.tab = d.go; state.propertyId = null; state.accountId = null; state.assetId = null; render(); view().scrollTop = 0; }
  else if (d.metal) metalForm(+d.metal);
  else if (d.prop) { state.propertyId = +d.prop; render(); view().scrollTop = 0; }
  else if (d.year || d.yr) yearForm(state.propertyId, d.year ? +d.year : null, d.yr ? +d.yr : null);
  else if (d.rent) rentForm(state.propertyId, +d.rent);
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
    case 'edit-asset': assetForm(+d.id); break;
    case 'add-avalue': assetValueForm(+d.id); break;
    case 'pin-on': case 'pin-change': case 'pin-off': securityAction(d.act); break;
    case 'edit-account': accountForm(+d.id); break;
    case 'add-balance': balanceForm(+d.id); break;
    case 'add-year': yearForm(+d.id); break;
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
function applyLook() {
  const de = document.documentElement;
  if (PREFS.theme === 'light' || PREFS.theme === 'dark') de.dataset.theme = PREFS.theme; else delete de.dataset.theme;
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
    const last = getSetting('prices_updated');
    if (getSetting('auto_prices', '1') === '1' && (!last || Date.now() - new Date(last) > 15 * 60000)) updatePrices(true);
  } catch (e) {
    view().innerHTML = `<div class="card"><h2>Could not start</h2><p class="sub">${esc(e && e.message || e)}</p></div>`;
  }
})();
