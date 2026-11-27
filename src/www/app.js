/* KJT Finance 1.31 (Knowing Jesus Today) - one screen code for the Android and Linux apps.
   All data stays in one SQLite file on the device. The only network calls are the
   price updates (metal prices from gold-api.com, exchange rates from the European Central Bank). */
'use strict';

const APP_VERSION = '1.31';
const SCHEMA = 11;
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
const LEAVES_APP = ['exportDb', 'importDb', 'bioUnlock', 'bioEnable', 'print', 'syncPick'];
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
    /* a pretend sync folder in the browser, for testing */
    else if (cmd === 'syncPick') { localStorage.setItem('fs-on', '1'); reply({ ok: true, label: 'Test folder' }); }
    else if (cmd === 'syncInfo') reply({ set: localStorage.getItem('fs-on') === '1', label: 'Test folder' });
    else if (cmd === 'syncForget') { localStorage.removeItem('fs-on'); reply({ ok: true }); }
    else if (cmd === 'syncList') { const files = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('fs:')) { const v = JSON.parse(localStorage.getItem(k)); files.push({ name: k.slice(3), mtime: v.mtime, size: v.b64.length }); } } reply({ files }); }
    else if (cmd === 'syncRead') { const v = localStorage.getItem('fs:' + a.name); reply(v ? { b64: JSON.parse(v).b64 } : { missing: true }); }
    else if (cmd === 'syncWrite') { localStorage.setItem('fs:' + a.name, JSON.stringify({ b64: a.b64, mtime: Date.now() })); reply({ ok: true }); }
    else if (cmd === 'syncDelete') { localStorage.removeItem('fs:' + a.name); reply({ ok: true }); }
    else if (cmd === 'copyText') { try { await navigator.clipboard.writeText(a.text); } catch (e) { } reply({ ok: true }); }
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
  try { if (params) st.bind(params); let cols = null;   /* 1.20: column names once, not once per row */
    while (st.step()) { if (!cols) cols = st.getColumnNames(); const v = st.get(), o = {}; for (let i = 0; i < cols.length; i++) o[cols[i]] = v[i]; out.push(o); } } finally { st.free(); }
  return out;
}
let BALC = {};   /* 1.20: balances worked out once until something changes */
function run(sql, params) { if (!/^\s*(INSERT OR REPLACE INTO|INSERT INTO|UPDATE|DELETE FROM)\s+settings\b/i.test(sql)) BALC = {}; db.run(sql, params || []); }
function bulk(sql, rows) {   /* many rows with one prepared statement, in one transaction */
  BALC = {}; const st = db.prepare(sql); db.exec('BEGIN');
  try { for (const r of rows) { st.run(r); } db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } finally { st.free(); }
}
function getSetting(k, d) { const r = q('SELECT value FROM settings WHERE key=?', [k]); return r.length ? r[0].value : d; }
function setSetting(k, v) { run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, String(v)]); }
function prepareDb() { BALC = {};
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
  /* 1.10: a loan you do not expect back can be written off */
  if (!q('PRAGMA table_info(loans)').some(r => r.name === 'written_off')) run('ALTER TABLE loans ADD COLUMN written_off TEXT');
  /* 1.11: remembered payees (payee -> category, or payee -> transfer to an account, like ATM -> cash in hand) */
  run('CREATE TABLE IF NOT EXISTS payee_rules (id INTEGER PRIMARY KEY, pattern TEXT NOT NULL UNIQUE, category_id INTEGER, to_account_id INTEGER, created INTEGER)');
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
  if (!getSetting('cats_v111')) { if (!q("SELECT id FROM categories WHERE parent_id IS NULL AND name='Cash spending'").length)
    run("INSERT INTO categories(name,parent_id,kind,sort) VALUES('Cash spending',NULL,'out',95)"); setSetting('cats_v111', '1'); clearCats(); }
  /* 1.18: which entries the bank has confirmed (2 = a bank file, 1 = you or MMEX said so); the bank line of a transfer's other side */
  if (!q('PRAGMA table_info(transactions)').some(r => r.name === 'bank_ok')) run('ALTER TABLE transactions ADD COLUMN bank_ok INTEGER');
  if (!q('PRAGMA table_info(transactions)').some(r => r.name === 'import_id2')) { run('ALTER TABLE transactions ADD COLUMN import_id2 TEXT'); run('CREATE INDEX IF NOT EXISTS tx_import2 ON transactions(import_id2)'); }
  if (!getSetting('bank_ok_v118')) { run("UPDATE transactions SET bank_ok=2 WHERE bank_ok IS NULL AND (import_id LIKE 'ref:%' OR import_id LIKE 'h:%')"); setSetting('bank_ok_v118', '1'); }
  /* 1.20: speed: lookups by the receiving account and by balance date use an index */
  run('CREATE INDEX IF NOT EXISTS tx_to ON transactions(to_account_id, date)'); run('CREATE INDEX IF NOT EXISTS bal_acct ON account_balances(account_id, date)');
  run('CREATE INDEX IF NOT EXISTS tx_cat ON transactions(category_id)');
  /* 1.27: a transfer between two currencies keeps what actually arrived (e.g. 10,000 CAD -> 7,220 USD) */
  if (!q('PRAGMA table_info(transactions)').some(r => r.name === 'to_amount')) run('ALTER TABLE transactions ADD COLUMN to_amount REAL');
  /* 1.19: a credit card's expiry month (YYYY-MM) */
  if (!q('PRAGMA table_info(accounts)').some(r => r.name === 'expires')) run('ALTER TABLE accounts ADD COLUMN expires TEXT');
  /* 1.19: an account can be hidden (still counted) or closed */
  if (!q('PRAGMA table_info(accounts)').some(r => r.name === 'status')) { run('ALTER TABLE accounts ADD COLUMN status TEXT'); run("UPDATE accounts SET status='closed' WHERE notes LIKE '%(closed in MMEX)%'"); }
  syncMeta();   /* 1.14: lasting ids, change times and deletion notes, for syncing and merging */
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
  else if (typeof SYNC !== 'undefined' && SYNC.on && !SYNC.busy) syncSoon();
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
/* transactions from your accounts linked to a property join its cashflow */
const PLINK = { linked_out: ['Paid from your accounts', 'cost'], linked_in: ['Received into your accounts', 'income'] };
const pmeta = k => PITEMS[k] || PLINK[k] || PITEMS.other_cost;
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
  /* what you paid or received through your accounts for this property. The property's figures are for the whole
     property and get multiplied by your share, so your own payments are divided by it first. */
  const lk = {};
  for (const t of q("SELECT t.*, a.currency acur FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE t.link=? AND t.kind<>'transfer' AND (t.category_id IS NULL OR t.category_id NOT IN (SELECT id FROM categories WHERE kind='save'))", ['property:' + p.id])) {
    const v = (conv(t.amount, t.acur || home(), p.currency || home()) || 0) / (share || 1), key = t.date.slice(0, 7);
    (lk[key] = lk[key] || { in: 0, out: 0 })[t.kind === 'in' ? 'in' : 'out'] += v; y0 = Math.min(y0, +t.date.slice(0, 4));
  }
  const years = []; let sumNet = 0;
  for (let y = y0; y <= nowY; y++) {
    const months = MONTHS.map((_, m) => { const f = monthFlow(p, periods, items, y, m), L = lk[`${y}-${String(m + 1).padStart(2, '0')}`];
      if (L) { f.costs += L.out; f.income += L.in; if (L.out) f.byKind.linked_out = L.out; if (L.in) f.byKind.linked_in = L.in; f.net = f.rent + f.income - f.costs; }
      return f; });
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
    const v = assetValue(a.id), val = v ? v.value : a.purchase_price; if (val == null) continue; const k = shareOf(a);   /* 1.22: no value entered yet = what you paid */
    const hv = conv(val * k, a.currency || H, H); if (hv == null) { missing = true; continue; }
    other += hv; otherCost += conv((a.purchase_price != null ? a.purchase_price : val) * k, a.currency || H, H) || 0;
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
      return `<span class="sm">${m.name}${sp != null ? `<small>${(sp * 100).toFixed(1)}% apart</small>` : ''}</span>` + METAL_SOURCES.map(s => `<span class="sv">${byS[s.id] ? money(conv(byS[s.id], 'USD', M) * pfactor(), M, { dec: pfactor() < 0.2 ? 2 : 0 }) : '—'}</span>`).join(''); }).join('') + `</div>`;
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
  const a = fxSeries(cur);
  if (!a.length) return FX[cur] || null;
  let lo = 0, hi = a.length - 1, i = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m][0] <= date) { i = m; lo = m + 1; } else hi = m - 1; }
  /* 1.24: the stored rate must be from within 10 days of that date; otherwise (gaps, a currency added lately) today's rate */
  if (i >= 0 && dnum(date) - dnum(a[i][0]) <= 10) return a[i][1];
  if (FX[cur] && (i < 0 ? dnum(a[0][0]) - dnum(date) > 10 : true) && dnum(today()) - dnum(date) <= 400) return FX[cur];
  return i >= 0 ? a[i][1] : a[0][1];
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
let PFROM = {};   /* 1.18: per account, the first day a bank file covered (cleared at each render) */
const view = () => document.getElementById('view');
function setTitle(t, back) {
  document.getElementById('title').textContent = t;
  document.getElementById('back').hidden = !back;
}
/* Menus: Overview · Assets (Accounts, Property, Metals, Loans, Other assets) · Cash flow · Prices (metal prices, currencies) */
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
  payees: () => `<svg class="sico" viewBox="0 0 24 24"><circle class="f" cx="12" cy="8" r="4"/><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`,
  categories: () => `<svg class="sico" viewBox="0 0 24 24"><path class="f" d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8" cy="8" r="1.5"/></svg>`,
};
const subBtn = (k, l, on, attr) => `<button class="${on ? 'on' : ''}" ${attr}="${k}">${SUBICON[k] ? SUBICON[k]() : ''}<span>${l}</span></button>`;
const ASECS = [['accounts', 'Accounts'], ['property', 'Property'], ['metals', 'Metals'], ['loans', 'Loans'], ['assets', 'Other']];
const isAsset = t => ASECS.some(a => a[0] === t);
function render() {
  navBefore(); PFROM = {}; BALC = {};
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
  else if (state.tab === 'recon') renderRecon(state.reconId);
  else if (state.tab === 'stewardship') renderStewardship();
  else renderMore();
  const inDetail = state.propertyId && state.tab === 'property' || state.accountId && state.tab === 'accounts' || state.assetId && state.tab === 'assets' || state.loanId && state.tab === 'loans';
  if (isAsset(state.tab) && !inDetail) {
    setTitle('Assets');
    view().insertAdjacentHTML('afterbegin', `<div class="subnav">${ASECS.map(([k, l]) => subBtn(k, l, k === state.tab, 'data-asec')).join('')}</div>`);
  }
  { const pv = pageVerse(); if (pv) view().insertAdjacentHTML('beforeend', pv); }   /* 1.31 */
  view().dataset.page = state.tab; searchSelects(view());   /* 1.22: each section of Assets has its own colour */
  enhanceView();
  settingsNav();
  markAmounts();
  navAfter();
}
/* "hide amounts" (the eye): find every amount on the page, inside any sentence, and wrap it so it can be blurred.
   Market prices (Prices page) and Settings are left alone: they are not your money. */
const AMT_RE = /[-+\u2212]?\s?(?:[A-Z]{1,3})?[$\u20ac\u00a3\u00a5\u20b9]\s?\d[\d,.\u00a0\u202f]*\d|[-+\u2212]?\s?(?:[A-Z]{1,3})?[$\u20ac\u00a3\u00a5\u20b9]\s?\d|\d[\d,.\u00a0\u202f]*\s?[\u20ac\u00a3]|[-+\u2212]?\d[\d,]*(?:\.\d+)?\s?%|[-+\u2212]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\b\d+\.\d{2}\b/g;
function markAmounts(root) {
  if (['markets', 'currency', 'more', 'stewardship'].includes(state.tab)) return;
  root = root || view(); if (!root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  while (w.nextNode()) { const n = w.currentNode, el = n.parentElement;
    if (!el || el.closest('.amt, input, textarea, select, option, script, style, .nomask')) continue;
    AMT_RE.lastIndex = 0; if (AMT_RE.test(n.textContent)) nodes.push(n); }
  for (const n of nodes) {
    const el = n.parentElement;
    if (el.closest('svg')) { el.classList.add('amt'); continue; }
    const t = n.textContent, f = document.createDocumentFragment(); let i = 0; AMT_RE.lastIndex = 0; let m;
    while ((m = AMT_RE.exec(t))) { if (m.index > i) f.append(t.slice(i, m.index));
      const sp = document.createElement('span'); sp.className = 'amt'; sp.textContent = m[0]; f.append(sp); i = m.index + m[0].length; }
    if (i < t.length) f.append(t.slice(i));
    n.replaceWith(f);
  }
}
/* metal prices in the unit you like: troy ounce (the market's), gram, kilogram, tola, tael */
const PUNITS = { ozt: ['troy ounce', 'oz t', 31.1034768], g: ['gram', 'g', 1], kg: ['kilogram', 'kg', 1000], tola: ['tola', 'tola', 11.6638038], tael: ['tael', 'tael', 37.429], oz: ['ounce (avoirdupois)', 'oz', 28.349523125] };
const punit = () => PUNITS[getSetting('price_unit', 'ozt')] ? getSetting('price_unit', 'ozt') : 'ozt';
const pfactor = () => PUNITS[punit()][2] / 31.1034768;   /* troy-ounce price x this = price per unit */
const pname = () => PUNITS[punit()][0];
function unitSegs() { return `<div class="segs units">${Object.entries(PUNITS).map(([k, [, s]]) => `<button class="seg${punit() === k ? ' on' : ''}" data-punit="${k}">${s}</button>`).join('')}</div>`; }
function priceStrip() {
  const H = mcur();
  const f = pfactor(), u = PUNITS[punit()][1], y = dstr(dnum(today()) - 1);
  const cells = METALS.map(m => { const p = spotIn(m.sym, H), p0 = priceOn(m.sym, y, H), ch = p != null && p0 ? p / p0 - 1 : null;
    return `<div class="price">${metalIcon(m.sym, 'bar', 22)}<div class="m">${m.name} / ${u}</div><div class="p">${p == null ? '—' : money(p * f, H, f < 0.2 ? { dec: 2 } : undefined)}</div>${ch != null && Math.abs(ch) > 0.00005 ? `<div class="pc ${signCls(ch)}">${ch > 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(2)}%</div>` : ''}</div>`; }).join('');
  return `<div class="prices">${cells}</div><div class="sub" style="margin-top:8px">Prices updated ${when(getSetting('prices_updated'))}</div>`;
}
function missingWarn() {
  if (Object.keys(FX).length > 1) return '';
  const H = home(), other = q('SELECT COUNT(*) n FROM metal_holdings')[0].n + ['properties', 'accounts', 'other_assets'].reduce((n, tb) => n + q(`SELECT COUNT(*) n FROM ${tb} WHERE currency IS NOT NULL AND currency <> ?`, [H])[0].n, 0);
  if (!other) return '';
  return `<div class="warn">No exchange rates yet. Press <b>↻</b> (top right) when you are online, or enter rates under Settings (⚙) › Prices.</div>`;
}
function renderOverview() {
  setTitle('KJT Finance');
  const t = totals(), H = home();
  const nAll = ['metal_holdings', 'properties', 'accounts', 'other_assets', 'loans'].reduce((n, tb) => n + q(`SELECT COUNT(*) n FROM ${tb}`)[0].n, 0);
  let h = missingWarn() + dailyCard() + `<h2 class="sect" data-ftot="${esc(whole(t.total, H))}">Summary</h2>` + summaryHtml(t);
  if (!nAll) {
    h += `<div class="card"><h2>Welcome</h2><p class="sub">Add what you own. Everything stays on this device, in one file you can export at any time.</p>
      <div class="btns"><button class="btn" data-act="add-metal">Add precious metal</button><button class="btn" data-act="add-property">Add property</button><button class="btn" data-act="add-account">Add bank account</button><button class="btn" data-act="add-asset">Add other asset</button></div>
      <div class="btns"><button class="btn light" data-act="mmex-import">Bring my data from MMEX</button><button class="btn light" data-act="merge-file">From my other device (file)</button></div>${moodVerse('start')}</div>`;
  }
  const M = mcur(), mGain = t.metalsM - t.metalsCostM;
  h += remindersCard();
  if (q('SELECT COUNT(*) n FROM transactions')[0].n) h += monthCard();
  const cards = {};
  cards.metals = `<div class="card tap ocard${cardFolded('metals') ? ' folded' : ''}" data-go="metals"><div class="phead"><span class="pbadge">${metalIcon('XAU', 'bar', 28)}</span><h2 style="margin:0">Precious metals${M !== H ? ' (' + M + ')' : ''}</h2>${foldBits('metals', whole(t.metals, H))}</div>
    <div class="row strong"><span class="k">Value</span><span class="v">${whole(t.metalsM, M)}</span></div>
    <div class="row"><span class="k">Paid (fees included)</span><span class="v">${whole(t.metalsCostM, M)}</span></div>
    <div class="row"><span class="k">Gain</span><span class="v ${signCls(mGain)}">${whole(mGain, M)} ${t.metalsCostM ? '(' + pct(mGain / t.metalsCostM) + ')' : ''}</span></div>
    ${M !== H ? `<div class="row"><span class="k">Value in ${H}</span><span class="v">${whole(t.metals, H)}</span></div>` : ''}</div>`;
  const reGain = t.re - t.reInvested + t.reIncome;
  cards.property = `<div class="card tap ocard${cardFolded('property') ? ' folded' : ''}" data-go="property"><div class="phead"><span class="pbadge">${propIcon('house')}</span><h2 style="margin:0">Real estate</h2>${foldBits('property', whole(t.re, H))}</div>
    <div class="row strong"><span class="k">Value (your estimate)</span><span class="v">${whole(t.re, H)}</span></div>
    <div class="row"><span class="k">Invested</span><span class="v">${whole(t.reInvested, H)}</span></div>
    ${t.reLastYear ? `<div class="row"><span class="k">Net income ${t.reLastYear}</span><span class="v ${signCls(t.reLastNet)}">${whole(t.reLastNet, H)}</span></div>` : ''}
    <div class="row"><span class="k">Total gain (value + income)</span><span class="v ${signCls(reGain)}">${whole(reGain, H)} ${t.reInvested ? '(' + pct(reGain / t.reInvested) + ')' : ''}</span></div></div>`;
  cards.accounts = `<div class="card tap ocard${cardFolded('accounts') ? ' folded' : ''}" data-go="accounts"><div class="phead"><span class="pbadge"><svg class="picon" viewBox="0 0 24 24" width="26" height="26"><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l13-3v3M16 13.5h2"/></svg></span><h2 style="margin:0">Cash & bank accounts</h2>${foldBits('accounts', whole(t.cash, H))}</div>
    <div class="row strong"><span class="k">Balance${t.debt > 0.005 ? ' (less credit cards)' : ''}</span><span class="v ${t.cash < 0 ? 'down' : ''}">${whole(t.cash, H)}</span></div>
    ${t.debt > 0.005 ? `<div class="row"><span class="k">Owed on credit cards</span><span class="v down">${whole(t.debt, H)}</span></div>` : ''}</div>`;
  cards.assets = `<div class="card tap ocard${cardFolded('assets') ? ' folded' : ''}" data-go="assets"><div class="phead"><span class="pbadge">${assetIcon('car')}</span><h2 style="margin:0">Other assets</h2>${foldBits('assets', whole(t.other, H))}</div>
    <div class="row strong"><span class="k">Value (your estimate)</span><span class="v">${whole(t.other, H)}</span></div>
    ${t.otherCost ? `<div class="row"><span class="k">Paid</span><span class="v">${whole(t.otherCost, H)}</span></div>` : ''}</div>`;
  if (q('SELECT COUNT(*) n FROM loans')[0].n) cards.loans = `<div class="card tap ocard${cardFolded('loans') ? ' folded' : ''}" data-go="loans"><div class="phead"><span class="pbadge">${loanIcon()}</span><h2 style="margin:0">Loans you made</h2>${foldBits('loans', whole(t.loans, H))}</div>
    <div class="row strong"><span class="k">Owed to you</span><span class="v">${whole(t.loans, H)}</span></div></div>`;
  /* in the same order as the Assets menu */
  h += `<h2 class="sect" data-ftot="${esc(whole(t.total, H))}">What you own</h2>` + ['accounts', 'property', 'metals', 'loans', 'assets'].map(k => cards[k] || '').join('');
  const ie12 = ieRange(ieModel(), 'L12');
  h += `<h2 class="sect" data-ftot="${esc((ie12.net >= 0 ? '+' : '') + whole(ie12.net, H))} net, 12 months">Income & expenses</h2>` + ieCard();
  h += `<h2 class="sect">Current prices <span class="sub">${mcur()} per ${pname()}</span></h2><div class="card tap" data-go="markets">${priceStrip()}</div>`;
  if (nAll) h += `<button class="btn wide light" data-act="print-report">Print the report or save it as a PDF</button>`;
  view().innerHTML = h; bindChart();
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
function assetValue(id) {   /* its latest value; 1.22: with none entered yet, what you paid for it (everywhere the same) */
  const r = q('SELECT * FROM asset_values WHERE asset_id=? ORDER BY date DESC, id DESC LIMIT 1', [id]); if (r[0]) return r[0];
  const a = q('SELECT purchase_price, purchase_date FROM other_assets WHERE id=?', [id])[0];
  return a && a.purchase_price != null ? { value: a.purchase_price, date: a.purchase_date, note: 'price paid', paid: true } : null;
}

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
  /* 1.30: summary, by kind */
  const byT = {}; for (const a of as) { const v = assetValue(a.id), c = a.currency || H, k = shareOf(a), hv = conv(v ? v.value * k : null, c, H); if (hv == null) continue; const t = byT[a.type || 'other'] = byT[a.type || 'other'] || { v: 0, c: 0, n: 0 }; t.v += hv; t.c += conv(a.purchase_price != null ? a.purchase_price * k : null, c, H) || 0; t.n++; }
  let h = as.length ? secSummary({ label: `Other assets (${H})`, big: whole(total, H), sub: [`${as.length} asset${as.length === 1 ? '' : 's'}`],
    stats: [['Paid', whole(paid, H)], ['Up or down', sgnW(total - paid, H), signCls(total - paid)], ['Change', paid ? pct(total / paid - 1) : '—', signCls(total - paid)]],
    rows: Object.entries(byT).sort((a, b) => b[1].v - a[1].v).map(([t, x]) => [`${(ASSET_TYPES[t] || ASSET_TYPES.other)[0]} <small class="sub">${x.n}</small>`, whole(x.v, H), '', x.c ? `paid ${whole(x.c, H)} · <span class="${signCls(x.v - x.c)}">${pct(x.v / x.c - 1)}</span>` : '']),
    foot: ['Values you have not updated count at what you paid. Open an asset to add today\'s value.'] }) : '';
  h += `<h2 class="sect">Your assets</h2>`;
  h += as.length ? `<div class="card"><div class="txns" style="margin-top:0">${body}</div></div>` : `<div class="card empty">No other assets yet: cars, boats, trailers, jewellery, art, collections, equipment…</div>`;
  h += `<button class="btn wide" data-act="add-asset">+ Add asset</button><button class="btn wide light" data-act="match-buys">Find these purchases in your accounts</button>`;
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
function worthModel() { return BALC.__wm || (BALC.__wm = worthModel0()); }   /* 1.22: built once until something changes */
function worthModel0() {
  const H = home(), now = today(), items = [];
  for (const h of q('SELECT * FROM metal_holdings')) { const s = holdingStats(h);
    items.push({ kind: 'm', from: h.purchase_date || '0000', at: d => { const p = d >= now ? spotIn(h.metal, H) : priceOn(h.metal, d, H); return p == null ? null : s.oz * p; },
      fallback: () => { const p = spotIn(h.metal, H); return p == null ? null : s.oz * p; },
      paid: d => convOn(s.cost || 0, h.currency || H, H, h.purchase_date || d) }); }
  for (const p of q('SELECT * FROM properties')) { const st = propertyStats(p), k = st.share, c = p.currency || H;
    const an = st.anchors;
    items.push({ kind: 'p', from: p.purchase_date || '0000', at: d => convOn(interp(an, d) * k, c, H, d), paid: d => convOn(st.invested * k, c, H, p.purchase_date || d) }); }
  for (const a of q('SELECT * FROM accounts')) { const k = shareOf(a), c = a.currency || H;
    const f1 = q('SELECT MIN(date) d FROM account_balances WHERE account_id=?', [a.id])[0].d, f2 = q('SELECT MIN(date) d FROM transactions WHERE account_id=? OR to_account_id=?', [a.id, a.id])[0].d;
    const from = [f1, f2].filter(Boolean).sort()[0]; if (!from) continue;
    const bf = balanceFn(a); items.push({ kind: 'c', from, at: d => { const b = bf(d); return b == null ? 0 : (c === H ? b * k : convOn(b * k, c, H, d)); }, paid: null }); }
  for (const l of q('SELECT * FROM loans')) { const c = l.currency || H;
    items.push({ kind: 'l', from: l.date, at: d => convOn(loanStats(l, d).owed, c, H, d), paid: d => convOn(loanStats(l, d).owed, c, H, d) }); }
  for (const a of q('SELECT * FROM other_assets')) { const k = shareOf(a), c = a.currency || H;
    const an = q('SELECT date, value FROM asset_values WHERE asset_id=? ORDER BY date, id', [a.id]).map(r => [r.date, r.value]);
    if (a.purchase_date && a.purchase_price != null && (!an.length || an[0][0] > a.purchase_date)) an.unshift([a.purchase_date, a.purchase_price]);
    if (!an.length) continue;
    items.push({ kind: 'o', from: an[0][0], at: d => convOn(interp(an, d) * k, c, H, d), paid: d => convOn((a.purchase_price != null ? a.purchase_price : an[0][1]) * k, c, H, an[0][0]) }); }
  return items;
}
/* 1.24: the change between two days, explained: money in and out, bank balance updates (when a balance from the bank
   replaces the running total), currency changes, prices, purchases. Every part comes from the same numbers. */
function changeAudit(d1) {
  const H = home(), d0 = today(), rows = [], acct = [];
  let flow = 0, jump = 0, fx = 0, a1 = 0, a0 = 0;
  for (const a of q('SELECT * FROM accounts')) {
    const c = a.currency || H, k = shareOf(a), bf = balanceFn(a), b1 = bf(d1), b0 = bf(d0); if (b1 == null && b0 == null) continue;
    const txs = q('SELECT * FROM transactions WHERE (account_id=? OR to_account_id=?) AND date>? AND date<=?', [a.id, a.id, d1, d0]);
    const cc = (cats().rows.find(x => !x.parent_id && x.name === 'Balance corrections') || {}).id;
    let f = 0; for (const t of txs) if (!(cc && t.category_id === cc)) f += txEffect(t, a.id, c);   /* corrections are balance updates, not money */
    const j = ((b0 || 0) - (b1 || 0)) - f;
    const v1 = c === H ? (b1 || 0) * k : convOn((b1 || 0) * k, c, H, d1) || 0, v0 = c === H ? (b0 || 0) * k : conv((b0 || 0) * k, c, H) || 0;
    const fH = c === H ? f * k : conv(f * k, c, H) || 0, jH = c === H ? j * k : conv(j * k, c, H) || 0, xH = v0 - v1 - fH - jH;
    flow += fH; jump += jH; fx += xH; a1 += v1; a0 += v0;
    const checks = q('SELECT date, balance FROM account_balances WHERE account_id=? AND date>? AND date<=? ORDER BY date', [a.id, d1, d0]);
    acct.push({ a, v1, v0, fH, jH, xH, n: txs.length, checks });
  }
  const items = worthModel(), by = k => items.filter(it => it.kind === k);
  const part = k => { let v1 = 0, v0 = 0, bought = 0; for (const it of by(k)) { const x0 = it.at(d0) ?? (it.fallback ? it.fallback() : null) ?? 0;
      if (it.from > d1) { bought += x0; v0 += x0; continue; } let x1 = it.at(d1); if (x1 == null && it.fallback) x1 = it.fallback(); v1 += x1 || 0; v0 += x0; } return { v1, v0, bought }; };
  const m = part('m'), p = part('p'), l = part('l'), o = part('o');
  rows.push(['Money in and out of your accounts', flow, 'cash flow: what you received and paid (transfers between your accounts cancel out)']);
  rows.push(['Bank balance updates', jump, 'a balance from the bank (or a cash count) replaced the running total: the difference was already there before; see Reconcile']);
  rows.push(['Exchange rates (accounts)', fx, 'the same money in another currency, worth more or less in ' + H]);
  rows.push(['Metals: new purchases', m.bought, 'bought in this time']);
  rows.push(['Metals: price change', m.v0 - m.v1 - m.bought, 'what you held before, at today\'s price']);
  rows.push(['Property: value', p.v0 - p.v1 - p.bought, 'your estimates, drawn as a straight line between dates']);
  rows.push(['Property: new', p.bought, '']);
  rows.push(['Other assets', o.v0 - o.v1, 'new ones and new values']);
  rows.push(['Loans you made', l.v0 - l.v1, 'lent or repaid']);
  const total = rows.reduce((x, r) => x + r[1], 0);
  return { d1, d0, rows: rows.filter(r => Math.abs(r[1]) >= 0.5), total, acct: acct.filter(x => Math.abs(x.fH) + Math.abs(x.jH) + Math.abs(x.xH) >= 0.5).sort((x, y) => Math.abs(y.jH) - Math.abs(x.jH)) };
}
function changeSheet() {
  const H = home(), A = changeAudit(dstr(dnum(today()) - 30)), sg = v => (v >= 0 ? '+' : '−') + whole(Math.abs(v), H);
  openSheet(`<h2>How the change since ${fmtDate(A.d1)} is worked out</h2>
    <div class="alloc">${A.rows.map(([l, v, why]) => `<div class="arow ie"><span class="al">${esc(l)}${why ? `<span class="sub"><br>${esc(why)}</span>` : ''}</span><span class="av ${signCls(v)}">${sg(v)}</span><span class="ap"></span></div>`).join('')}
      <div class="arow ie tot"><span class="al"><b>Total</b></span><span class="av ${signCls(A.total)}"><b>${sg(A.total)}</b></span><span class="ap"></span></div></div>
    ${A.acct.length ? `<h3 class="ieh">Account by account</h3><div class="txlist">${A.acct.map(x => `<div class="txrow" data-acct="${x.a.id}"><div class="txl"><div class="txt">${esc(x.a.name)} <small class="sub">${esc(x.a.currency || H)}</small></div>
      <div class="sub">${x.n} transaction${x.n === 1 ? '' : 's'} ${sg(x.fH)}${Math.abs(x.jH) >= 0.5 ? ` · <b class="${signCls(x.jH)}">bank balance update ${sg(x.jH)}</b>${x.checks.length ? ' (' + x.checks.map(c => fmtDate(c.date)).slice(-3).join(', ') + ')' : ''}` : ''}${Math.abs(x.xH) >= 0.5 ? ` · exchange rate ${sg(x.xH)}` : ''}</div></div>
      <div class="txa">${whole(x.v1, H)} → ${whole(x.v0, H)}</div></div>`).join('')}</div>` : ''}
    <p class="hint">A large bank balance update means your transactions before that date did not add up to what the bank showed. Open the account's Reconcile page to find the month.</p>
    <div class="btns"><button class="btn light" data-f="recon">Open Reconcile</button><button class="btn light" data-f="cancel">Close</button></div>`, box => {
    box.onclick = e => { const r = e.target.closest('[data-acct]'); if (r) { closeSheet(); navRoot(); state.tab = 'recon'; state.reconId = +r.dataset.acct; render(); return; }
      const f = e.target.dataset.f; if (f === 'cancel') closeSheet(); if (f === 'recon') { closeSheet(); state.tab = 'recon'; state.reconId = null; render(); } };
  });
}
/* 1.22: what everything was worth on one day, by kind, valued the same way as today (a missing old price uses today's) */
function worthAt(d, items) {
  const by = { c: 0, m: 0, p: 0, l: 0, o: 0 };
  for (const it of items || worthModel()) { if (it.from > d) continue; let x = it.at(d); if (x == null && it.fallback) x = it.fallback(); if (x != null && !Number.isNaN(x)) by[it.kind] += x; }
  return by;
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
      markAmounts(tip); tip.hidden = false; const left = X / c.geo.W * r.width; tip.style.left = Math.min(Math.max(left - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth) + 'px';
    };
    const hide = () => { tip.hidden = true; svg.querySelectorAll('.xh,.dot1,.dot2').forEach(el => el.setAttribute('visibility', 'hidden')); };
    const hit = svg.querySelector('.hit');
    hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show); hit.addEventListener('pointerleave', hide);
  });
}

/* ---------------- overview: the top box has pages you swipe ---------------- */
const CATS = [['cash', 'Cash & bank', 'cat-c'], ['re', 'Real estate', 'cat-p'], ['metals', 'Precious metals', 'cat-m'], ['loans', 'Loans you made', 'cat-l'], ['other', 'Other assets', 'cat-o']];
function heroPages(t) {
  const H = home(), parts = { metals: t.metals, re: t.re, cash: Math.max(0, t.cash), other: t.other, loans: t.loans || 0 };
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
  /* 1.22: the change over exactly 30 days, both days valued the same way, and where it came from */
  const items = worthModel(), d30 = dstr(dnum(today()) - 30), AU = items.some(it => it.from <= d30) ? changeAudit(d30) : null;
  /* the headline is the real change; a bank balance update (an old difference coming to light) is shown on its own line */
  const jump30 = AU ? (AU.rows.find(r => r[0] === 'Bank balance updates') || [0, 0])[1] : 0;
  const ch30 = AU ? AU.total - jump30 : null, parts30 = AU ? AU.rows.filter(r => r[0] !== 'Bank balance updates' && Math.abs(r[1]) >= 1).slice(0, 4) : [];
  return [
    `<div class="label">Total value (${H})</div><div class="big">${whole(t.total, H)}</div>
      ${ch30 != null ? `<div class="sub"><span class="${signCls(ch30)}">${ch30 >= 0 ? '+' : ''}${whole(ch30, H)}</span> since ${fmtDate(d30)}</div>
        ${Math.abs(jump30) >= 1 ? `<div class="sub small tap" data-act="why-change">Bank balance updates <span class="${signCls(jump30)}">${jump30 >= 0 ? '+' : '−'}${whole(Math.abs(jump30), H)}</span> not included: your earlier entries did not match the bank (see Reconcile) <span class="chev">›</span></div>` : ''}
        ${parts30.length ? `<div class="sub small tap" data-act="why-change">${parts30.map(([l, v]) => `${esc(l.replace('Money in and out of your accounts', 'money in/out').replace('Bank balance updates', 'bank balance updates').replace('Exchange rates (accounts)', 'exchange rates').toLowerCase())} <span class="${signCls(v)}">${v >= 0 ? '+' : '−'}${whole(Math.abs(v), H)}</span>`).join(' · ')} <span class="chev">›</span></div>` : ''}` : ''}
      ${totalPaid ? `<div class="sub">Gain on what you bought: <span class="${signCls(totalGain)}">${whole(totalGain, H)} (${pct(totalGain / totalPaid)})</span></div>` : ''}
      ${t.missing ? '<div class="sub">Some items are not counted yet: an exchange rate or price is missing.</div>' : ''}
      <div class="sub swipehint">Swipe for more ›</div>`,
    `<div class="label">What you own</div>
      <div class="stack">${CATS.map(([k, , cl]) => parts[k] > 0 ? `<i class="${cl}" style="width:${(parts[k] / sum * 100).toFixed(2)}%"></i>` : '').join('')}</div>
      <div class="alloc">${CATS.filter(([k]) => k !== 'loans' || parts.loans > 0).map(([k, l, cl]) => `<div class="arow tap" data-go="${{ metals: 'metals', re: 'property', cash: 'accounts', other: 'assets', loans: 'loans' }[k]}"><span class="sw ${cl}"></span><span class="al">${l}</span><span class="ap">${(parts[k] / sum * 100).toFixed(1)}%</span><span class="av">${whole(parts[k], H)}</span><span class="go">›</span></div>`).join('')}</div>
      <div class="sub" style="margin-top:6px">Tap one to open it.</div>`,
    (() => { const ie = ieRange(ieModel(), 'L12'); return `<div class="label">Income & expenses, last 12 months</div>
      <div class="ie3" style="margin-top:10px"><div class="stat"><div class="k">Income</div><div class="v up">${whole(ie.income, H)}</div></div><div class="stat"><div class="k">Expenses</div><div class="v down">${whole(ie.costs, H)}</div></div><div class="stat"><div class="k">Net</div><div class="v ${signCls(ie.net)}">${whole(ie.net, H)}</div></div></div>
      <div class="sub" style="margin-top:8px">${whole(ie.net / 12, H)} net a month on average</div>`; })(),
    `<div class="segs" style="justify-content:center">${prs}</div>${perf}`,
    `<div class="label">Gains</div><div class="alloc">${CATS.filter(c => c[0] !== 'cash' && c[0] !== 'loans').map(([k, l, cl]) => `<div class="arow"><span class="sw ${cl}"></span><span class="al">${l}<span class="sub"> paid ${whole(paid[k], H)}</span></span><span class="av ${signCls(gainOf[k])}">${whole(gainOf[k], H)}</span><span class="ap ${signCls(gainOf[k])}">${pct(paid[k] ? gainOf[k] / paid[k] : null)}</span></div>`).join('')}
      <div class="arow tot"><span class="al">All</span><span class="av ${signCls(totalGain)}">${whole(totalGain, H)}</span><span class="ap ${signCls(totalGain)}">${pct(totalPaid ? totalGain / totalPaid : null)}</span></div></div>
      <p class="sub" style="margin:8px 0 0">Real estate counts its net rent too. Cash is not a gain.</p>`,
  ];
}
/* 1.25: the summary. Net worth and its parts are today's values only (no history, so nothing can drift);
   cash flow is the money in and out in the chosen months, the same figures as Cash flow › Reports. */
const CF_TABS = [[1, '1 month'], [3, '3'], [6, '6'], [9, '9'], [12, '12']];
function cfPeriod(n) { const t = today(), y = +t.slice(0, 4), m = +t.slice(5, 7) - (n - 1), yy = y + Math.floor((m - 1) / 12), mm = ((m - 1) % 12 + 12) % 12 + 1; return [`${yy}-${String(mm).padStart(2, '0')}-01`, t]; }
function summaryHtml(t) {
  const H = home(), gross = t.cash + t.debt;
  const parts = [['accounts', 'Cash & bank accounts', gross, 'cat-c'], ['property', 'Property', t.re, 'cat-p'], ['metals', 'Precious metals', t.metals, 'cat-m'], ['loans', 'Loans you made', t.loans || 0, 'cat-l'], ['assets', 'Other assets', t.other, 'cat-o']].filter(x => Math.abs(x[2]) >= 0.5);
  const own = parts.reduce((a, x) => a + Math.max(0, x[2]), 0) || 1;
  /* 1.26: each property, and each metal, under its line */
  const subRows = { property: [], metals: [] };
  const props = q('SELECT * FROM properties ORDER BY name');
  if (props.length > 1) for (const p of props) { const st = propertyStats(p), v = conv(st.value * st.share, p.currency || H, H); if (v == null) continue;
    const inv = conv(st.invested * st.share, p.currency || H, H), ch = inv ? v / inv - 1 : null;
    subRows.property.push({ name: p.name, v, attr: `data-prop="${p.id}"`, note: ch != null ? `<span class="${signCls(ch)}">${pct(ch)}</span>` : '' }); }
  const byMetal = {}; for (const h of q('SELECT * FROM metal_holdings')) { const st = holdingStats(h); if (st.valueHome == null) continue; const m = byMetal[h.metal] = byMetal[h.metal] || { v: 0, cost: 0, oz: 0 }; m.v += st.valueHome; m.cost += st.costHome || 0; m.oz += st.oz; }
  const mk = Object.keys(byMetal); if (mk.length > 1 || (mk.length === 1 && props.length)) for (const k of mk.sort((x, y) => byMetal[y].v - byMetal[x].v)) { const m = byMetal[k], ch = m.cost ? m.v / m.cost - 1 : null;
    subRows.metals.push({ name: (METAL[k] || { name: k }).name, v: m.v, attr: 'data-go="metals"', note: `${m.oz.toFixed(m.oz < 10 ? 3 : 1)} oz${ch != null ? ` · <span class="${signCls(ch)}">${pct(ch)}</span>` : ''}` }); }
  const n = state.cfN || 1, [a, b] = cfPeriod(n), S = spendBy(a, b);
  const mlist = []; for (let k = n - 1; k >= 0; k--) { const [ma] = cfPeriod(k + 1); const y = +ma.slice(0, 4), m = +ma.slice(5, 7), end = dstr(dnum(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`) - 1); const x = spendBy(ma, end > today() ? today() : end); mlist.push({ ym: ma.slice(0, 7), inn: x.moneyIn, out: x.moneyOut }); }
  const mx = Math.max(1, ...mlist.map(x => Math.max(x.inn, x.out))), net = S.moneyIn - S.moneyOut, gain = (t.metals - t.metalsCost) + (t.re - t.reInvested) + (t.other - t.otherCost), paid = t.metalsCost + t.reInvested + t.otherCost;
  return `<div class="card hero sumc">
    <div class="label">Net worth (${H})</div><div class="big">${whole(t.total, H)}</div>
    ${t.debt > 0.5 ? `<div class="sub">You own ${whole(t.total + t.debt, H)} · you owe ${whole(t.debt, H)} on credit cards</div>` : ''}
    ${paid ? `<div class="sub">Gain on what you bought: <span class="${signCls(gain)}">${whole(gain, H)} (${pct(gain / paid)})</span></div>` : ''}
    ${t.missing ? '<div class="sub warn-t">Some items are not counted: an exchange rate or price is missing.</div>' : ''}
    <div class="stack" style="margin-top:12px">${parts.filter(x => x[2] > 0).map(x => `<i class="${x[3]}" style="width:${(x[2] / own * 100).toFixed(2)}%"></i>`).join('')}</div>
    <div class="alloc">${parts.map(x => `<div class="arow tap" data-go="${x[0]}"><span class="sw ${x[3]}"></span><span class="al">${x[1]}</span><span class="ap">${x[2] > 0 ? (x[2] / own * 100).toFixed(1) + '%' : ''}</span><span class="av">${whole(x[2], H)}</span><span class="go">›</span></div>` + (subRows[x[0]] || []).map(r => `<div class="arow subrow tap" ${r.attr}><span class="sw"></span><span class="al">${esc(r.name)}${r.note ? ` <small class="sub">${r.note}</small>` : ''}</span><span class="ap">${r.v > 0 ? (r.v / own * 100).toFixed(1) + '%' : ''}</span><span class="av">${whole(r.v, H)}</span><span class="go">›</span></div>`).join('')).join('')}
      ${t.debt > 0.5 ? `<div class="arow tap" data-go="accounts"><span class="sw" style="background:var(--down)"></span><span class="al">Owed on credit cards</span><span class="ap"></span><span class="av down">−${whole(t.debt, H)}</span><span class="go">›</span></div>` : ''}
      <div class="arow tot"><span class="sw"></span><span class="al"><b>Net worth</b></span><span class="ap"></span><span class="av"><b>${whole(t.total, H)}</b></span><span class="go"></span></div></div>
    <div class="sumcf"><div class="row" style="padding:0"><b>Cash flow, last ${n === 1 ? 'month (this month so far)' : n + ' months'}</b><span class="sub">${fmtDate(a)} – ${fmtDate(b)}</span></div>
      <div class="segs" style="margin:8px 0">${CF_TABS.map(([k]) => `<button class="seg${n === k ? ' on' : ''}" data-act="cf-n" data-v="${k}">${k} mo</button>`).join('')}</div>
      <div class="ie3"><div class="stat"><div class="k">Money in</div><div class="v up">${whole(S.moneyIn, H)}</div></div><div class="stat"><div class="k">Money out</div><div class="v down">${whole(S.moneyOut, H)}</div></div><div class="stat"><div class="k">Net</div><div class="v ${signCls(net)}">${(net >= 0 ? '+' : '−') + whole(Math.abs(net), H)}</div></div></div>
      ${n > 1 ? `<div class="sub" style="margin-top:6px">${whole(S.moneyIn / n, H)} in and ${whole(S.moneyOut / n, H)} out a month on average</div>
        <div class="iebars" style="grid-template-columns:repeat(${n},1fr)">${mlist.map(x => `<div class="ieb" title="${x.ym}: in ${whole(x.inn, H)}, out ${whole(x.out, H)}"><div class="iebp"><i class="in" style="height:${(x.inn / mx * 100).toFixed(1)}%"></i><i class="out" style="height:${(x.out / mx * 100).toFixed(1)}%"></i></div><span>${MONTHS[+x.ym.slice(5, 7) - 1][0]}</span></div>`).join('')}</div>
        <div class="legend"><span><i class="lin"></i>Money in</span><span><i class="lout"></i>Money out</span></div>` : ''}
      <p class="sub" style="margin:6px 0 0">Every deposit and payment in your accounts, plus rent and costs set on your properties; moves between your own accounts left out. The same as Cash flow › Reports. <span class="tap" data-go="money" style="text-decoration:underline">Open Cash flow ›</span></p></div></div>`;
}
/* ---------------- 1.30: a summary at the top of every Assets page ----------------
   o = { label, big, sub[], stats:[[k, v, cls]], rows:[[name, value, cls, note, attr]], rowsTitle, foot[] } */
function secSummary(o) {
  return `<h2 class="sect">Summary</h2><div class="card hero sumc">
    <div class="label">${o.label}</div><div class="big">${o.big}</div>${(o.sub || []).filter(Boolean).map(x => `<div class="sub">${x}</div>`).join('')}
    ${o.stats && o.stats.length ? `<div class="ie3" style="margin-top:10px">${o.stats.map(([k, v, c]) => `<div class="stat"><div class="k">${k}</div><div class="v ${c || ''}">${v}</div></div>`).join('')}</div>` : ''}
    ${o.rows && o.rows.length ? `${o.rowsTitle ? `<div class="sumh">${o.rowsTitle}</div>` : ''}<div class="alloc">${o.rows.map(([n, v, c, note, attr]) => `<div class="arow ie${attr ? ' tap' : ''}"${attr ? ' ' + attr : ''}><span class="al">${n}${note ? `<span class="sub"><br>${note}</span>` : ''}</span><span class="av ${c || ''}">${v}</span><span class="ap"></span></div>`).join('')}</div>` : ''}
    ${(o.foot || []).filter(Boolean).map(x => `<div class="sub" style="margin-top:6px">${x}</div>`).join('')}</div>`;
}
const sgnW = (v, c) => (v >= 0 ? '+' : '−') + whole(Math.abs(v), c);
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
  let { pts, two } = chartData(key);
  if (!two) { const f = pfactor(); if (f !== 1) pts = pts.map(([d, v]) => [d, v * f]); }   /* per the unit you chose */
  let body;
  if (pts.length < 2) {
    body = `<p class="sub" style="padding:18px 0;text-align:center">${getSetting('history_loaded') ? 'Not enough prices for this period yet.' : 'No price history yet.'}</p>
      ${getSetting('history_loaded') ? '' : '<div class="btns"><button class="btn light" data-act="history">Load price history</button></div>'}`;
  } else {
    const f = pts[0][1], l = pts[pts.length - 1][1], ch = f ? l / f - 1 : null;
    body = `<div class="chart-head"><div><div class="big2">${money(l, M)}</div><div class="sub">${two ? 'value of your metals' : 'per ' + pname()}</div></div>
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
  /* 1.30: summary: per metal, ounces, value, what you paid, the price per ounce against your average cost, and today's move */
  const per = {}, yd = dstr(dnum(today()) - 1);
  for (const x of hs) { const st = holdingStats(x), m = per[x.metal] = per[x.metal] || { oz: 0, v: 0, c: 0, n: 0 }; m.oz += st.oz; m.n++; if (st.valueM != null) { m.v += st.valueM; m.c += st.costM || 0; } }
  let day = 0; const mrows = METALS.filter(m => per[m.sym]).map(m => { const x = per[m.sym], spot = spotIn(m.sym, H), p0 = priceOn(m.sym, yd, H); if (spot != null && p0) day += (spot - p0) * x.oz;
    return [`${m.name} <small class="sub">${x.n} holding${x.n > 1 ? 's' : ''}</small>`, whole(x.v, H), '', `${x.oz.toFixed(x.oz < 10 ? 3 : 1)} oz · paid ${whole(x.c, H)}${x.c ? ` · <span class="${signCls(x.v - x.c)}">${pct(x.v / x.c - 1)}</span>` : ''}${x.oz && spot != null ? ` · your average ${money(x.c / x.oz, H, { dec: 0 })}/oz, now ${money(spot, H, { dec: 0 })}` : ''}`]; });
  let h = missingWarn() + (hs.length ? secSummary({ label: `Precious metals (${H})`, big: whole(tv, H), sub: [`${hs.length} holding${hs.length === 1 ? '' : 's'}`, day ? `<span class="${signCls(day)}">${sgnW(day, H)}</span> since yesterday's prices` : ''],
      stats: [['Paid (fees included)', whole(tc, H)], ['Up or down', sgnW(tv - tc, H), signCls(tv - tc)], ['Change', tc ? pct(tv / tc - 1) : '—', signCls(tv - tc)]], rows: mrows,
      foot: ['<a href="#" data-go="markets">Prices, sources and the price chart are under Prices ›</a>'] }) : `<h2 class="sect">Summary</h2><div class="card empty">No metals yet.</div>`)
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
  h += `<button class="btn wide" data-act="add-metal">+ Add precious metal</button><button class="btn wide light" data-act="match-buys">Find these purchases in your accounts</button>`;
  h += linkedTxHtml('metal:%', 'Transactions linked to your metals');
  view().innerHTML = h;
}
function renderProperties() {
  setTitle('Real estate');
  const ps = q('SELECT * FROM properties ORDER BY name');
  let h = missingWarn();
  if (ps.length) {   /* 1.25: totals, in your home currency, your share */
    const H = home(); let val = 0, inv = 0, perM = 0, inc = 0, miss = false;
    for (const p of ps) { const s = propertyStats(p), k = s.share, c = p.currency || H, cv = v => conv(v * k, c, H);
      const v = cv(s.value), i = cv(s.invested); if (v == null || i == null) { miss = true; continue; } val += v; inv += i; perM += cv(s.perMonth || 0) || 0; inc += cv(s.sumNet || 0) || 0; }
    const ch = inv ? val / inv - 1 : null;
    const y = +today().slice(0, 4), mo = +today().slice(5, 7); let rentM = 0, costM = 0, rented = 0, perRows = [];
    for (const p of ps) { const st = propertyStats(p), k = st.share, c = p.currency || H, f = monthFlow(p, st.periods, st.items, y, mo);
      const now = st.periods.find(r => r.start_date <= today() && (!r.end_date || r.end_date >= today())); if (now) rented++;
      rentM += conv((f.rent + f.income) * k, c, H) || 0; costM += conv(f.costs * k, c, H) || 0;
      const v = conv(st.value * k, c, H), i0 = conv(st.invested * k, c, H); if (v != null) perRows.push([esc(p.name), whole(v, H), '', `${i0 ? `<span class="${signCls(v - i0)}">${pct(v / i0 - 1)}</span> · ` : ''}${now ? 'rented ' + money(now.monthly_rent * k, c, { dec: 0 }) + ' a month' : 'not rented'}`, `data-prop="${p.id}"`]); }
    const netM = rentM - costM;
    h += secSummary({ label: `Real estate (${H}${ps.some(p => shareOf(p) < 1) ? ', your share' : ''})`, big: whole(val, H),
      sub: [`${ps.length} propert${ps.length === 1 ? 'y' : 'ies'} · ${rented} rented, ${ps.length - rented} not rented`],
      stats: [['Initial investment', whole(inv, H)], ['Up or down', sgnW(val - inv, H), signCls(val - inv)], ['Change', pct(ch), signCls(ch)]],
      rowsTitle: 'This month', rows: [['Rent and other income', whole(rentM, H), 'up'], ['Costs', costM ? '−' + whole(costM, H) : whole(0, H), costM ? 'down' : ''], ['<b>Net</b>', '<b>' + sgnW(netM, H) + '</b>', signCls(netM), val ? `${pct(netM * 12 / val)} a year on the value` : '']].concat(ps.length > 1 ? perRows : []),
      foot: [`Net rent and costs since you bought: ${sgnW(inc, H)}`, miss ? '<span class="warn-t">One property is not counted: an exchange rate is missing.</span>' : ''] });

  }
  h += `<h2 class="sect">Your properties</h2>`;
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
  h += `<button class="btn wide" data-act="add-property">+ Add property</button><button class="btn wide light" data-act="match-buys">Find these purchases in your accounts</button>`;
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
  h += linkedTxHtml('property:' + p.id, 'Transactions linked to this property <span class="sub">counted in its cashflow</span>') + `<button class="btn wide light" data-act="add-tx" data-link="property:${p.id}">+ Transaction for this property</button>`;
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
  const kinds = Object.entries(yr.byKind).filter(([kk]) => pmeta(kk)[1] === 'cost').sort((a, b) => b[1] - a[1]);
  const totalCost = kinds.reduce((a, [, v]) => a + v, 0) || 1;
  const costs = `${ysel}<div class="alloc">${kinds.length ? kinds.map(([kk, v]) => `<div class="arow"><span class="sw cat-p" style="opacity:${0.35 + 0.65 * v / totalCost}"></span><span class="al">${esc(pmeta(kk)[0])}<span class="sub">${sh(v / 12)} a month on average</span></span><span class="av">${sh(v)}</span><span class="ap">${Math.round(v / totalCost * 100)}%</span></div>`).join('') : '<p class="sub">No costs entered for this year.</p>'}</div>`;
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
  for (const a of as) { const g = acctOpen(a) ? a.type : '_off'; (groups[g] = groups[g] || []).push(a); }
  let body = '';
  let owed = 0;
  let offBody = '', seenOff = false;
  for (const [type, label] of Object.entries(ACCT_TYPES).concat([['_off', 'Hidden and closed']])) {
    const list = groups[type]; if (!list) continue; if (type === '_off') { offBody = body; body = ''; seenOff = true; }
    let gsum = 0; const rowsH = list.map(a => {
      const b = acctBalance(a.id), c = a.currency || H, share = shareOf(a), cr = a.type === 'credit';
      const mine = b ? b.balance * share : null, hv = conv(mine, c, H); if (hv != null) { total += hv; gsum += hv; if (cr) owed -= hv; }
      if (mine != null && a.interest_rate && !cr) yearly += conv(mine * a.interest_rate / 100, c, H) || 0;
      const used = cr && a.credit_limit > 0 && b ? -b.balance / a.credit_limit : null;
      const ex = cardExpiry(a), sub = [b ? (cr ? 'owed, ' : '') + fmtDate(b.date) : 'no balance yet', ex ? (ex.gone ? 'expired ' : 'expires ') + ex.label : '', a.institution, a.interest_rate && !cr ? a.interest_rate + '%' : '', shareOf(a) < 1 ? 'your share ' + shareLbl(a) : ''].filter(Boolean).map(esc).join(' · ');
      return `<div class="arowx${acctOpen(a) ? '' : ' offacct'}" data-acct="${a.id}"><div class="al"><div class="an">${esc(a.name)}${a.status === 'closed' ? ' <span class="badge">closed</span>' : a.status === 'hidden' ? ' <span class="badge">hidden</span>' : ''}</div><div class="sub">${sub}</div>
        ${cr && a.credit_limit ? `<div class="sub">limit ${money(a.credit_limit, c, { dec: 0 })}${b ? ` · <b class="${a.credit_limit + b.balance < 0 ? 'down' : 'up'}">${money(a.credit_limit + b.balance, c, { dec: 0 })} left</b>` : ''}</div>` : ''}</div>
        <div class="ar"><div class="av${mine < 0 ? ' down' : ''}">${mine == null ? '—' : money(mine, c)}</div>${c !== H && hv != null ? `<div class="sub">${money(hv, H)}</div>` : ''}${used != null ? `<div class="sub${used > .7 ? ' down' : ''}">${Math.round(used * 100)}% used</div>` : ''}</div>
        ${used != null ? limitBar(used) : ''}</div>`; }).join('');
    body += `<div class="card acard" data-t="${type}"><h2 class="gh"><span class="ghl"><span class="gbadge">${acctIcon(type)}</span><span class="gname">${ACCT_GROUP[type] || label}</span>${list.length > 1 ? `<span class="gcount">${list.length}</span>` : ''}</span><span class="gt ${gsum < -0.005 ? 'down' : ''}">${whole(gsum, H)}</span></h2><div class="alist">${rowsH}</div></div>`;
  }
  h += `<h2 class="sect">Total</h2><div class="card hero"><div class="label">Cash & bank (${H})</div><div class="big">${whole(total, H)}</div>
    ${owed > 0.005 ? `<div class="sub">${whole(total + owed, H)} in accounts and cash, less ${whole(owed, H)} owed on credit cards</div>` : ''}
    ${yearly ? `<div class="sub">About ${whole(yearly, H)} interest a year</div>` : ''}</div>`;
  { /* 1.30: summary */
    const open = as.filter(acctOpen), nB = open.filter(a => a.type !== 'credit' && a.type !== 'cash').length, nC = open.filter(a => a.type === 'credit').length, nK = open.filter(a => a.type === 'cash').length;
    let limit = 0, used = 0; for (const a of open.filter(x => x.type === 'credit' && x.credit_limit > 0)) { const b = acctBalance(a.id); limit += conv(a.credit_limit, a.currency || H, H) || 0; used += Math.max(0, -(conv(b ? b.balance : 0, a.currency || H, H) || 0)); }
    const [ma, mb] = cfPeriod(1), S = spendBy(ma, mb), [qa] = cfPeriod(3), S3 = spendBy(qa, mb);
    const off = open.filter(a => reconPeriods(a).some(p => p.diff)), waits = open.reduce((n, a) => { const pf = pendFrom(a.id); return n + (pf ? q('SELECT * FROM transactions WHERE (account_id=? OR to_account_id=?) AND date>=?', [a.id, a.id, pf]).filter(t => isWaiting(t, a.id)).length : 0); }, 0);
    const exp = typeof expiringCards === 'function' ? expiringCards() : [];
    h = h.replace(/<h2 class="sect">Total<\/h2><div class="card hero">[\s\S]*$/, '') + secSummary({
      label: `Cash & bank (${H})`, big: whole(total, H),
      sub: [`${open.length} account${open.length === 1 ? '' : 's'}: ${[nB && nB + ' bank', nC && nC + ' credit card' + (nC > 1 ? 's' : ''), nK && nK + ' cash'].filter(Boolean).join(', ')}`],
      stats: [['In accounts and cash', whole(total + owed, H)], ['Owed on cards', owed > 0.5 ? '−' + whole(owed, H) : whole(0, H), owed > 0.5 ? 'down' : ''], limit ? ['Credit left', whole(Math.max(0, limit - used), H) + ` <small>(${Math.round(used / limit * 100)}% used)</small>`, used / limit > 0.7 ? 'down' : ''] : ['Interest a year', yearly ? '≈ ' + whole(yearly, H) : '—']],
      rowsTitle: 'Money in and out',
      rows: [['This month', sgnW(S.moneyIn - S.moneyOut, H), signCls(S.moneyIn - S.moneyOut), `in ${whole(S.moneyIn, H)} · out ${whole(S.moneyOut, H)}`, 'data-go="money"'],
             ['Last 3 months, a month on average', sgnW((S3.moneyIn - S3.moneyOut) / 3, H), signCls(S3.moneyIn - S3.moneyOut), `in ${whole(S3.moneyIn / 3, H)} · out ${whole(S3.moneyOut / 3, H)}`, 'data-go="money"']],
      foot: [limit && yearly ? `About ${whole(yearly, H)} interest a year on savings` : '',
             off.length ? `<span class="tap warn-t" data-act="recon" data-id="">⚠ ${off.length} account${off.length > 1 ? 's do' : ' does'} not match the bank: Reconcile ›</span>` : (open.length ? '<span class="up">✓ Every account matches the bank</span>' : ''),
             waits ? `${waits} entr${waits === 1 ? 'y' : 'ies'} not in a bank file yet` : '',
             exp.length ? `<span class="warn-t">${exp.map(([a, e]) => esc(a.name) + (e.gone ? ' expired' : ' expires ' + e.label)).join(' · ')}</span>` : '']
    });
  }
  h += `<h2 class="sect">Your accounts</h2>`;
  if (seenOff) { const off = body; body = offBody; offBody = off; }   /* body = the open ones; offBody = hidden and closed */
  h += as.length ? (body || '<div class="card empty">Every account is hidden or closed.</div>') : `<div class="card empty">No accounts yet. Add your chequing and savings accounts, credit cards, and cash on hand.</div>`;
  if (offBody) h += `<h2 class="sect" data-fdef="1">Hidden and closed <span class="sub">${(groups._off || []).length} · still counted if they hold money</span></h2>` + offBody;
  h += `<button class="btn wide" data-act="add-account">+ Add account</button>`;
  if (as.length) h += `<button class="btn wide light" data-act="recon" data-id="">Reconcile with the bank</button>`;
  view().innerHTML = h;
}
/* does a balance check agree with your transactions since the check before it? */
function reconcile(acct, r, prev) {
  if (!prev) return null;
  const sg = b => acct.type === 'credit' ? -Math.abs(b) : b, pc = prev.created || 0, rc = r.created || 9e15;
  const txs = q('SELECT * FROM transactions WHERE (account_id=? OR to_account_id=?) AND date>=? AND (date>? OR COALESCE(created,0)>?) AND date<=? AND (date<? OR COALESCE(created,0)<=?)',
    [acct.id, acct.id, prev.date, prev.date, pc, r.date, r.date, rc]);
  if (!txs.length) return null;
  let exp = sg(prev.balance); for (const t of txs) exp += txEffect(t, acct.id, acct.currency || home());
  return { expected: exp, diff: sg(r.balance) - exp, n: txs.length };
}
function reconLine(acct, rc) {
  if (!rc) return '';
  const c = acct.currency || home(), cr = acct.type === 'credit';
  if (Math.abs(rc.diff) < 0.01) return `<div class="recon ok">✓ Agrees with your ${rc.n} transaction${rc.n > 1 ? 's' : ''} since the check before</div>`;
  const more = cr ? rc.diff < 0 : rc.diff > 0;
  if (acct.type === 'cash') return `<div class="recon bad">You counted ${money(Math.abs(rc.diff), c)} ${more ? 'more' : 'less'} than your records${more ? '' : ': cash spent and not written down?'}</div>`;
  return `<div class="recon bad">${cr ? 'The bank says you owe' : 'The bank shows'} ${money(Math.abs(rc.diff), c)} ${more ? 'more' : 'less'} than your transactions add up to: one may be missing or entered twice.</div>`;
}
/* you counted your wallet and have less than your records say: record the gap as cash spending, in one tap */
function offerCashSpending(accountId) {
  const a = q('SELECT * FROM accounts WHERE id=?', [accountId])[0]; if (!a) return;
  const bs = q('SELECT * FROM account_balances WHERE account_id=? ORDER BY date DESC, id DESC LIMIT 2', [accountId]);
  if (!bs.length) return; const prev = bs[1] || { date: '0000-00-00', balance: 0, created: 0 }, rc = reconcile(a, bs[0], prev);
  const exp = rc ? rc.expected : prev.balance, gap = exp - bs[0].balance;
  if (!(gap > 0.009)) return;
  setTimeout(() => ask(`You have ${money(gap, a.currency || home())} less cash than your records. Record it as cash spending (not itemised)?`, 'Record it').then(y => { if (!y) return;
    const cat = (q("SELECT id FROM categories WHERE parent_id IS NULL AND name='Cash spending'")[0] || {}).id || null;
    run('INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,created) VALUES(?,?,?,?,?,?,?,?)', [accountId, bs[0].date, 'out', +gap.toFixed(2), cat, 'Cash spending', 'Not itemised (from counting your cash)', (bs[0].created || Date.now()) - 1]);
    save(); toast('Recorded'); render(); }), 400);
}
function lastReconText(accountId) {   /* for the message after a new balance check */
  const a = q('SELECT * FROM accounts WHERE id=?', [accountId])[0]; if (!a) return '';
  const bs = q('SELECT * FROM account_balances WHERE account_id=? ORDER BY date DESC, id DESC LIMIT 2', [accountId]);
  const rc = reconcile(a, bs[0], bs[1]); if (!rc) return '';
  if (a.type === 'cash') return Math.abs(rc.diff) < 0.01 ? ' · matches your records ✓' : '';
  return Math.abs(rc.diff) < 0.01 ? ' · agrees with your transactions ✓' : ` · differs by ${money(Math.abs(rc.diff), a.currency || home())} from your transactions`;
}
const ACCT_ICON = { cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>', credit: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 15h4"/>',
  chequing: '<path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>', savings: '<path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>', gic: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', other: '<rect x="4" y="4" width="16" height="16" rx="3"/>' };
const acctIcon = t => `<svg class="gico" viewBox="0 0 24 24" aria-hidden="true">${ACCT_ICON[t] || ACCT_ICON.other}</svg>`;
function limitBar(used) { const u = Math.max(0, Math.min(1, used)); return `<div class="limitbar${used > .7 ? ' hi' : ''}"><i style="width:${(u * 100).toFixed(1)}%"></i></div>`; }
function renderAccount(id) {
  const a = q('SELECT * FROM accounts WHERE id=?', [id])[0];
  if (!a) { state.accountId = null; return renderAccounts(); }
  setTitle(a.name, true);
  const c = a.currency || home(), cr = a.type === 'credit', isCash = a.type === 'cash', bs = q('SELECT * FROM account_balances WHERE account_id=? ORDER BY date DESC, id DESC', [id]);
  const share = shareOf(a), b = acctBalance(id);
  let h;
  if (cr) {
    const owed = b ? -b.balance : 0, lim = a.credit_limit || 0, used = lim ? owed / lim : null;
    h = `<div class="card hero"><div class="label">Credit card${a.institution ? ' · ' + esc(a.institution) : ''}</div>
      <div class="big ${owed > 0 ? 'down' : ''}">${b ? money(owed, c) : '—'}</div><div class="sub">owed${b ? ' as of ' + fmtDate(b.date) : ''}${share < 1 ? ' · your share ' + shareLbl(a) + ': ' + money(owed * share, c) : ''}</div>
      ${lim ? `${limitBar(used)}<div class="ie3" style="margin-top:10px"><div class="stat"><div class="k">Limit</div><div class="v">${money(lim, c, { dec: 0 })}</div></div><div class="stat"><div class="k">Available</div><div class="v ${lim - owed < 0 ? 'down' : 'up'}">${money(lim - owed, c, { dec: 0 })}</div></div><div class="stat"><div class="k">Used</div><div class="v ${used > .7 ? 'down' : ''}">${Math.round(used * 100)}%</div></div></div>` : '<p class="sub">Add the credit limit (Edit) to see what is still available.</p>'}
      ${a.interest_rate ? `<div class="sub" style="margin-top:8px">${a.interest_rate}% interest a year on what is not paid in time</div>` : ''}
      ${(() => { const e = cardExpiry(a); return e ? `<div class="sub${e.soon ? ' down' : ''}" style="margin-top:6px">${e.gone ? 'Expired' : 'Expires'} ${e.label}${e.soon && !e.gone ? ` · in ${e.days} day${e.days === 1 ? '' : 's'}` : ''}</div>` : ''; })()}
      <div class="btns"><button class="btn" data-act="add-tx" data-acct-id="${a.id}">+ Expense</button><button class="btn light" data-act="pay-card" data-id="${a.id}">Pay the card</button></div>
      <div class="btns"><button class="btn light" data-act="add-balance" data-id="${a.id}">Statement / what you owe</button><button class="btn light" data-act="bank-import" data-id="${a.id}">Import bank file</button></div>
      <div class="btns"><button class="btn light" data-act="recon" data-id="${a.id}">Reconcile</button><button class="btn light" data-act="err-add" data-id="${a.id}">Record an error</button><button class="btn light" data-act="edit-account" data-id="${a.id}">Edit</button></div></div>`;
  } else {
    h = `<div class="card hero"><div class="label">${esc(ACCT_TYPES[a.type] || 'Account')}${a.institution ? ' · ' + esc(a.institution) : ''}</div>
      <div class="big">${b ? money(b.balance * share, c) : '—'}</div>
      <div class="sub">${b ? 'as of ' + fmtDate(b.date) : 'no balance yet'}${share < 1 ? ' · your share (' + shareLbl(a) + ') of ' + money(b ? b.balance : 0, c) : ''}${a.interest_rate ? ' · ' + a.interest_rate + '% interest' : ''}</div>
      <div class="btns"><button class="btn" data-act="add-tx" data-acct-id="${a.id}">+ ${isCash ? 'Cash spent or received' : 'Transaction'}</button><button class="btn light" data-act="add-balance" data-id="${a.id}">${isCash ? 'Count your cash' : 'Update balance'}</button></div>
      <div class="btns">${isCash ? '' : `<button class="btn light" data-act="bank-import" data-id="${a.id}">Import bank file</button>`}<button class="btn light" data-act="recon" data-id="${a.id}">Reconcile</button><button class="btn light" data-act="err-add" data-id="${a.id}">Record an error</button><button class="btn light" data-act="edit-account" data-id="${a.id}">Edit</button></div>
      ${isCash ? '<p class="sub" style="margin:8px 0 0">Counting your cash is optional: do it now and then, and any difference can be recorded as cash spending.</p>' : ''}</div>`;
  }
  const txs = q('SELECT * FROM transactions WHERE account_id=? OR to_account_id=? ORDER BY date DESC, id DESC LIMIT 60', [id, id]);
  if (txs.length) {
    const A = Object.fromEntries(q('SELECT * FROM accounts').map(x => [x.id, x]));
    h += `<h2 class="sect">Transactions <span class="sub">latest</span></h2><div class="card"><div class="txlist">` + txs.map(t => `<div class="txday small">${fmtDate(t.date)}</div>` + txRow(t, A)).join('') + `</div>
      <div class="btns"><button class="btn light" data-act="tx-of" data-id="${a.id}">All of them under Cash flow</button></div></div>`;
  }
  if (isCash && !bs.length) { view().innerHTML = h; return; }   /* nothing to show until you count your cash once */
  h += `<h2 class="sect">${cr ? 'Statements' : isCash ? 'Cash counts' : 'Balance checks'} <span class="sub">${cr ? 'what you owed' : isCash ? 'what you counted in your wallet' : 'the real balance from your bank'}</span></h2><div class="card">`;
  if (!bs.length) h += `<p class="sub">None yet.</p>`;
  else h += `<div class="txns" style="margin-top:0">` + bs.map((r, i) => { const prev = bs[i + 1], ch = prev ? r.balance - prev.balance : null;
    return `<div class="txn" data-bal="${r.id}"><div class="txn-top"><span class="txn-date">${fmtDate(r.date)}</span><span class="txn-desc">${esc(r.note || '')}</span></div>
      <div class="txn-body"><div class="sub ${cr ? signCls(ch == null ? null : -ch) : signCls(ch)}">${ch == null ? '' : (ch >= 0 ? '+' : '') + money(ch, c)}</div><div class="r"><div class="strongv">${money(cr ? Math.abs(r.balance) : r.balance, c)}</div></div></div>${reconLine(a, reconcile(a, r, prev))}</div>`; }).join('') + `</div>`;
  h += `<p class="sub" style="margin:8px 0 0">The balance is the last ${cr ? 'statement' : isCash ? 'count' : 'balance check'} plus the transactions after it.</p></div>`;
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
<span id="limit-wrap">${field('credit_limit', 'Credit limit', a.credit_limit)}<label class="f"><span>Card expires (month / year)</span><input type="month" name="expires" value="${esc(a.expires || '')}"></label></span></div>
    ${shareFields(a)}
    <label class="f"><span>Notes</span><textarea name="notes">${esc(a.notes)}</textarea></label>
    ${id ? `<label class="f"><span>Show this account</span><select name="status"><option value="">Open: in all lists</option><option value="hidden"${a.status === 'hidden' ? ' selected' : ''}>Hidden: not in lists, still counted in totals</option><option value="closed"${a.status === 'closed' ? ' selected' : ''}>Closed: not in lists</option></select></label>` : ''}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn light" data-f="dup">Duplicate</button><button class="btn danger" data-f="delete">Delete account</button></div>' : ''}`, box => {
    const ts = box.querySelector('[name=type]'), sync = () => { const cr = ts.value === 'credit';
      box.querySelector('#limit-wrap').style.display = cr ? '' : 'none';
      const bl = box.querySelector('#bal-wrap span'); if (bl) bl.textContent = cr ? 'What you owe today' : ts.value === 'cash' ? 'Cash you have now (optional)' : 'Balance today';
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
      const exp = d.type === 'credit' && /^\d{4}-\d{2}$/.test(d.expires || '') ? d.expires : null;
      if (id) { run('UPDATE accounts SET name=?,type=?,institution=?,currency=?,interest_rate=?,owners=?,notes=?,share_pct=?,co_owners=?,credit_limit=? WHERE id=?', vals.concat([id]));
        run('UPDATE accounts SET expires=? WHERE id=?', [exp, id]);
        run('UPDATE accounts SET status=? WHERE id=?', [d.status || null, id]);
        if (d.status === 'closed') { const bb = acctBalance(id); if (bb && Math.abs(bb.balance) > 0.005) setTimeout(() => toast('Closed. It still holds ' + money(Math.abs(bb.balance), d.currency) + ', so it is still counted in your totals.'), 300); } }
      else { run('INSERT INTO accounts(name,type,institution,currency,interest_rate,owners,notes,share_pct,co_owners,credit_limit) VALUES(?,?,?,?,?,?,?,?,?,?)', vals);
        const nid = q('SELECT last_insert_rowid() id')[0].id; run('UPDATE accounts SET expires=? WHERE id=?', [exp, nid]);
        if (bal != null) run('INSERT INTO account_balances(account_id,date,balance,note,created) VALUES(?,?,?,?,?)', [nid, today(), bal, d.type === 'cash' ? 'First count' : 'Opening balance', Date.now()]);
        state.tab = 'accounts'; state.accountId = nid; }
      save(); closeSheet(); render(); };
  });
}
function balanceForm(accountId, balId) {
  const a = q('SELECT * FROM accounts WHERE id=?', [accountId])[0]; if (!a) return;
  const r = balId ? q('SELECT * FROM account_balances WHERE id=?', [balId])[0] : { date: today() };
  openSheet(`<h2>${esc(a.name)}: ${a.type === 'cash' ? (balId ? 'edit the count' : 'count your cash') : (balId ? 'edit' : 'new') + ' balance'}</h2>
    <div class="f2">${field('date', 'Date', r.date, 'type="date"')}${field('balance', (a.type === 'credit' ? 'What you owe (' : a.type === 'cash' ? 'Cash you have (' : 'Balance (') + (a.currency || home()) + ', whole account)', a.type === 'credit' && r.balance != null ? Math.abs(r.balance) : r.balance)}</div>
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
      save(); closeSheet(); render(); if (!balId) { const rt = lastReconText(accountId); toast((a.type === 'cash' ? 'Count saved' : 'Balance saved') + rt); if (a.type === 'cash') offerCashSpending(accountId); } };
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
/* pictures for the Prices page */
function secIcon(k) {
  const I = {
    metals: `<svg class="secico" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="sgA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7dd8c"/><stop offset="1" stop-color="#b8861b"/></linearGradient><linearGradient id="sgS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f4f6"/><stop offset="1" stop-color="#9aa3ad"/></linearGradient></defs>
      <path d="M3 27l2.6-7h9.8l2.6 7z" fill="url(#sgA)" stroke="#8a6412" stroke-width=".8"/><path d="M15 27l2.6-7h9.8L30 27z" fill="url(#sgS)" stroke="#6e7782" stroke-width=".8"/><path d="M9 19.4l2.6-7h9.8l2.6 7z" fill="url(#sgA)" stroke="#8a6412" stroke-width=".8"/><path d="M12.6 14.6h6.4M7 24h5.6M19 24h5.6" stroke="#fff" stroke-opacity=".55" stroke-width="1"/></svg>`,
    star: '<svg class="secico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z" fill="#d9a92c" stroke="#a87a12" stroke-width=".8"/></svg>',
    chart: '<svg class="secico ln" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18"/><path d="M4 16l5-5 4 3 7-8"/><path d="M16 6h4v4"/></svg>',
    fx: '<svg class="secico ln" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"/></svg>',
    shield: '<svg class="secico ln" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  };
  return I[k] || '';
}
/* a small coin with the currency's sign, in its own colour */
const CUR_SIGN = { USD: 'US$', CAD: 'C$', AUD: 'A$', NZD: 'NZ$', HKD: 'HK$', SGD: 'S$', MXN: 'Mex$', EUR: '€', GBP: '£', JPY: '¥', CNY: '元', CHF: 'Fr', INR: '₹', KRW: '₩', RUB: '₽', TRY: '₺', BRL: 'R$', SEK: 'kr', NOK: 'kr', DKK: 'kr', ISK: 'kr', PLN: 'zł', CZK: 'Kč', HUF: 'Ft', ILS: '₪', ZAR: 'R', THB: '฿', PHP: '₱', NGN: '₦', UAH: '₴', IDR: 'Rp', MYR: 'RM', RON: 'lei', BGN: 'лв', AED: 'د.إ', SAR: '﷼', EGP: 'E£', LBP: 'L£', VND: '₫', PKR: '₨' };
const CUR_COL = { USD: '#2e6b45', CAD: '#b3261e', EUR: '#1f4fa3', GBP: '#4b2a7b', JPY: '#a33a4a', CHF: '#c0392b', AUD: '#1a6b7a', CNY: '#b8312f', INR: '#d07a12', MXN: '#2a7a4b' };
function curBadge(c) {
  let col = CUR_COL[c]; if (!col) { let h = 0; for (const ch of String(c)) h = (h * 31 + ch.charCodeAt(0)) % 360; col = `hsl(${h} 42% 36%)`; }
  const s = CUR_SIGN[c] || String(c).slice(0, 2);
  return `<span class="cbadge${s.length > 2 ? ' sm' : ''}" style="background:${col}" aria-hidden="true">${esc(s)}</span>`;
}
function renderMarkets() {
  const M = mcur();
  const pre = `<h2 class="sect">${secIcon('metals')}Precious metals <span class="sub">${M} per ${pname()}</span></h2><div class="card">${unitSegs()}${priceStrip()}
    <details class="fold"><summary><h2>Compare the sources</h2></summary>${metalSourcesHtml()}</details></div>
    <h2 class="sect">${secIcon('chart')}Price over time</h2>` + chartCard();
  renderCurrency(pre); bindChart();
}
function renderCurrency(prefix) {
  setTitle('Prices');
  const from = getSetting('conv_from', 'USD'), to = getSetting('conv_to', home()), amt = num(getSetting('conv_amt', '100')) || 0;
  const r1 = conv(1, from, to), res = conv(amt, from, to);
  const dec = c => ['JPY', 'KRW', 'IDR', 'HUF', 'ISK', 'CLP', 'VND'].includes(c) ? 0 : 2;
  let h = missingWarn();
  /* favourites */
  const f = favs(), H = home();
  h += `<h2 class="sect">${secIcon('star')}Favourite currencies <span class="sub">1 ${H} is worth</span></h2><div class="card"><div class="list">` +
    (f.length ? f.map(c => { const v = conv(1, H, c), inv = conv(1, c, H), v0 = convOn(1, H, c, dstr(dnum(today()) - 1)), ch = v != null && v0 ? v / v0 - 1 : null;
      return `<div class="item nolink fav">${curBadge(c)}<span class="fn"><b>${c}</b> <span class="sub">${esc(curName(c))}</span></span>
      <span class="r">${v == null ? '—' : fmtNum(v, 4)}${ch != null && Math.abs(ch) > 0.00005 ? ` <small class="pc ${signCls(ch)}">${ch > 0 ? '▲' : '▼'}${Math.abs(ch * 100).toFixed(2)}%</small>` : ''}<small class="sub">1 ${c} = ${inv == null ? '—' : money(inv, H, { dec: 4 })}</small></span>
      <span class="favmv"><button class="mv" data-favmv="${c}|-1" aria-label="Move ${c} up"${f.indexOf(c) === 0 ? ' disabled' : ''}>▲</button><button class="mv" data-favmv="${c}|1" aria-label="Move ${c} down"${f.indexOf(c) === f.length - 1 ? ' disabled' : ''}>▼</button></span>
      <button class="iconbtn star on" data-unfav="${c}" aria-label="Remove ${c} from favourites">★</button></div>`; }).join('') : '<p class="sub">No favourites yet.</p>') +
    `</div><div class="addfav"><select id="fav-add"><option value="">+ Add a favourite currency…</option>${allCurrencies().filter(c => !f.includes(c) && c !== H).map(c => `<option value="${c}">${c} · ${esc(curName(c))}</option>`).join('')}</select></div></div>`;
  h += (prefix || '');
  h += `<h2 class="sect">${secIcon('fx')}Currency converter</h2><div class="card conv">
    <label class="f"><span>Amount</span><input id="cv-amt" value="${esc(fmtNum(amt))}" inputmode="decimal" autocomplete="off"></label>
    <div class="convrow"><label class="f"><span>${curBadge(from)} From</span>${curSelect('cv-from', from)}</label>
      <button class="iconbtn swap" id="cv-swap" aria-label="Swap"><svg viewBox="0 0 24 24"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg></button>
      <label class="f"><span>${curBadge(to)} To</span>${curSelect('cv-to', to)}</label></div>
    <div class="convres"><div class="big">${res == null ? '—' : money(res, to, { dec: dec(to) })}</div>
      <div class="sub">${r1 == null ? 'No rate for this pair yet.' : `1 ${from} = ${fmtNum(r1, 6)} ${to} · 1 ${to} = ${fmtNum(1 / r1, 6)} ${from}`}</div></div></div>`;
  /* sources for this pair */
  const fx = quotes('fx');
  const rows = FX_SOURCES.map(s => { const a = (fx[from] || {})[s.id], b = (fx[to] || {})[s.id]; return [s, a > 0 && b > 0 ? b / a : null]; });
  const vals = rows.map(r => r[1]).filter(Boolean), md = median(vals);
  h += `<h2 class="sect">${secIcon('shield')}Sources for ${from} → ${to}</h2><div class="card"><div class="list">${rows.map(([s, v]) => `<div class="item nolink"><span>${esc(s.name)}</span><span class="r">${v == null ? '<span class="sub">no rate</span>' : fmtNum(v, 6)}${v != null && md ? `<small class="sub"> ${((v / md - 1) * 100 >= 0 ? '+' : '')}${((v / md - 1) * 100).toFixed(2)}%</small>` : ''}</span></div>`).join('')}</div>
    <p class="sub" style="margin:8px 0 0">${vals.length === 1 ? 'Only ' + esc(rows.find(r => r[1])[0].name) + ' has a rate for this pair. ' : ''}${vals.length > 1 ? `The app uses ${getSetting('fx_source', 'auto') === 'auto' ? 'the middle value of the ' + vals.length + ' sources' : esc(SRC_NAME[getSetting('fx_source')])} (change it in Settings).` : vals.length ? '' : 'Press ↻ when you are online to compare the sources.'} Updated ${when(getSetting('prices_updated'))}.</p></div>`;
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
    <label class="f"><span>Text size</span><select id="set-size">${[['', 'Normal'], ['large', 'Large'], ['larger', 'Larger']].map(([v, l]) => `<option value="${v}"${(PREFS.size || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="switch"><span>Show the total of a folded section or card</span><input type="checkbox" id="set-ftot"${getSetting('fold_totals', '1') === '1' ? ' checked' : ''}></div>
    <p class="sub" style="margin:4px 0 0">Tap a heading (or the arrow on an Overview card) to fold it. Turn this off to hide amounts when folded, for privacy.</p></div>`;
  h += `<h2 class="sect">Steward</h2><div class="card"><p class="sub" style="margin-top:0">Bible verses on work, honesty and the right use of money (King James Version).</p>
    <div class="switch"><span>Show Bible verses around the app</span><input type="checkbox" id="set-verses"${versesOn() ? ' checked' : ''}></div>
    <p class="sub" style="margin:4px 0 0">A verse of the day on Overview, and a verse at the foot of some pages. The Steward page is always here.</p>
    <div class="btns"><button class="btn light" data-act="stewardship">Open the Steward page</button></div></div>`;
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
  h += syncCard();
  h += `<h2 class="sect">Your data</h2><div class="card">
    <p class="sub">Everything is kept in one SQLite database file on this device. Export it to back it up or to move it to another phone or computer; import it there.</p>
    <div class="btns"><button class="btn" data-act="export">Export database</button><button class="btn light" data-act="import">Import database</button></div>
    <h3 class="ieh">From MMEX (Money Manager Ex)</h3><p class="sub">Brings your accounts, categories, payees, every transaction (cash too), scheduled bills and assets from an MMEX database (.mmb). Import the same file again later and only what is new is added.</p>
    <div class="btns"><button class="btn" data-act="mmex-import">Import MMEX file</button></div>
    <h3 class="ieh">From your bank</h3><p class="sub">In your online banking, download your account's history (OFX, QFX, QIF or CSV), then import it here. Your bank password is never needed and the file is read only on this device. Transactions already here are skipped.</p>
    <div class="btns"><button class="btn" data-act="bank-import">Import bank file</button></div>
    ${importsHtml()}
    <h3 class="ieh">Printable report</h3><p class="sub">A clean summary on paper: net worth, every holding, income & expenses, bills coming. Print it, or choose "Save as PDF" (Android) / "Print to File" (Linux) to keep a PDF.</p>
    <div class="btns"><button class="btn" data-act="print-report">Print or save as PDF</button></div>
    <h3 class="ieh">For a spreadsheet (CSV)</h3><p class="sub">Opens in LibreOffice Calc, Excel or Google Sheets. Amounts in each item's own currency, with your share.</p>
    <div class="btns"><button class="btn light" data-act="csv" data-which="tx">Transactions</button><button class="btn light" data-act="csv" data-which="assets">Assets</button><button class="btn light" data-act="csv" data-which="propcf">Property cashflow</button></div></div>`;
  h += `<div class="card"><h3 class="ieh" style="margin-top:0">Start fresh</h3><p class="sub">Erases everything on this device (accounts, transactions, assets, loans…) so you can import again cleanly. Your settings stay. Export a backup first.</p>
    <div class="btns"><button class="btn danger" data-act="start-fresh">Erase everything and start fresh</button></div></div>`;
  h += `<h2 class="sect">About</h2><div class="card"><p class="sub">KJT Finance ${APP_VERSION}, by Knowing Jesus Today (knowingjesus.today). Open source (GPL-2.0-or-later), no accounts, no analytics, no tracking.
    The app only goes online to update prices and to look for app updates. Metals: gold-api.com, Yahoo Finance, Currency API. Exchange rates: European Central Bank, Bank of Canada, ExchangeRate-API (exchangerate-api.com), Currency API. Past prices: DataHub, Yahoo Finance, Frankfurter. Nothing about you or your holdings is sent.</p></div>`;
  view().innerHTML = h;
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.onchange = f; };
  on('set-home', e => { setSetting('home_currency', e.target.value); save(); render(); });
  on('set-mcur', e => { setSetting('metal_currency', e.target.value); save(); render(); });
  on('set-upd', e => { setSetting('auto_update', e.target.checked ? '1' : '0'); save(); });
  on('set-auto', e => { setSetting('auto_prices', e.target.checked ? '1' : '0'); save(); });
  on('set-theme', e => { PREFS.theme = e.target.value; applyLook(); savePrefs(); });
  on('set-size', e => { PREFS.size = e.target.value; applyLook(); savePrefs(); });
  on('set-verses', e => { setSetting('verses', e.target.checked ? '1' : '0'); save(); });
  on('set-ftot', e => { setSetting('fold_totals', e.target.checked ? '1' : '0'); save(); });
  on('set-msrc', e => { setSetting('metal_source', e.target.value); applyQuotes(getSetting('prices_updated') || new Date().toISOString()); save(); render(); });
  on('set-fsrc', e => { setSetting('fx_source', e.target.value); applyQuotes(getSetting('prices_updated') || new Date().toISOString()); save(); render(); });
  view().querySelectorAll('[data-pal]').forEach(b => b.onclick = () => { PREFS.palette = b.dataset.pal; applyLook(); savePrefs(); render(); });
  securityCard().then(html => { const el = document.getElementById('sec'); if (el) { el.outerHTML = html.replace('<h2>Security</h2>', ''); bindSecurity(); } });
}

/* ---------------- forms ---------------- */
function openSheet(html, onReady) {
  const sh = document.getElementById('sheet'), bx = sh.querySelector('.sheet-box'); bx.oninput = bx.onclick = bx.onchange = null; bx.innerHTML = html; sh.hidden = false;
  sh.querySelector('.sheet-box').scrollTop = 0; if (onReady) onReady(sh.querySelector('.sheet-box')); searchSelects(sh.querySelector('.sheet-box'));
}
/* 1.23: every long list (categories, payees, accounts…) gets a search box: type a few letters, the list keeps only what matches */
const fold = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function searchSelects(root) {
  for (const sel of root.querySelectorAll('select:not([multiple]):not(.nosearch)')) {
    if (sel.dataset.srch || sel.options.length < 9) continue; sel.dataset.srch = '1';
    const all = Array.from(sel.children).map(n => n.cloneNode(true)), box = document.createElement('input');
    box.type = 'search'; box.className = 'selsearch'; box.placeholder = 'Search ' + sel.options.length + '…'; box.autocomplete = 'off'; box.setAttribute('aria-label', 'Search the list');
    sel.parentNode.insertBefore(box, sel);
    const keep = o => o.cloneNode(true);
    box.addEventListener('input', e => { e.stopPropagation();
      const w = fold(box.value).trim().split(/\s+/).filter(Boolean), before = sel.value, hit = t => w.every(x => fold(t).includes(x));
      sel.innerHTML = '';
      for (const n of all) {
        if (n.tagName === 'OPTGROUP') { const gl = n.label, os = Array.from(n.children).filter(o => !w.length || hit(gl + ' ' + o.textContent)); if (!os.length) continue;
          const g = n.cloneNode(false); os.forEach(o => g.appendChild(keep(o))); sel.appendChild(g); }
        else if (!w.length || hit(n.textContent) || (n.value === before && !w.length)) sel.appendChild(keep(n));
      }
      if (!sel.options.length) { const o = document.createElement('option'); o.disabled = true; o.textContent = 'Nothing matches "' + box.value + '"'; sel.appendChild(o); return; }
      const still = Array.from(sel.options).some(o => o.value === before && !o.disabled);
      if (still) sel.value = before; else { const f = Array.from(sel.options).find(o => !o.disabled && o.value !== ''); if (f) { sel.value = f.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } }
    });
    box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sel.focus(); } });
  }
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
  const r = await native('exportDb', { b64: bytesToB64(await fileBytes()), name: 'kjt-finance-' + today() + (CRYPT ? '-encrypted.itdb' : '.sqlite') });
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
  if (!isOurDb(cand)) { cand.close(); return toast('That file is not a KJT Finance database.'); }
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
/* 1.19: keyboard: Ctrl+H hides or shows amounts; Esc closes what is open (a window, a question, the selection), or goes back */
document.addEventListener('keydown', e => {
  const L = document.getElementById('lock'); if (L && !L.hidden && L.innerHTML) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); const eb = document.getElementById('eye'); if (eb) eb.click(); return; }
  if (e.key !== 'Escape') return;
  const dlg = document.getElementById('dlg'), sh = document.getElementById('sheet');
  if (dlg && !dlg.hidden) { e.preventDefault(); const no = dlg.querySelector('button:not([data-y])'); if (no) no.click(); else dlg.hidden = true; return; }
  if (sh && !sh.hidden) { e.preventDefault(); closeSheet(); return; }
  const ae = document.activeElement; if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { ae.blur(); return; }
  if (state.sel) { state.sel = null; selBar(); render(); return; }
  if (navBack()) e.preventDefault();
});
let toastTimer;
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2600); }
document.getElementById('tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  let t = b.dataset.tab;
  if (t === 'assetsgroup') t = isAsset(state.tab) ? state.tab : (state.lastAsec || 'accounts');
  if (state.tab === t || b.dataset.tab === 'assetsgroup') { state.propertyId = null; state.accountId = null; state.assetId = null; state.loanId = null; }
  navRoot(); state.tab = t; render(); view().scrollTop = 0; };
document.getElementById('refresh').onclick = () => updatePrices(false);
document.getElementById('eye').onclick = () => { PREFS.hideAmt = !PREFS.hideAmt; applyLook(); savePrefs(); toast(PREFS.hideAmt ? 'Amounts hidden' : 'Amounts shown'); };
document.getElementById('search').onclick = () => { navRoot(); Object.assign(state, { tab: 'money', msec: 'tx', txPer: 'all', txCat: '', propertyId: null, accountId: null, assetId: null, loanId: null }); render();
  const s = document.getElementById('tx-search'); if (s) { s.focus(); s.scrollIntoView({ block: 'center' }); } };
document.getElementById('fab').onclick = () => txForm(null, null, state.txAcct ? { account_id: +state.txAcct } : null);
document.getElementById('settings').onclick = () => { navRoot(); state.tab = 'more'; render(); view().scrollTop = 0; };
document.getElementById('back').onclick = () => goBack();
function goBack() {
  const dl = document.getElementById('dlg'); if (!dl.hidden) { dl.querySelector('[data-n]').click(); return true; }
  if (!document.getElementById('sheet').hidden) { closeSheet(); return true; }
  if (state.sel) { endSel(); return true; }
  if (navBack()) return true;
  if (state.tab === 'property' && state.propertyId) { state.propertyId = null; render(); return true; }
  if (state.tab === 'accounts' && state.accountId) { state.accountId = null; render(); return true; }
  if (state.tab === 'assets' && state.assetId) { state.assetId = null; render(); return true; }
  if (state.tab === 'loans' && state.loanId) { state.loanId = null; render(); return true; }
  if (state.tab !== 'overview') { navRoot(); state.tab = 'overview'; render(); return true; }
  return false;
}
window.__onBack = () => goBack();
window.addEventListener('resize', () => { for (const [id, k] of [['heroS', 'hpage'], ['cfS', 'cfPage']]) { const el = document.getElementById(id); if (el) fitSwipe(el, state[k] || 0); } });
view().addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-go],[data-metal],[data-prop],[data-item],[data-pval],[data-cfy],[data-cfp],[data-rent],[data-price],[data-fx],[data-chart],[data-range],[data-acct],[data-iecat],[data-bal],[data-asset],[data-aval],[data-hpage],[data-prange],[data-unfav],[data-favmv],[data-ie],[data-asec],[data-msec],[data-txm],[data-tx],[data-rec],[data-cat],[data-addsub],[data-addcat],[data-rp],[data-remdo],[data-remskip],[data-loan],[data-lpay],[data-txper],[data-rule],[data-cfold],[data-payee],[data-ptick],[data-punit]'); if (!el) return;
  const d = el.dataset;
  if (d.chart) { state.chart = d.chart; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.range) { state.range = d.range; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.go) { e.preventDefault(); state.tab = d.go; state.propertyId = null; state.accountId = null; state.assetId = null; state.loanId = d.loanid ? +d.loanid : null; render(); view().scrollTop = 0; }
  else if (d.metal) metalForm(+d.metal);
  else if (d.prop) { state.tab = 'property'; state.propertyId = +d.prop; render(); view().scrollTop = 0; }
  else if (d.item) itemForm(state.propertyId, +d.item);
  else if (d.pval) propertyValueForm(state.propertyId, +d.pval);
  else if (d.cfy) { state.cfYear = +d.cfy; if (el.classList.contains('yrow')) state.cfPage = 0; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.cfp) { state.cfPage = +d.cfp; const sc = document.getElementById('cfS'); if (sc) sc.scrollTo({ left: +d.cfp * sc.clientWidth, behavior: 'smooth' }); document.querySelectorAll('.cftabs .seg').forEach((b, j) => b.classList.toggle('on', j === +d.cfp)); }
  else if (d.rent) rentForm(state.propertyId, +d.rent);
  else if (d.asec) { state.tab = d.asec; state.propertyId = null; state.accountId = null; state.assetId = null; state.loanId = null; render(); view().scrollTop = 0; }
  else if (d.msec) { state.msec = d.msec; render(); view().scrollTop = 0; }
  else if (d.punit) { setSetting('price_unit', d.punit); save(); const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.ptick != null) { state.psel = state.psel || new Set(); if (state.psel.has(d.ptick)) state.psel.delete(d.ptick); else state.psel.add(d.ptick); const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.payee != null) payeeForm(d.payee);
  else if (d.cfold) { e.preventDefault(); toggleCard(d.cfold); }
  else if (d.rule) ruleForm(+d.rule);
  else if (d.txper) { state.txPer = d.txper; render(); }
  else if (d.txm) { state.txMonth = d.txm; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.tx) { if (state.sel) pickTx(el, +d.tx); else txForm(+d.tx); }
  else if (d.loan) { state.loanId = +d.loan; render(); view().scrollTop = 0; }
  else if (d.lpay) loanPayForm(state.loanId, +d.lpay);
  else if (d.rec) recForm(+d.rec);
  else if (d.cat) catManage(+d.cat);
  else if (d.addsub) catForm(null, +d.addsub);
  else if (d.addcat) catForm(null, null, d.addcat);
  else if (d.rp) { state.rp = d.rp; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.remdo) { const r = q('SELECT * FROM recurring WHERE id=?', [+d.remdo])[0]; if (r) { addFromRecurring(r, r.next_date); advance(r); save(); toast('Added'); render(); } }
  else if (d.remskip) { const r = q('SELECT * FROM recurring WHERE id=?', [+d.remskip])[0]; if (r) { advance(r); save(); toast('Skipped this time'); render(); } }
  else if (d.ie) { state.ieRange = d.ie; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.unfav) { setFavs(favs().filter(c => c !== d.unfav)); render(); }
  else if (d.favmv) { const [c, dir] = d.favmv.split('|'), f = favs(), i = f.indexOf(c), j = i + +dir; if (i >= 0 && j >= 0 && j < f.length) { [f[i], f[j]] = [f[j], f[i]]; setFavs(f); const st = view().scrollTop; render(); view().scrollTop = st; } }
  else if (d.hpage) { const sc = document.getElementById('heroS'); if (sc) sc.scrollTo({ left: +d.hpage * sc.clientWidth, behavior: 'smooth' }); }
  else if (d.prange) { state.prange = d.prange; const st = view().scrollTop; render(); view().scrollTop = st; }
  else if (d.asset) { state.assetId = +d.asset; render(); view().scrollTop = 0; }
  else if (d.aval) assetValueForm(state.assetId, +d.aval);
  else if (d.acct) { state.tab = 'accounts'; state.accountId = +d.acct; render(); view().scrollTop = 0; }
  else if (d.iecat) { const r = state.ieRange || 'L12', y = new Date().getFullYear(); Object.assign(state, { tab: 'money', msec: 'tx', txCat: d.iecat, txAcct: '', txSearch: '', txPer: r === 'L12' ? 'all' : 'y', txMonth: r === 'PY' ? `${y - 1}-12` : today().slice(0, 7) }); render(); view().scrollTop = 0; }
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
    case 'stewardship': state.tab = 'stewardship'; render(); view().scrollTop = 0; break;
    case 'recon': state.tab = 'recon'; state.reconId = d.id ? +d.id : null; render(); view().scrollTop = 0; break;
    case 'find-xfer': offerTransfers(false); break;
    case 'stmt-bal': stmtBalances(+d.id); break;
    case 'why-change': changeSheet(); break;
    case 'cf-n': { state.cfN = +d.v; const st = view().scrollTop; render(); view().scrollTop = st; break; }
    case 'fix-all-accts': correctEveryAccount(); break;
    case 'bd-view': { state.bdView = d.v; const st = view().scrollTop; render(); view().scrollTop = st; break; }
    case 'bd-measure': { state.bdMeasure = d.v; const st = view().scrollTop; render(); view().scrollTop = st; break; }
    case 'why-month': monthSheet(); break;
    case 'match-buys': matchPurchases(); break;
    case 'find-repeat': findRepeatSheet(); break;
    case 'p-similar': similarPayeesSheet(); break;
    case 'p-tickall': { const srch = low(state.psearch); state.psel = new Set(payeeList().filter(r => !srch || low(r.payee).includes(srch)).map(r => r.payee)); render(); break; }
    case 'cat-merge-many': catMergeMany(); break;
    case 'err-add': errorForm(+d.id); break;
    case 'err-all': correctAll(+d.id); break;
    case 'xfer-apply': applyLoose(+d.id); break;
    case 'recon-month': reconMonth(+d.id, d.ym); break;
    case 'tx-of': state.tab = 'money'; state.msec = 'tx'; state.txAcct = d.id; state.accountId = null; render(); view().scrollTop = 0; break;
    case 'csv': exportCsv(d.which); break;
    case 'add-loan': loanForm(); break;
    case 'edit-loan': loanForm(+d.id); break;
    case 'add-loanpay': loanPayForm(+d.id); break;
    case 'bank-import': bankImport(d.id ? +d.id : null); break;
    case 'add-rule': ruleForm(); break;
    case 'p-merge': payeeMergeForm(Array.from(state.psel || [])); break;
    case 'p-cat': payeeCatForm(Array.from(state.psel || [])); break;
    case 'p-clear': state.psel = new Set(); render(); break;
    case 'cat-clean': removeUnusedCats(); break;
    case 'mmex-import': mmexImport(); break;
    case 'undo-import': undoImport(+d.id); break;
    case 'start-fresh': startFresh(); break;
    case 'sync-setup': syncSetup(); break;
    case 'sync-now': syncNow(true); break;
    case 'sync-stop': syncStop(); break;
    case 'merge-file': mergeFile(); break;
    case 'copy-upd': native('copyText', { text: updateInfo && updateInfo.command || '' }).then(() => toast('Copied: open Terminal and paste it (Ctrl+Shift+V), then press Enter')); break;
    case 'tx-clear': state.txCat = ''; state.txSearch = ''; render(); break;
    case 'select-tx': state.sel = new Set(); render(); selBar(); break;
    case 'sort-uncat': state.txCat = 'none'; render(); state.sel = new Set(Array.from(view().querySelectorAll('[data-tx]')).map(r => +r.dataset.tx)); render(); selBar();
      toast('All of them are ticked: press Edit to choose a category, or untick some first'); break;
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
  de.classList.toggle('hideamt', !!PREFS.hideAmt); const eb = document.getElementById('eye'); if (eb) eb.classList.toggle('on', !!PREFS.hideAmt);
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
function hideLock() { const L = lockEl(); L.hidden = true; L.innerHTML = ''; if (window.__quickPending && APP_READY) setTimeout(window.__quickAdd, 200); }
/* quick add: the + button, and "Add transaction" when you long-press (or right-click) the app's icon */
let APP_READY = false;
window.__quickAdd = () => {
  if (!db || !APP_READY || !lockEl().hidden) { window.__quickPending = true; return; }
  window.__quickPending = false;
  if (!q('SELECT COUNT(*) n FROM accounts')[0].n) { state.tab = 'accounts'; render(); return toast('First add an account (or cash), then your transactions.'); }
  closeSheet(); state.tab = 'money'; state.msec = 'tx'; render(); txForm(null, null, state.txAcct ? { account_id: +state.txAcct } : null);
};
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
    CRYPT = null; PREFS.pinLength = null; PREFS.bio = false; await savePrefs(); await native('bioDisable', {}); await saveNow(); native('secure', { on: !!PREFS.noShots });
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
      <div class="btns"><button class="btn" data-act="pin-on">Turn on passcode</button></div>`}
    <div class="switch"><span>Block screenshots and screen recording${on ? ' (always on with a passcode)' : ''}</span><input type="checkbox" id="set-shots"${on || PREFS.noShots ? ' checked' : ''}${on ? ' disabled' : ''}></div>
    <p class="sub" style="margin:4px 0 0">Also hides the app's content in the list of open apps. Works on Android; Linux cannot stop screenshots.</p></div>`;
}
function bindSecurity() {
  const b = document.getElementById('set-bio'); if (b) b.onchange = () => securityAction(b.checked ? 'bio-on' : 'bio-off');
  const l = document.getElementById('set-lock'); if (l) l.onchange = () => { PREFS.lockAfter = +l.value; savePrefs(); };
  const sh = document.getElementById('set-shots'); if (sh) sh.onchange = () => { PREFS.noShots = sh.checked; savePrefs(); native('secure', { on: !!CRYPT || PREFS.noShots }); toast(sh.checked ? 'Screenshots are blocked' : 'Screenshots are allowed'); };
}

/* ---------------- income and expenses, everything together ----------------
   Income: rent and other income from the properties, and the interest the accounts earn (estimated from
   their interest rate and balance). Expenses: every property cost (condo fees, taxes, insurance, repairs…).
   Your share only, in your home currency. */
function ieModel() { return BALC.__ie || (BALC.__ie = ieModel0()); }
function ieModel0() {
  const H = home(), m = {};
  const slot = key => (m[key] = m[key] || { rent: 0, other: 0, interest: 0, hin: 0, costs: 0, byKind: {} });
  for (const p of q('SELECT * FROM properties')) {
    const st = propertyStats(p), k = st.share, c = p.currency || H;
    for (const yr of st.rows) for (const f of yr.months) {
      if (!f.owned || f.future) continue;
      const key = `${f.y}-${String(f.m + 1).padStart(2, '0')}`, d = key + '-15', x = slot(key), cv = v => convOn(v * k, c, H, d) || 0;
      x.rent += cv(f.rent); x.other += cv(f.income); x.costs += cv(f.costs);
      for (const [kk, v] of Object.entries(f.byKind)) if (pmeta(kk)[1] === 'cost') x.byKind[kk] = (x.byKind[kk] || 0) + cv(v);
    }
  }
  const now = today();
  /* your own transactions: not transfers, not those linked to a property (already counted above), not savings */
  const A = Object.fromEntries(q('SELECT * FROM accounts').map(x => [x.id, x])), C = cats();
  /* 1.20: added up by the database per month, account and category (thousands of transactions stay fast) */
  for (const t of q("SELECT substr(date,1,7) ym, account_id, category_id, kind, SUM(amount) amount FROM transactions WHERE kind<>'transfer' AND date<=? AND (link IS NULL OR link NOT LIKE 'property:%') GROUP BY ym, account_id, category_id, kind", [now])) {
    const top = C.top(t.category_id); if (top && top.kind === 'save') continue;
    const a = A[t.account_id] || {}, c = a.currency || H, amt = t.amount * shareOf(a), v = c === H ? amt : convOn(amt, c, H, t.ym + '-15') || 0, x = slot(t.ym);
    if (t.kind === 'in') x.hin += v; else { x.costs += v; const kk = 'cat:' + (top ? top.name : 'No category'); x.byKind[kk] = (x.byKind[kk] || 0) + v; }
  }
  /* a loan written off is a loss in the month it was written off */
  for (const l of q('SELECT * FROM loans WHERE written_off IS NOT NULL')) { const s = loanStats(l); if (!s.lost || l.written_off > now) continue;
    const x = slot(l.written_off.slice(0, 7)), v = convOn(s.lost, l.currency || H, H, l.written_off) || 0; x.costs += v; x.byKind['cat:Loans written off'] = (x.byKind['cat:Loans written off'] || 0) + v; }
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
  const rows = (list, total) => list.filter(([, v]) => v > 0.5).map(([l, v, ck]) => `<div class="arow ie${ck ? ' tap' : ''}"${ck ? ` data-iecat="${ck}"` : ''}><span class="al">${l}${ck ? ' <span class="chev">›</span>' : ''}</span><span class="av">${whole(v, H)}</span><span class="ap">${total ? Math.round(v / total * 100) + '%' : ''}</span></div>`).join('') || '<p class="sub">None in this period.</p>';
  const inc = [['Your income (transactions)', t.hin], ['Rent', t.rent], ['Other property income', t.other], ['Interest (estimated)', t.interest]];
  const CC = cats(), catKey = kk => { if (!kk.startsWith('cat:')) return ''; const nm = kk.slice(4); if (nm === 'No category') return 'none'; const c = CC.rows.find(x => !x.parent_id && x.name === nm); return c ? String(c.id) : ''; };
  const exp = Object.entries(t.byKind).sort((a, b) => b[1] - a[1]).map(([kk, v]) => [esc(kk.startsWith('cat:') ? kk.slice(4) : pmeta(kk)[0] + ' (property)'), v, catKey(kk)]);
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
  ['save', 'Transfers & card payments', []], ['save', 'Loans', ['Lent', 'Repaid']], ['out', 'Cash spending', []],
];
const KIND_NAME = { out: 'Expense', in: 'Income', transfer: 'Transfer' };
const FREQS = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', bimonthly: 'Every 2 months', quarterly: 'Every 3 months', halfyearly: 'Every 6 months', yearly: 'Every year' };
const FREQ_MONTHS = { monthly: 1, bimonthly: 2, quarterly: 3, halfyearly: 6, yearly: 12 };
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
    if (t.to_account_id === accountId) { if (t.to_amount != null && t.to_amount > 0) return t.to_amount; const AC = BALC.__acur || (BALC.__acur = Object.fromEntries(q('SELECT id, currency FROM accounts').map(r => [r.id, r.currency]))); const fc = AC[t.account_id] || home(); return fc === cur ? t.amount : conv(t.amount, fc, cur) || t.amount; }
    return 0;
  }
  if (t.account_id !== accountId) return 0;
  return t.kind === 'in' ? t.amount : -t.amount;
}
/* 1.20: an account's balance on any day, from one read of its transactions (for charts over many dates) */
function balanceFn(a) {
  const cur = a.currency || home(), cr = a.type === 'credit', ck = t => t.date + '|' + String(Math.round(t.created || 0) + 1e15).padStart(18, '0');
  const txs = q('SELECT date, created, kind, amount, to_amount, account_id, to_account_id FROM transactions WHERE account_id=? OR to_account_id=?', [a.id, a.id]).map(t => [ck(t), t]).sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0).map(x => x[1]);
  const P = [0]; for (const t of txs) P.push(P[P.length - 1] + txEffect(t, a.id, cur));
  const keys = txs.map(ck), dates = txs.map(t => t.date);
  const bs = q('SELECT date, balance, created FROM account_balances WHERE account_id=? ORDER BY date, id', [a.id]);
  const ub = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; } return lo; };
  const bdates = bs.map(b => b.date);
  return d => {
    const bi = ub(bdates, d) - 1, end = ub(dates, d);
    if (bi < 0) return end ? P[end] : null;
    const b = bs[bi], start = ub(keys, b.date + '|' + String(Math.round(b.created || 0) + 1e15).padStart(18, '0'));
    return (cr ? -Math.abs(b.balance) : b.balance) + (end > start ? P[end] - P[start] : 0);
  };
}
function acctBalance(id, onDate) {
  const key = id + '|' + (onDate || '');
  if (key in BALC) return BALC[key] && Object.assign({}, BALC[key]);
  const r = acctBalance0(id, onDate); BALC[key] = r; return r && Object.assign({}, r);
}
function acctBalance0(id, onDate) {
  const d = onDate || today(), a = q('SELECT * FROM accounts WHERE id=?', [id])[0]; if (!a) return null;
  const snap = q('SELECT * FROM account_balances WHERE account_id=? AND date<=? ORDER BY date DESC, id DESC LIMIT 1', [id, d])[0];
  const from = snap ? snap.date : '0000-00-00', made = snap ? snap.created || 0 : 0;
  const txs = q('SELECT * FROM transactions WHERE (account_id=? OR to_account_id=?) AND date<=? AND date>=? AND (date>? OR COALESCE(created,0)>?)', [id, id, d, from, from, made]);
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
  const y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10), k = (y * 12 + m - 1) + (FREQ_MONTHS[freq] || 1);
  const ny = Math.floor(k / 12), nm = k % 12 + 1;
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
/* a card works until the last day of its expiry month */
function cardExpiry(a) {
  if (!a || a.type !== 'credit' || !a.expires || !/^\d{4}-\d{2}$/.test(a.expires)) return null;
  const y = +a.expires.slice(0, 4), m = +a.expires.slice(5, 7), end = `${a.expires}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`, days = dnum(end) - dnum(today());
  return { end, days, label: a.expires.slice(5, 7) + '/' + a.expires.slice(2, 4), soon: days <= 60, gone: days < 0 };
}
function expiringCards() { return q("SELECT * FROM accounts WHERE type='credit' AND expires IS NOT NULL").filter(acctOpen).map(a => [a, cardExpiry(a)]).filter(([, e]) => e && e.soon); }
function remindersCard() {
  const rs = reminders(14), now = today(), until = dstr(dnum(now) + 14);
  const ls = q('SELECT * FROM loans WHERE closed=0 AND due_date IS NOT NULL AND due_date<=? ORDER BY due_date', [until]);
  const cards = expiringCards();
  if (!rs.length && !ls.length && !cards.length) return '';
  const cardRows = cards.map(([a, e]) => `<div class="txn cost" data-acct="${a.id}"><div class="txn-top"><span class="txn-date warn-t">${e.gone ? 'expired · ' : 'expires · '}${e.label}</span><span class="txn-desc">${esc(a.name)}</span></div>
      <div class="txn-body"><div class="sub">${e.gone ? 'This card has expired. ' : `In ${e.days} day${e.days === 1 ? '' : 's'}. `}Activate the new card, update payments that use it, then change the date here.</div></div></div>`).join('');
  const loanRows = ls.map(l => { const s = loanStats(l); if (s.owed <= 0.005) return ''; const late = l.due_date < now;
    return `<div class="txn ${late ? 'cost' : 'inc'}" data-go="loans" data-loanid="${l.id}"><div class="txn-top"><span class="txn-date${late ? ' warn-t' : ''}">${late ? 'overdue · ' : ''}${fmtDate(l.due_date)}</span><span class="txn-desc">${esc(l.person)} repays you</span></div>
      <div class="txn-body"><div class="sub">loan of ${money(l.amount, l.currency || home(), { dec: 0 })}</div><div class="r"><div class="strongv">${money(s.owed, l.currency || home())}</div></div></div></div>`; }).join('');
  return `<h2 class="sect" data-ftot="${rs.length + ls.length + cards.length} coming">Coming up <span class="sub">next 14 days</span></h2><div class="card"><div class="txns" style="margin-top:0">` + cardRows + loanRows + rs.map(r => {
    const a = q('SELECT * FROM accounts WHERE id=?', [r.account_id])[0], c = (a && a.currency) || home(), due = r.next_date <= now;
    return `<div class="txn tap ${r.kind === 'in' ? 'inc' : 'cost'}" data-rec="${r.id}"><div class="txn-top"><span class="txn-date${due ? ' warn-t' : ''}">${due ? (r.next_date < now ? 'overdue · ' : 'today · ') : ''}${fmtDate(r.next_date)}</span><span class="txn-desc">${esc(r.payee || cats().label(r.category_id))}</span></div>
      <div class="txn-body"><div class="sub">${esc(FREQS[r.freq] || '')} · ${esc(a ? a.name : '')}${r.auto ? ' · added by itself' : ''}</div><div class="r"><div class="strongv">${r.kind === 'in' ? '+' : '−'}${money(r.amount, c)}</div></div></div>
      ${!r.auto && due ? `<div class="btns" style="margin-top:6px"><button class="btn" data-remdo="${r.id}">Add it</button><button class="btn light" data-remskip="${r.id}">Skip this time</button></div>` : ''}</div>`; }).join('') + `</div></div>`;
}
/* ---- money tab ---- */
const MSECS = [['tx', 'Transactions'], ['recurring', 'Recurring'], ['categories', 'Categories'], ['payees', 'Payees'], ['reports', 'Reports']];
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
  else if (state.msec === 'payees') h += payeesHtml();
  else h += remindersCard() + txListHtml();
  view().innerHTML = h;
  const s = document.getElementById('tx-search'); if (s) { s.oninput = () => { state.txSearch = s.value; clearTimeout(s._t); s._t = setTimeout(() => { const pos = s.selectionStart; render(); const n = document.getElementById('tx-search'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 350); }; }
  const fa = document.getElementById('tx-acct'); if (fa) fa.onchange = () => { state.txAcct = fa.value; render(); };
  const fc = document.getElementById('tx-cat'); if (fc) fc.onchange = () => { state.txCat = fc.value; render(); };
  const ps = document.getElementById('p-sort'); if (ps) ps.onchange = () => { state.psort = ps.value; render(); };
  const pq = document.getElementById('p-search'); if (pq) pq.oninput = () => { state.psearch = pq.value; clearTimeout(pq._t); pq._t = setTimeout(() => { const pos = pq.selectionStart; render(); const n = document.getElementById('p-search'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 350); };
  const fs = document.getElementById('tx-sort'); if (fs) fs.onchange = () => { state.txSort = fs.value; render(); };
}
const TXSORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['big', 'Largest amount'], ['small', 'Smallest amount'], ['payee', 'Payee A–Z'], ['cat', 'Category']];
function txListHtml() {
  const per = state.txPer || 'm', sort = state.txSort || 'new', H = home();
  const ym = state.txMonth || today().slice(0, 7), y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  let from, to, prev, next, label;
  if (per === 'y') { from = `${y}-01-01`; to = `${y}-12-31`; prev = `${y - 1}-${ym.slice(5)}`; next = `${y + 1}-${ym.slice(5)}`; label = String(y); }
  else if (per === 'all') { from = '0000-01-01'; to = '9999-12-31'; label = 'All time'; }
  else { from = ym + '-01'; to = ym + '-31'; prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    label = new Date(ym + '-15T12:00:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'long' }); }
  const accAll = q('SELECT * FROM accounts ORDER BY name'), A = Object.fromEntries(accAll.map(a => [a.id, a])), C = cats(), accts = accAll.filter(a => acctOpen(a) || String(a.id) === String(state.txAcct));
  let sql = 'SELECT * FROM transactions WHERE date>=? AND date<=?', p = [from, to];
  if (state.txAcct) { sql += ' AND (account_id=? OR to_account_id=?)'; p.push(+state.txAcct, +state.txAcct); }
  if (state.txCat === 'none') sql += " AND category_id IS NULL AND kind<>'transfer'";
  else if (state.txCat) { const ids = [+state.txCat].concat(C.rows.filter(c => c.parent_id === +state.txCat).map(c => c.id)); sql += ` AND category_id IN (${ids.map(() => '?').join(',')})`; p.push(...ids); }
  const srch = (state.txSearch || '').trim().toLowerCase();
  let txs = q(sql + ' ORDER BY date DESC, id DESC', p);
  if (srch) txs = txs.filter(t => (t.payee || '').toLowerCase().includes(srch) || (t.note || '').toLowerCase().includes(srch) || C.label(t.category_id).toLowerCase().includes(srch) || String(t.amount).includes(srch));
  const hv = t => conv(t.amount, (A[t.account_id] || {}).currency || H, H) || 0;
  if (sort === 'old') txs.reverse();
  else if (sort === 'big') txs.sort((a, b) => hv(b) - hv(a));
  else if (sort === 'small') txs.sort((a, b) => hv(a) - hv(b));
  else if (sort === 'payee') txs.sort((a, b) => (a.payee || '~').localeCompare(b.payee || '~', 'en', { sensitivity: 'base' }) || (b.date < a.date ? -1 : 1));
  else if (sort === 'cat') txs.sort((a, b) => C.label(a.category_id).localeCompare(C.label(b.category_id)) || (b.date < a.date ? -1 : 1));
  let inn = 0, out = 0;
  for (const t of txs) { if (t.kind === 'transfer') continue; if (t.kind === 'in') inn += hv(t); else out += hv(t); }
  const unsorted = q(`SELECT COUNT(*) n FROM transactions WHERE category_id IS NULL AND kind<>'transfer' AND date>=? AND date<=?${state.txAcct ? ' AND account_id=' + (+state.txAcct) : ''}`, [from, to])[0].n;
  const tops = C.rows.filter(c => !c.parent_id);
  let h = `<h2 class="sect">Transactions</h2><div class="card">
    <div class="segs">${[['m', 'Month'], ['y', 'Year'], ['all', 'All']].map(([k, l]) => `<button class="seg${per === k ? ' on' : ''}" data-txper="${k}">${l}</button>`).join('')}</div>
    <div class="ysel">${prev ? `<button data-txm="${prev}" aria-label="Before">‹</button>` : '<span></span>'}<b>${label}</b>${next ? `<button data-txm="${next}" aria-label="After">›</button>` : '<span></span>'}</div>
    <div class="f2"><label class="f"><span>Account</span><select id="tx-acct"><option value="">All accounts</option>${accts.map(a => `<option value="${a.id}"${String(a.id) === String(state.txAcct || '') ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Category</span><select id="tx-cat"><option value="">All categories</option><option value="none"${state.txCat === 'none' ? ' selected' : ''}>No category yet</option>${tops.map(c => `<option value="${c.id}"${String(c.id) === String(state.txCat || '') ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="f2"><label class="f"><span>Sort</span><select id="tx-sort">${TXSORTS.map(([k, l]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>Search</span><input id="tx-search" value="${esc(state.txSearch || '')}" placeholder="payee, note, amount…" autocomplete="off"></label></div>
    <div class="ie3"><div class="stat"><div class="k">In</div><div class="v up">${whole(inn, H)}</div></div><div class="stat"><div class="k">Out</div><div class="v down">${whole(out, H)}</div></div><div class="stat"><div class="k">Net</div><div class="v ${signCls(inn - out)}">${whole(inn - out, H)}</div></div></div>
    ${unsorted && state.txCat !== 'none' ? `<button class="btn wide light sortcta" data-act="sort-uncat"><b>${unsorted}</b> without a category: choose one for them</button>` : ''}
    <div class="btns"><button class="btn" data-act="add-tx">+ Add transaction</button><button class="btn light" data-act="bank-import"${state.txAcct ? ` data-id="${state.txAcct}"` : ''}>Import bank file</button></div>
    ${txs.length ? `<div class="btns"><button class="btn light" data-act="select-tx">Select several…</button></div>` : ''}</div>`;
  if (!txs.length) return h + `<div class="card empty">${state.txCat === 'none' ? 'Every transaction here has a category ✓' : 'No transactions here' + (srch || state.txCat ? ' with these filters' : '') + '.'}${state.txCat || srch ? '<div class="btns"><button class="btn light" data-act="tx-clear">Show all transactions</button></div>' : ''}</div>`;
  /* headings: the day when sorted by date, the category when sorted by category, none otherwise (each row then shows its date) */
  const byDate = sort === 'new' || sort === 'old', head = t => byDate ? t.date : sort === 'cat' ? C.label(t.category_id) : null;
  let cur = null;
  h += `<div class="card"><div class="txlist">`;
  for (const t of txs) {
    const k = head(t);
    if (k != null && k !== cur) { cur = k; h += `<div class="txday">${byDate ? new Date(k + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: per === 'm' ? undefined : 'numeric' }) : esc(k)}</div>`; }
    h += txRow(t, A, !byDate);
  }
  return h + `</div></div>`;
}
function txRow(t, A, withDate) {
  A = A || Object.fromEntries(q('SELECT * FROM accounts').map(a => [a.id, a]));
  const a = A[t.account_id] || {}, c = a.currency || home(), to = t.to_account_id ? A[t.to_account_id] : null;
  const title = t.kind === 'transfer' ? `Transfer to ${esc(to ? to.name : '?')}` : esc(t.payee || cats().label(t.category_id));
  const sub = (withDate ? `<b class="txdate">${fmtDate(t.date)}</b> · ` : '') + (t.kind === 'transfer' ? esc(a.name || '') + (t.note ? ' · ' + esc(t.note) : '') : `${esc(cats().label(t.category_id))} · ${esc(a.name || '')}${t.note ? ' · ' + esc(t.note) : ''}`);
  const sign = t.kind === 'in' ? '+' : t.kind === 'out' ? '−' : '';
  const pk = state.sel ? `<span class="tick${state.sel.has(t.id) ? ' on' : ''}" aria-hidden="true"></span>` : '';
  const wait = isWaiting(t, t.account_id) ? ' <span class="badge wait" title="Not in a bank file yet">not in bank yet</span>' : '';
  return `<div class="txrow${state.sel && state.sel.has(t.id) ? ' picked' : ''}" data-tx="${t.id}">${pk}<div class="txl"><div class="txt">${title}${wait}${t.recurring_id ? ' <span class="badge">↻</span>' : ''}${t.link ? ' <span class="badge">' + esc(linkLabel(t.link)) + '</span>' : ''}</div><div class="sub">${sub}</div></div>
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
  const all = q('SELECT * FROM accounts ORDER BY name'); if (!all.length) return toast('First add an account under Assets › Accounts.');
  const t0 = id ? q('SELECT * FROM transactions WHERE id=?', [id])[0] : null, keep = t0 ? [t0.account_id, t0.to_account_id] : [];
  const accts = all.filter(a => acctOpen(a) || keep.includes(a.id) || (state.txAcct && a.id === +state.txAcct)); if (!accts.length) accts.push(...all);
  const t = t0 || Object.assign({ kind: 'out', date: today(), account_id: +(state.txAcct || accts[0].id) }, copyOf || {}, preset || {});
  if (copyOf) t.date = today();
  const payees = q("SELECT DISTINCT payee FROM transactions WHERE payee IS NOT NULL AND payee<>'' ORDER BY payee LIMIT 300").map(r => r.payee);
  const rec = t.recurring_id ? q('SELECT * FROM recurring WHERE id=?', [t.recurring_id])[0] : null;
  openSheet(`<h2>${id ? 'Edit' : copyOf ? 'Copy of' : 'New'} transaction</h2>
    <div class="freqs">${Object.entries(KIND_NAME).map(([k, l]) => `<label class="freqo"><input type="radio" name="kind" value="${k}"${k === t.kind ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <div class="f2">${field('amount', 'Amount', t.amount)}${field('date', 'Date', t.date, 'type="date"')}</div>
    <div class="f2"><label class="f"><span id="acct-l">Account</span><select name="account_id">${accts.map(a => `<option value="${a.id}"${a.id === t.account_id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <label class="f" id="to-wrap"><span>To account</span><select name="to_account_id">${accts.map(a => `<option value="${a.id}"${a.id === t.to_account_id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label><label class="f" id="toamt-wrap"><span>Received (in the other account's currency)</span><input name="to_amount" inputmode="decimal" autocomplete="off" value="${t.to_amount != null ? fmtNum(t.to_amount) : ''}" placeholder="worked out from today's rate"></label></div>
    <div id="cat-wrap"><label class="f"><span>Category</span><select name="category_id"></select></label>
    ${field('payee', 'Paid to / received from (optional)', t.payee, 'autocomplete="off" list="payees"')}<datalist id="payees">${payees.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>
    ${field('note', 'Note (optional)', t.note, 'autocomplete="off"')}
    <label class="f"><span>Linked to something you own (optional)</span><select name="link">${linkOptions(t.link || '')}</select></label>
    ${id ? (rec ? `<p class="hint">Part of a repeating transaction (${esc(FREQS[rec.freq])}); change the repeat under Cash flow › Recurring.</p>` : '') : `<div class="f2"><label class="f"><span>Repeat</span><select name="freq"><option value="">Only once</option>${Object.entries(FREQS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="f" id="auto-wrap"><span>Next times</span><select name="auto"><option value="0">Remind me</option><option value="1">Add by itself</option></select></label></div>`}
    ${id && t.account_id && (q('SELECT type FROM accounts WHERE id=?', [t.account_id])[0] || {}).type !== 'cash' ? `<label class="switch"><span>Seen on the bank statement${t.bank_ok === 2 ? ' (from a bank file)' : ''}</span><input type="checkbox" name="bank_ok"${t.bank_ok ? ' checked' : ''}></label>` : ''}
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn light" data-f="dup">Duplicate</button><button class="btn danger" data-f="delete">Delete</button></div>' : ''}`, box => {
    const sync = () => { const k = (box.querySelector('[name=kind]:checked') || {}).value || 'out';
      box.querySelector('#to-wrap').style.display = k === 'transfer' ? '' : 'none';
      { const fa = box.querySelector('[name=account_id]'), ta = box.querySelector('[name=to_account_id]'), cu = id2 => ((accts.find(a => String(a.id) === String(id2)) || {}).currency || home());
        const tw = box.querySelector('#toamt-wrap'); if (tw) tw.style.display = k === 'transfer' && fa && ta && cu(fa.value) !== cu(ta.value) ? '' : 'none'; }
      box.querySelector('#cat-wrap').style.display = k === 'transfer' ? 'none' : '';
      box.querySelector('#acct-l').textContent = k === 'transfer' ? 'From account' : 'Account';
      const cs = box.querySelector('[name=category_id]'), cur = +cs.value || t.category_id; cs.innerHTML = catOptions(k === 'in' ? 'in' : 'out', cur);
      const fr = box.querySelector('[name=freq]'); if (fr) box.querySelector('#auto-wrap').style.display = fr.value ? '' : 'none'; };
    box.querySelectorAll('[name=kind]').forEach(r => r.onchange = sync); ['account_id', 'to_account_id'].forEach(n => { const e2 = box.querySelector(`[name=${n}]`); if (e2) e2.addEventListener('change', sync); }); const fr = box.querySelector('[name=freq]'); if (fr) fr.onchange = sync; sync();
    if (!id && !copyOf) { const am = box.querySelector('[name=amount]'); if (am && !am.value) setTimeout(() => am.focus(), 250); }
    const pe = box.querySelector('[name=payee]');   /* a payee you used before brings back its category */
    if (pe && !id) pe.onchange = () => { const cs = box.querySelector('[name=category_id]'); if (cs.value) return;
      const rl = matchRule(pe.value), last = rl && rl.category_id ? { category_id: rl.category_id, kind: (cats().byId[rl.category_id] || {}).kind === 'in' ? 'in' : 'out' } : q("SELECT category_id, kind FROM transactions WHERE payee=? AND category_id IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1", [pe.value.trim()])[0];
      if (!last) return; const kr = box.querySelector(`[name=kind][value="${last.kind}"]`); if (kr && !kr.checked) { kr.checked = true; sync(); } cs.value = String(last.category_id); };
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'dup') { const cp = Object.assign({}, t); delete cp.id; delete cp.recurring_id; return txForm(null, cp); }
      if (f === 'delete') { ask('Delete this transaction?').then(y => { if (!y) return; run('DELETE FROM transactions WHERE id=?', [id]); save(); closeSheet(); render(); }); return; }
      const d = formData(box), amt = num(d.amount), kind = d.kind || 'out';
      if (!(amt > 0)) return bad('Enter the amount.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return bad('Enter the date.');
      if (kind === 'transfer' && d.to_account_id === d.account_id) return bad('Choose two different accounts.');
      const vals = [+d.account_id, d.date, kind, amt, kind === 'transfer' ? null : (+d.category_id || null), kind === 'transfer' ? (t.payee || null) : (d.payee || '').trim(), (d.note || '').trim(), kind === 'transfer' ? +d.to_account_id : null, d.link || null];
      /* remember this payee for next time: its category, or (an ATM withdrawal made into a transfer) the account it goes to */
      if (vals[5]) { if (kind === 'transfer') { if (t.kind !== 'transfer' && t.payee) learnRule(t.payee, null, vals[7]); } else if (vals[4] && vals[4] !== t.category_id) learnRule(vals[5], vals[4], null); }
      /* 1.27: between two currencies, what arrived (when given) */
      const cuOf = x => ((accts.find(a => a.id === x) || {}).currency || home()), ta0 = num(d.to_amount);
      const toAmount = kind === 'transfer' && cuOf(vals[0]) !== cuOf(vals[7]) && ta0 > 0 ? ta0 : null;
      if (id) { run('UPDATE transactions SET account_id=?,date=?,kind=?,amount=?,category_id=?,payee=?,note=?,to_account_id=?,link=? WHERE id=?', vals.concat([id])); run('UPDATE transactions SET to_amount=? WHERE id=?', [toAmount, id]);
        const bo = box.querySelector('[name=bank_ok]'); if (bo) run('UPDATE transactions SET bank_ok=? WHERE id=?', [bo.checked ? (t.bank_ok || 1) : null, id]); }
      else {
        let rid = null;
        if (d.freq) { run('INSERT INTO recurring(account_id,kind,amount,category_id,payee,note,to_account_id,link,freq,next_date,auto,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)',
          [vals[0], kind, amt, vals[4], vals[5], vals[6], vals[7], vals[8], d.freq, nextDate(d.date, d.freq), +d.auto || 0]); rid = q('SELECT last_insert_rowid() id')[0].id; }
        run('INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,to_account_id,link,recurring_id,created,to_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', vals.concat([rid, Date.now(), toAmount]));
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
  const perMonth = r => r.amount * (({ weekly: 52 / 12, biweekly: 26 / 12 }[r.freq] || 1 / (FREQ_MONTHS[r.freq] || 1)));
  for (const r of rs) if (r.active && r.kind !== 'transfer') { const v = conv(perMonth(r), (A[r.account_id] || {}).currency || H, H) || 0; if (r.kind === 'in') monthlyIn += v; else monthlyOut += v; }
  let h = `<h2 class="sect">Recurring <span class="sub">bills, salary, subscriptions…</span></h2>`;
  if (rs.length) h += `<div class="card"><div class="ie3"><div class="stat"><div class="k">In a month</div><div class="v up">${whole(monthlyIn, H)}</div></div><div class="stat"><div class="k">Out a month</div><div class="v down">${whole(monthlyOut, H)}</div></div><div class="stat"><div class="k">Net</div><div class="v ${signCls(monthlyIn - monthlyOut)}">${whole(monthlyIn - monthlyOut, H)}</div></div></div></div>`;
  h += `<div class="card">` + (rs.length ? `<div class="txns" style="margin-top:0">` + rs.map(r => { const a = A[r.account_id] || {};
    return `<div class="txn ${r.kind === 'in' ? 'inc' : 'cost'}${r.active ? '' : ' off'}" data-rec="${r.id}"><div class="txn-top"><span class="txn-date">${r.active ? 'next ' + fmtDate(r.next_date) : 'ended'}</span><span class="txn-desc">${esc(r.kind === 'transfer' ? 'Transfer' : (r.payee || cats().label(r.category_id)))}</span></div>
      <div class="txn-body"><div class="sub">${esc(FREQS[r.freq])} · ${esc(a.name || '')} · ${r.auto ? 'added by itself' : 'reminder'}</div><div class="r"><div class="strongv">${r.kind === 'in' ? '+' : r.kind === 'out' ? '−' : ''}${money(r.amount, a.currency || H)}</div></div></div></div>`; }).join('') + `</div>`
    : `<p class="sub">Nothing repeats yet. When you add a transaction, choose "Repeat" (every week, 2 weeks, month or year) and whether the app adds it by itself or reminds you.</p>`) +
    `<div class="btns"><button class="btn" data-act="add-tx">+ Add transaction</button><button class="btn light" data-act="find-repeat">Find repeating payments</button></div></div>`;
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
    `<div class="btns" style="padding:0 2px"><button class="btn light" data-act="cat-merge-many">Merge several categories…</button><button class="btn light" data-act="cat-clean">Remove categories nothing uses</button></div>` + rulesHtml() +
    `<p class="sub" style="padding:0 6px">Tap a name to rename, merge or move it. Subcategories go one level deep only, to keep things simple. Savings & investments (like buying metals) are not counted as spending.</p>`;
}
function rulesHtml() {
  const rs = q('SELECT * FROM payee_rules ORDER BY pattern'), A = Object.fromEntries(q('SELECT id, name FROM accounts').map(a => [a.id, a.name]));
  return `<h2 class="sect">Remembered payees <span class="sub">used when you import and type</span></h2><div class="card">` +
    (rs.length ? `<div class="txns" style="margin-top:0">${rs.map(r => `<div class="txn" data-rule="${r.id}"><div class="txn-top"><span class="txn-desc">${esc(r.pattern.toUpperCase())}</span></div>
      <div class="txn-body"><div class="sub">→ ${r.to_account_id ? 'transfer to ' + esc(A[r.to_account_id] || '?') : esc(cats().label(r.category_id))}</div></div></div>`).join('')}</div>`
      : `<p class="sub">None yet. When you give a payee a category, the app remembers it here, and imports use it next time.</p>`) +
    `<div class="btns"><button class="btn light" data-act="add-rule">+ Add one</button></div></div>`;
}
function ruleForm(id) {
  const r = id ? q('SELECT * FROM payee_rules WHERE id=?', [id])[0] : {}, accts = q('SELECT * FROM accounts ORDER BY name').filter(a => acctOpen(a) || a.id === r.to_account_id);
  openSheet(`<h2>${id ? 'Remembered payee' : 'New remembered payee'}</h2>
    ${field('pattern', 'Description contains', r.pattern ? r.pattern.toUpperCase() : '', 'autocomplete="off" placeholder="e.g. METRO or ATM"')}
    <div class="freqs" style="grid-template-columns:1fr 1fr"><label class="freqo"><input type="radio" name="what" value="cat"${r.to_account_id ? '' : ' checked'}><span>Category</span></label><label class="freqo"><input type="radio" name="what" value="acct"${r.to_account_id ? ' checked' : ''}><span>Transfer to an account</span></label></div>
    <label class="f" id="r-cat"><span>Category</span><select name="category_id">${catOptions('any', r.category_id)}</select></label>
    <label class="f" id="r-acct"><span>Account (for example your cash in hand)</span><select name="to_account_id">${accts.map(a => `<option value="${a.id}"${a.id === r.to_account_id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    ${id ? '<div class="btns"><button class="btn danger" data-f="delete">Forget it</button></div>' : ''}`, box => {
    const sync = () => { const w = (box.querySelector('[name=what]:checked') || {}).value; box.querySelector('#r-cat').style.display = w === 'cat' ? '' : 'none'; box.querySelector('#r-acct').style.display = w === 'acct' ? '' : 'none'; };
    box.querySelectorAll('[name=what]').forEach(x => x.onchange = sync); sync();
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'delete') { run('DELETE FROM payee_rules WHERE id=?', [id]); save(); closeSheet(); render(); return; }
      const d = formData(box), pat = normPayee(d.pattern);
      if (!pat) return bad('Type a word from the description.');
      const cat = d.what === 'cat' ? +d.category_id || null : null, acc = d.what === 'acct' ? +d.to_account_id || null : null;
      if (!cat && !acc) return bad(d.what === 'cat' ? 'Choose a category.' : 'Choose an account.');
      if (q('SELECT id FROM payee_rules WHERE pattern=? AND id<>?', [pat, id || -1]).length) return bad('There is already one for this description.');
      if (id) run('UPDATE payee_rules SET pattern=?, category_id=?, to_account_id=? WHERE id=?', [pat, cat, acc, id]);
      else run('INSERT INTO payee_rules(pattern,category_id,to_account_id,created) VALUES(?,?,?,?)', [pat, cat, acc, Date.now()]);
      save(); closeSheet(); render(); };
  });
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
  /* 1.23: money in / money out: every deposit and withdrawal except transfers between your own accounts and balance corrections */
  const flowIn = {}, flowOut = {}, corr = (C.rows.find(c => !c.parent_id && c.name === 'Balance corrections') || {}).id;
  for (const t of q("SELECT kind, amount, account_id, category_id, link FROM transactions WHERE kind IN ('in','out') AND date>=? AND date<=?", [a, b])) {
    if (t.link && t.link.startsWith('property:')) continue;   /* in the property's figures below */
    const top = C.top(t.category_id); if (!top || top.kind !== 'save' || (corr && top.id === corr)) continue;   /* income and spending are added below */
    const v = conv(t.amount, (A[t.account_id] || {}).currency || H, H) || 0, nm = C.label(t.category_id);
    if (t.kind === 'in') flowIn[nm] = (flowIn[nm] || 0) + v; else flowOut[nm] = (flowOut[nm] || 0) + v;
  }
  /* 1.23: rent, other property income and property costs (your share), and estimated interest: the same figures as Overview */
  const m = ieModel(), y0 = a.slice(0, 7), y1 = b.slice(0, 7), addIn = (k, v) => { if (v > 0.005) { inc[k] = (inc[k] || 0) + v; totalIn += v; } };
  for (const [ym, x] of Object.entries(m)) { if (ym < y0 || ym > y1) continue;
    addIn('Rent', x.rent); addIn('Other property income', x.other); addIn('Interest (estimated)', x.interest);
    for (const [kk, v] of Object.entries(x.byKind)) { if (v <= 0.005) continue;
      const name = kk === 'cat:Loans written off' ? 'Loans written off' : kk.startsWith('cat:') ? null : pmeta(kk)[0] + ' (property)';
      if (name) { out[name] = (out[name] || 0) + v; total += v; count++; } } }
  const sum = o => Object.values(o).reduce((x, y) => x + y, 0), moneyIn = totalIn - (inc['Interest (estimated)'] || 0) + sum(flowIn), moneyOut = total + sum(flowOut);
  return { out, inc, total, totalIn, count, payees, big: big.sort((x, y) => y[0] - x[0]), flowIn, flowOut, moneyIn, moneyOut };
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
    <div class="flowbox"><div class="flowh">Money in and out <small class="sub">every deposit and payment, except moves between your own accounts</small></div>
      <div class="ie3"><div class="stat"><div class="k">Money in</div><div class="v up">${whole(cur.moneyIn, H)}</div></div><div class="stat"><div class="k">Money out</div><div class="v down">${whole(cur.moneyOut, H)}</div></div><div class="stat"><div class="k">Net</div><div class="v ${signCls(cur.moneyIn - cur.moneyOut)}">${whole(cur.moneyIn - cur.moneyOut, H)}</div></div></div>
      ${Object.keys(cur.flowIn).length || Object.keys(cur.flowOut).length ? `<div class="alloc">${Object.entries(cur.flowIn).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="arow ie"><span class="al">In: ${esc(k)}</span><span class="av up">${whole(v, H)}</span><span class="ap"></span></div>`).join('')}${Object.entries(cur.flowOut).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="arow ie"><span class="al">Out: ${esc(k)}</span><span class="av down">${whole(v, H)}</span><span class="ap"></span></div>`).join('')}</div><p class="sub" style="margin:6px 0 0">These lines are money in and out, but not income or spending: savings, loans repaid or lent, and moves to accounts not in the app.</p>` : ''}</div>
    ${notes.length ? `<ul class="notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : '<p class="sub">Add transactions to see your reports.</p>'}</div>`;
  h += breakdownHtml(a, b);
  if (sorted.length) h += `<h2 class="sect">Where the money goes</h2><div class="card"><div class="catbars">${sorted.map(([k, v]) => { const pv = prev.out[k] || 0, ch = pv ? v / pv - 1 : null;
    return `<div class="cb"><div class="cbt"><span>${esc(k)}</span><span><b>${whole(v, H)}</b> <small class="sub">${Math.round(v / (cur.total || 1) * 100)}%${ch != null ? ` · <span class="${ch > 0 ? 'down' : 'up'}">${ch > 0 ? '+' : ''}${Math.round(ch * 100)}%</span>` : ''}</small></span></div><div class="cbb"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>`; }).join('')}</div>
    <p class="sub" style="margin:8px 0 0">The % after each one compares with the period before.</p></div>`;
  const inc = Object.entries(cur.inc).sort((x, y) => y[1] - x[1]);
  if (inc.length) h += `<h2 class="sect">Where the money comes from</h2><div class="card"><div class="alloc">${inc.map(([k, v]) => `<div class="arow ie"><span class="al">${esc(k)}</span><span class="av">${whole(v, H)}</span><span class="ap">${Math.round(v / (cur.totalIn || 1) * 100)}%</span></div>`).join('')}</div></div>`;
  const pay = Object.entries(cur.payees).sort((x, y) => y[1] - x[1]).slice(0, 6);
  if (pay.length) h += `<h2 class="sect">Paid to most</h2><div class="card"><div class="alloc">${pay.map(([k, v]) => `<div class="arow ie"><span class="al">${esc(k)}</span><span class="av">${whole(v, H)}</span><span class="ap"></span></div>`).join('')}</div></div>`;
  h += `<button class="btn wide light" data-act="print-report">Print the full report or save it as a PDF</button>`;
  h += `<p class="sub" style="padding:0 6px">Your transactions, plus your properties' rent, income and costs (your share) and estimated interest: the same figures as Overview. Savings and transfers between your accounts are left out.</p>`;
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
    name = 'kjt-finance-transactions-' + today() + '.csv';
  } else if (which === 'assets') {
    rows = [['Kind', 'Name', 'Detail', 'Currency', 'Paid', 'Value now', 'Your share %', 'Your value in ' + H]];
    for (const h of q('SELECT * FROM metal_holdings')) { const s = holdingStats(h); rows.push(['Precious metal', h.description || METAL[h.metal].name, `${METAL[h.metal].name}, ${FORMS[h.form] || 'Coin'}, ${s.oz.toFixed(4)} oz pure, bought ${h.purchase_date || ''}`, h.currency, s.cost != null ? s.cost.toFixed(2) : '', s.value != null ? s.value.toFixed(2) : '', 100, s.valueHome != null ? s.valueHome.toFixed(2) : '']); }
    for (const p of q('SELECT * FROM properties')) { const s = propertyStats(p); rows.push(['Property', p.name, (PROP_TYPES[p.type] || PROP_TYPES.house)[0] + (p.address ? ', ' + p.address : ''), p.currency, s.invested.toFixed(2), s.value.toFixed(2), (s.share * 100).toFixed(2), (conv(s.value * s.share, p.currency, H) || 0).toFixed(2)]); }
    for (const a of q('SELECT * FROM accounts')) { const b = acctBalance(a.id), k = shareOf(a); rows.push([a.type === 'credit' ? 'Credit card' : 'Account', a.name, (ACCT_TYPES[a.type] || '') + (a.institution ? ', ' + a.institution : ''), a.currency, '', b ? b.balance.toFixed(2) : '', (k * 100).toFixed(2), b ? (conv(b.balance * k, a.currency, H) || 0).toFixed(2) : '']); }
    for (const o of q('SELECT * FROM other_assets')) { const v = assetValue(o.id), k = shareOf(o); rows.push(['Other asset', o.name, (ASSET_TYPES[o.type] || ASSET_TYPES.other)[0], o.currency, o.purchase_price, v ? v.value : '', (k * 100).toFixed(2), v ? (conv(v.value * k, o.currency, H) || 0).toFixed(2) : '']); }
    for (const l of q('SELECT * FROM loans')) { const s = loanStats(l); rows.push(['Loan you made', l.person, 'lent ' + l.date + (l.due_date ? ', due ' + l.due_date : '') + (l.closed ? ', repaid' : ''), l.currency, l.amount, s.owed.toFixed(2), 100, (conv(s.owed, l.currency || H, H) || 0).toFixed(2)]); }
    name = 'kjt-finance-assets-' + today() + '.csv';
  } else {
    rows = [['Property', 'Month', 'Rent', 'Other income', 'Costs', 'Net', 'Months empty', 'Your share %', 'Currency']];
    for (const p of q('SELECT * FROM properties')) { const s = propertyStats(p);
      for (const yr of s.rows) for (const f of yr.months) if (f.owned && !f.future) rows.push([p.name, `${f.y}-${String(f.m + 1).padStart(2, '0')}`, f.rent.toFixed(2), f.income.toFixed(2), f.costs.toFixed(2), f.net.toFixed(2), f.empty.toFixed(2), (s.share * 100).toFixed(2), p.currency]); }
    name = 'kjt-finance-property-cashflow-' + today() + '.csv';
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
    <div class="plogo">KJT Finance</div></header>`;
  /* net worth */
  const debt = t.debt || 0, cashOnly = t.cash + debt;
  h += `<h2>Net worth</h2><table><tbody>
    <tr><td>Bank accounts & cash</td>${td(m(cashOnly))}</tr>
    ${debt > 0.005 ? `<tr><td>Owed on credit cards</td>${td('−' + m(debt), 'down')}</tr>` : ''}
    <tr><td>Real estate (your estimate)</td>${td(m(t.re))}</tr>
    <tr><td>Precious metals</td>${td(m(t.metals))}</tr>
    ${t.loans ? `<tr><td>Loans you made (still owed to you)</td>${td(m(t.loans))}</tr>` : ''}
    <tr><td>Other assets</td>${td(m(t.other))}</tr>
    <tr class="tot"><td>Total</td>${td(m(t.total))}</tr></tbody></table>
    ${t.missing ? '<p class="pnote">Some items have no price or exchange rate yet and are left out.</p>' : ''}`;
  /* accounts */
  const as = q('SELECT * FROM accounts ORDER BY type, name');
  if (as.length) {
    h += `<h2>Bank accounts, cash & credit cards</h2><table><thead><tr><th>Account</th><th>As of</th><th class="n">Share</th><th class="n">Balance</th></tr></thead><tbody>` +
      as.map(a => { const b = acctBalance(a.id), v = b ? conv(b.balance * shareOf(a), a.currency || H, H) : null, cr = a.type === 'credit';
        return `<tr><td>${esc(a.name)}<div class="psub">${ACCT_TYPES[a.type] || ''}${a.institution ? ' · ' + esc(a.institution) : ''}${cr && a.credit_limit ? ' · limit ' + money(a.credit_limit, a.currency || H, { dec: 0 }) : ''}${(a.currency || H) !== H && b ? ' · ' + money(b.balance, a.currency) : ''}</div></td>
          <td>${b ? fmtDate(b.date) : ''}</td>${td(shareLbl(a))}${td(m(v), v < 0 ? 'down' : '')}</tr>`; }).join('') + `</tbody></table>`;
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
  /* loans */
  const lns = q('SELECT * FROM loans ORDER BY closed, person');
  if (lns.length) {
    h += `<h2>Loans you made</h2><table><thead><tr><th>Lent to</th><th>Lent on</th><th>Due</th><th class="n">Lent</th><th class="n">Repaid</th><th class="n">Still owed</th></tr></thead><tbody>` +
      lns.map(l => { const s = loanStats(l), c = l.currency || H;
        return `<tr><td>${esc(l.person)}${l.rate ? `<div class="psub">${l.rate}% a year</div>` : ''}</td><td>${fmtDate(l.date)}</td><td class="${s.overdue || s.off ? 'down' : ''}">${s.off ? 'written off' : l.closed ? 'repaid' : l.due_date ? fmtDate(l.due_date) : ''}</td>${td(money(l.amount, c, { dec: 0 }))}${td(money(s.repaid, c, { dec: 0 }))}${td(money(s.owed, c, { dec: 0 }))}</tr>`; }).join('') + `</tbody></table>`;
  }
  /* other assets */
  const os = q('SELECT * FROM other_assets ORDER BY name');
  if (os.length) {
    h += `<h2>Other assets</h2><table><thead><tr><th>Asset</th><th class="n">Share</th><th class="n">Paid</th><th class="n">Value</th></tr></thead><tbody>` +
      os.map(o => { const v = assetValue(o.id), k = shareOf(o), c = o.currency || H;
        return `<tr><td>${esc(o.name)}<div class="psub">${(ASSET_TYPES[o.type] || ASSET_TYPES.other)[0]}${o.purchase_date ? ' · bought ' + fmtDate(o.purchase_date) : ''}</div></td>
          ${td(shareLbl(o))}${td(m(o.purchase_price != null ? conv(o.purchase_price * k, c, H) : null))}${td(m(v ? conv(v.value * k, c, H) : null))}</tr>`; }).join('') + `</tbody></table>`;
  }
  /* income & expenses, last 12 months */
  const model = ieModel();
  if (Object.keys(model).length) {
    const r = ieRange(model, 'L12');
    const inc = [['Your income (transactions)', r.hin], ['Rent', r.rent], ['Other property income', r.other], ['Interest (estimated)', r.interest]].filter(x => x[1] > 0.5);
    const exp = Object.entries(r.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k.startsWith('cat:') ? k.slice(4) : pmeta(k)[0] + ' (property)', v]);
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
  h += `<footer class="pf">Made with KJT Finance ${APP_VERSION} · knowingjesus.today · printed from your own device; nothing was sent anywhere.</footer>`;
  document.getElementById('print').innerHTML = h;
  native('print', { title: 'KJT Finance report ' + now }).then(r => {
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
  const off = l.written_off && l.written_off <= d, left = Math.max(0, l.amount - repaid);
  const owed = l.date > d || off ? 0 : left, lost = l.written_off ? Math.max(0, l.amount - pays.reduce((s, p) => s + (p.principal || 0), 0)) : 0;
  const overdue = !l.closed && owed > 0.005 && l.due_date && l.due_date < today();
  return { pays, repaid, interest, owed, overdue, lost, off: !!l.written_off, paidPct: l.amount ? Math.min(1, repaid / l.amount) : 0 };
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
    return `<div class="txn${l.closed ? ' off' : s.overdue ? ' cost' : ' inc'}" data-loan="${l.id}"><div class="txn-top"><span class="txn-date${s.overdue ? ' warn-t' : ''}">${l.written_off ? 'written off ' + fmtDate(l.written_off) : l.closed ? 'repaid' : l.due_date ? (s.overdue ? 'overdue since ' : 'due ') + fmtDate(l.due_date) : 'lent ' + fmtDate(l.date)}</span><span class="txn-desc">${esc(l.person)}</span></div>
      <div class="txn-body"><div class="sub">lent ${money(l.amount, c, { dec: 0 })}${l.rate ? ' · ' + l.rate + '% a year' : ''}${s.repaid ? ' · repaid ' + money(s.repaid, c, { dec: 0 }) : ''}</div>
      <div class="r">${s.off ? `<div class="strongv down">−${money(s.lost, c)}</div><div class="sub">written off</div>` : `<div class="strongv">${money(s.owed, c)}</div><div class="sub">still owed</div>`}</div></div>${limitBar(s.paidPct).replace('limitbar', 'limitbar paid')}</div>`; });
  { /* 1.30: summary */
    let lent = 0, repaid = 0, interest = 0, lost = 0, over = 0, overN = 0, soon = 0, soonN = 0; const in30 = dstr(dnum(today()) + 30);
    for (const l of ls) { const s2 = loanStats(l), c = l.currency || H, cv = v => conv(v, c, H) || 0;
      lent += cv(l.amount); repaid += cv(s2.repaid); interest += cv(s2.interest || 0); if (s2.off) lost += cv(s2.lost);
      if (!l.closed && s2.overdue) { over += cv(s2.owed); overN++; } else if (!l.closed && l.due_date && l.due_date <= in30) { soon += cv(s2.owed); soonN++; } }
    h += ls.length ? secSummary({ label: `Owed to you (${H})`, big: whole(open, H), sub: [`${n} open loan${n === 1 ? '' : 's'} · ${ls.length - n} closed`],
      stats: [['Lent in all', whole(lent, H)], ['Repaid so far', whole(repaid, H), 'up'], ['Interest received', whole(interest, H), interest ? 'up' : '']],
      rows: [overN ? [`<span class="warn-t">Overdue</span>`, whole(over, H), 'down', `${overN} loan${overN > 1 ? 's' : ''}`] : null, soonN ? ['Due in the next 30 days', whole(soon, H), '', `${soonN} loan${soonN > 1 ? 's' : ''}`] : null, lost ? ['Written off', '−' + whole(lost, H), 'down', 'lent and not coming back'] : null].filter(Boolean),
      foot: [lent ? `${Math.round(repaid / lent * 100)}% of all you lent has come back` : ''] }) : '';
  }
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
    <div class="big ${s.overdue || s.off ? 'down' : ''}">${s.off ? '−' + money(s.lost, c) : money(s.owed, c)}</div><div class="sub">${s.off ? 'written off on ' + fmtDate(l.written_off) + ': not counted in your total any more' : l.closed ? 'repaid in full' : 'still owed'}${l.due_date ? ' · due ' + fmtDate(l.due_date) : ''}${s.overdue ? ' · <b class="down">overdue</b>' : ''}</div>
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
  const accts = q("SELECT * FROM accounts WHERE type<>'credit' ORDER BY name").filter(acctOpen);
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
    ${id ? `<div class="btns">${l.written_off ? '<button class="btn light" data-f="unwrite">Undo the write-off</button>' : (l.closed ? '' : '<button class="btn light" data-f="writeoff">Write off: I don\'t expect it back</button>')}<button class="btn danger" data-f="delete">Delete loan</button></div>
      <p class="hint">Writing off keeps the loan in your records but stops counting it in your total; what was not repaid shows as a loss in Income & expenses.</p>` : ''}`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'writeoff') { ask(`Write off what ${l.person} still owes? You can undo this later.`, 'Write it off').then(y => { if (!y) return;
        run('UPDATE loans SET written_off=?, closed=1 WHERE id=?', [today(), id]); save(); closeSheet(); render(); }); return; }
      if (f === 'unwrite') { run('UPDATE loans SET written_off=NULL, closed=0 WHERE id=?', [id]); save(); closeSheet(); render(); return; }
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
  const s = loanStats(l), c = l.currency || home(), accts = q("SELECT * FROM accounts WHERE type<>'credit' ORDER BY name").filter(acctOpen);
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
function prepareImport(parsed, accountId, opts) {
  opts = opts || {};
  const a = q('SELECT * FROM accounts WHERE id=?', [accountId])[0], credit = a && a.type === 'credit';
  const have = q('SELECT * FROM transactions WHERE account_id=? OR to_account_id=?', [accountId, accountId]);
  const refs = new Set(have.flatMap(t => [t.import_id, t.import_id2]).filter(Boolean)), used = new Set(), mem = payeeMemory(), cardPay = transferCat(), rules = payeeRules(), cash = cashAccount(accountId);
  const seen = {}, rows = [];
  /* 1.19: the same amount going the other way in another of your accounts within 3 days = a transfer */
  const ds = parsed.txs.map(x => x.date).sort(), pairUsed = new Set(), acur = (a && a.currency) || home();
  const others = ds.length ? q("SELECT t.*, COALESCE(o.currency, ?) acur FROM transactions t JOIN accounts o ON o.id=t.account_id WHERE t.account_id<>? AND t.kind IN ('in','out') AND t.date>=? AND t.date<=?",
    [home(), accountId, dstr(dnum(ds[0]) - 3), dstr(dnum(ds[ds.length - 1]) + 3)]) : [];
  const xlike = t => XFER_RE.test((t.payee || '') + ' ' + (t.note || t.memo || '')) && !ETR_RE.test((t.payee || '') + ' ' + (t.note || t.memo || ''));
  for (const x of parsed.txs) {
    const base = `${x.date}|${x.amount.toFixed(2)}|${normPayee(x.payee)}`; seen[base] = (seen[base] || 0) + 1;
    const iid = x.ref ? `ref:${parsed.acctId || ''}:${x.ref}` : `h:${base}|${seen[base]}`;
    let dup = refs.has(iid);
    if (!dup) {   /* typed in by hand before: same account, same amount, within 3 days, not imported */
      const kind = x.amount >= 0 ? 'in' : 'out', abs = Math.abs(x.amount);
      const own = t => !t.import_id || String(t.import_id).startsWith('mmex:');
      const hit = have.find(t => own(t) && !used.has(t.id) && Math.abs(t.amount - abs) < 0.005 && Math.abs(dnum(t.date) - dnum(x.date)) <= 3 &&
        (t.kind === kind || (t.kind === 'transfer' && ((kind === 'out' && t.account_id === accountId) || (kind === 'in' && t.to_account_id === accountId)))));
      if (hit) { used.add(hit.id); dup = 'match'; x.matchId = hit.id; }
      /* already imported from another kind of file (a CSV after an OFX…): same day, same amount, same payee */
      else if (have.some(t => t.import_id && !own(t) && !used.has(t.id) && Math.abs(dnum(t.date) - dnum(x.date)) <= 3 && Math.abs(t.amount - abs) < 0.005 && firstWord(t.payee) === firstWord(x.payee) && used.add(t.id))) dup = true;
      /* same amount within a week of something you entered (or brought from MMEX): maybe the same; you decide */
      else { const mb = have.find(t => own(t) && !used.has(t.id) && Math.abs(t.amount - abs) < 0.005 && Math.abs(dnum(t.date) - dnum(x.date)) <= 7);
        if (mb) { used.add(mb.id); dup = 'maybe'; x.maybe = mb; } }
    }
    if (!dup && opts.cutoff && x.date <= opts.cutoff) dup = 'before';
    const kind = x.amount >= 0 ? 'in' : 'out', rule = matchRule(x.payee, rules);
    let cat = null, transferTo = null;
    if (rule && rule.to_account_id && rule.to_account_id !== accountId && q('SELECT id FROM accounts WHERE id=?', [rule.to_account_id]).length) transferTo = rule.to_account_id;
    else if (rule && rule.category_id) cat = rule.category_id;
    /* cash taken out at an ATM goes into your cash account: it is not spending */
    /* 1.15: ATM withdrawals are no longer moved to a cash account by themselves (only when you made a remembered payee for it) */
    if (!cat && !transferTo) cat = mem.get(x.payee);
    if (!cat && credit && kind === 'in') cat = cardPay;   /* a payment to the card is not income */
    if (!cat && !credit && kind === 'out' && /\b(visa|master ?card|amex|american express|credit card|card payment)\b/i.test(x.payee + ' ' + (x.memo || ''))) cat = cardPay;   /* paying your card from the bank */
    if (!cat && kind === 'in' && /\binter[eê]ts?\b|\binterest\b/i.test(x.payee + ' ' + (x.memo || ''))) cat = interestCat();
    let pair = null;
    if (!dup && !transferTo && !opts.noPairs) {
      const want = x.amount < 0 ? 'in' : 'out', abs = Math.abs(x.amount);
      pair = others.filter(t => !pairUsed.has(t.id) && t.kind === want && t.acur === acur && Math.abs(t.amount - abs) < 0.005 && Math.abs(dnum(t.date) - dnum(x.date)) <= 3)
        .sort((p1, p2) => Math.abs(dnum(p1.date) - dnum(x.date)) - Math.abs(dnum(p2.date) - dnum(x.date)))[0] || null;
      if (pair) pairUsed.add(pair.id);
    }
    const xc = transferCat(), likely = !!pair && (xlike(x) || xlike(pair) || (xc && (pair.category_id === xc || cat === xc)) || !pair.category_id);
    rows.push(Object.assign({}, x, { iid, dup, kind: transferTo ? 'transfer' : kind, cat: transferTo ? null : cat, transferTo, pair, linkPair: likely, xlike: !pair && !transferTo && xlike(x) }));
  }
  return { rows, account: a };
}
/* writes one statement into one account; the caller wraps it in BEGIN / COMMIT */
function commitImport(parsed, id, prep) {
  prep = prep || prepareImport(parsed, id, { cutoff: lastOwnDate(id) });
  const a = prep.account, now = Date.now(), dates = parsed.txs.map(x => x.date).sort(); let n = 0, newCash = null;
  for (const r of prep.rows) {
    if (r.dup === 'match') {   /* your own entry, now confirmed by the bank (an MMEX entry keeps its MMEX number) */
      const m = q('SELECT account_id, to_account_id, kind FROM transactions WHERE id=?', [r.matchId])[0];
      if (m && m.kind === 'transfer' && m.to_account_id === id && m.account_id !== id) run('UPDATE transactions SET import_id2=? WHERE id=? AND import_id2 IS NULL', [r.iid, r.matchId]);
      else { run('UPDATE transactions SET import_id=? WHERE id=? AND import_id IS NULL', [r.iid, r.matchId]); run('UPDATE transactions SET bank_ok=2 WHERE id=?', [r.matchId]); }
      continue; }
    if (r.dup && !(r.dup === 'maybe' && r.include)) continue;
    let from = id, to = null;
    if (r.transferTo) {
      const dest = r.transferTo;
      if (!dest || dest === 'new') { r.kind = r.amount < 0 ? 'out' : 'in'; r.transferTo = null; }   /* 1.15: never makes a cash account by itself */
      else if (r.amount < 0) { from = id; to = dest; } else { from = dest; to = id; }
    }
    if (r.pair && r.linkPair) {   /* 1.19: one transfer instead of two entries */
      const note = [r.payee, r.pair.payee].filter(Boolean).filter((v, k, arr) => arr.indexOf(v) === k).join(' · ').slice(0, 200);
      if (r.amount < 0) {
        run("INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,to_account_id,created,import_id,import_id2,bank_ok) VALUES(?,?,'transfer',?,NULL,?,?,?,?,?,?,2)",
          [id, r.date, Math.abs(r.amount), String(r.payee || '').slice(0, 120), note, r.pair.account_id, now, r.iid, r.pair.import_id || null]);
        run('DELETE FROM transactions WHERE id=?', [r.pair.id]);
      } else run("UPDATE transactions SET kind='transfer', to_account_id=?, category_id=NULL, note=?, import_id2=? WHERE id=?", [id, note, r.iid, r.pair.id]);
      n++; continue;
    }
    const toSide = to === id;   /* money came in from a remembered account: the bank line belongs to the receiving side */
    run('INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,to_account_id,link,recurring_id,created,import_id,import_id2,bank_ok) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [from, r.date, r.kind, Math.abs(r.amount), r.cat, String(r.payee || '').slice(0, 120), (r.memo || '').slice(0, 200), to, null, null, now, toSide ? null : r.iid, toSide ? r.iid : null, toSide ? null : 2]); n++;
  }
  if (newCash) toastLater = 'A "Cash in hand" account was made for your ATM withdrawals.';
  if (parsed.balance != null) {
    const bd = parsed.balDate || dates[dates.length - 1] || today(), bv = a.type === 'credit' ? Math.abs(parsed.balance) : parsed.balance;
    if (!q('SELECT id FROM account_balances WHERE account_id=? AND date=? AND ABS(balance-?)<0.005', [id, bd, bv]).length)
      run('INSERT INTO account_balances(account_id,date,balance,note,created) VALUES(?,?,?,?,?)', [id, bd, bv, 'From the bank file', now + 1]);
  }
  return n;
}
/* a file with several accounts (chequing, savings, credit cards): each part goes to its own account */
function parseOfxAll(t) {
  const parts = [], re = /<(CC)?STMTRS>([\s\S]*?)(?:<\/(?:CC)?STMTRS>|(?=<(?:CC)?STMTRS>)|$)/gi; let m;
  while ((m = re.exec(t))) { const p = parseOfx((m[1] ? '<CCSTMTRS>' : '<STMTRS>') + m[2]); p.kindHint = (ofxTag(m[2], 'ACCTTYPE') || '').toUpperCase(); parts.push(p); }
  return parts.length ? parts : [parseOfx(t)];
}
let toastLater = '';
const tail4 = s => s ? '…' + String(s).replace(/\s/g, '').slice(-4) : '';
function multiReview(parts) {
  let map = {}; try { map = JSON.parse(getSetting('import_map', '{}')) || {}; } catch (e) { map = {}; }
  const accts = () => q('SELECT * FROM accounts ORDER BY name').filter(a => acctOpen(a) || Object.values(map).includes(a.id));
  const guess = p => { if (p.acctId && map[p.acctId] && accts().some(a => a.id === map[p.acctId])) return String(map[p.acctId]); return 'new'; };
  const label = p => (p.credit ? 'Credit card' : p.kindHint === 'SAVINGS' ? 'Savings' : p.kindHint === 'CREDITLINE' ? 'Line of credit' : 'Chequing') + ' ' + tail4(p.acctId);
  openSheet(`<h2>Import ${parts.length} accounts</h2><p class="sub">Your bank put several accounts in this file. Choose where each one goes; the app remembers it for next time.</p>
    ${parts.map((p, i) => `<div class="mpart"><div class="mph"><b>${esc(label(p))}</b> <span class="sub">${p.txs.length} transaction${p.txs.length === 1 ? '' : 's'}${p.balance != null ? ' · balance ' + money(p.credit ? Math.abs(p.balance) : p.balance, p.currency || home()) : ''}</span></div>
      <select name="to${i}"><option value="new">New account: ${esc(label(p))}</option><option value="skip">Skip this one</option>${accts().map(a => `<option value="${a.id}">${esc(a.name)}${a.type === 'credit' ? ' (credit card)' : ''}</option>`).join('')}</select>
      <div class="sub mps" id="mps${i}"></div></div>`).join('')}
    <div class="btns"><button class="btn" data-f="go">Import all</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    parts.forEach((p, i) => { box.querySelector(`[name=to${i}]`).value = guess(p); });
    const show = () => parts.forEach((p, i) => { const v = box.querySelector(`[name=to${i}]`).value, el = box.querySelector('#mps' + i);
      if (v === 'skip') el.textContent = 'Not imported.';
      else if (v === 'new') el.textContent = `A new account is made with all ${p.txs.length}.`;
      else { const pr = prepareImport(p, +v, { cutoff: lastOwnDate(+v) }), fresh = pr.rows.filter(r => !r.dup).length, mb = pr.rows.filter(r => r.dup === 'maybe').length, bf = pr.rows.filter(r => r.dup === 'before').length;
        el.textContent = `${fresh} new, ${pr.rows.length - fresh - mb - bf} already there${bf ? ', ' + bf + ' before ' + fmtDate(lastOwnDate(+v)) : ''}${mb ? ', ' + mb + ' possible duplicates left out (import this account alone to review them)' : ''}.`; } });
    box.onchange = show; show();
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      let n = 0, accN = 0; const done = [];
      db.exec('BEGIN');
      try {
        parts.forEach((p, i) => { let v = box.querySelector(`[name=to${i}]`).value; if (v === 'skip') return;
          if (v === 'new') { run('INSERT INTO accounts(name,type,currency,owners,share_pct) VALUES(?,?,?,1,100)', [label(p), p.credit ? 'credit' : p.kindHint === 'SAVINGS' ? 'savings' : 'chequing', p.currency || home()]); v = q('SELECT last_insert_rowid() id')[0].id; }
          n += commitImport(p, +v); accN++; done.push(+v); if (p.acctId) map[p.acctId] = +v; });
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); return bad('Import failed: ' + err.message); }
      setSetting('import_map', JSON.stringify(map)); save(); closeSheet(); offerTransfersSoon();
      const diffs = done.map(id => lastReconText(id)).filter(s => s.includes('differs')).length;
      toast(`${n} transaction${n === 1 ? '' : 's'} imported into ${accN} account${accN === 1 ? '' : 's'}` + (diffs ? ` · ${diffs} balance${diffs > 1 ? 's differ' : ' differs'} from your transactions` : ' · balances updated'));
      state.tab = 'accounts'; state.accountId = null; render(); view().scrollTop = 0; };
  });
}
/* ---- remembered payees ----
   Every time you give a payee a category (one transaction or several), the app remembers it as a rule;
   turning a withdrawal into a transfer to an account (ATM -> Cash in hand) is remembered too.
   Imports use the rules first. You can see, change and delete them under Cash flow > Categories. */
const ATM_RE = /\b(atm|abm|gab|retrait|guichet|withdrawal|cash withdrawal|wdl)\b/i;
function payeeRules() { return q('SELECT * FROM payee_rules ORDER BY LENGTH(pattern) DESC'); }
function matchRule(payee, rules) {
  const n = normPayee(payee); if (!n) return null;
  return (rules || payeeRules()).find(r => n === r.pattern || (r.pattern.length >= 4 && n.includes(r.pattern))) || null;
}
function learnRule(payee, catId, toAcct) {
  const pat = normPayee(payee); if (!pat || pat.length < 2 || (!catId && !toAcct)) return;
  const ex = q('SELECT id FROM payee_rules WHERE pattern=?', [pat])[0];
  if (ex) run('UPDATE payee_rules SET category_id=?, to_account_id=? WHERE id=?', [catId || null, toAcct || null, ex.id]);
  else run('INSERT INTO payee_rules(pattern,category_id,to_account_id,created) VALUES(?,?,?,?)', [pat, catId || null, toAcct || null, Date.now()]);
}
function cashAccount(exceptId) { return q("SELECT * FROM accounts WHERE type='cash' AND id<>? ORDER BY id LIMIT 1", [exceptId || -1])[0] || null; }
/* the last day of what you entered yourself or brought from MMEX: bank lines up to that day are already there */
function lastOwnDate(accountId) { const r = q("SELECT MAX(date) d FROM transactions WHERE (account_id=? OR to_account_id=?) AND (import_id IS NULL OR import_id LIKE 'mmex:%')", [accountId, accountId])[0]; return r && r.d; }
function transferCat() { const r = cats().rows.find(c => !c.parent_id && c.name === 'Transfers & card payments'); return r ? r.id : null; }
/* ---- the screens ---- */
async function bankImport(accountId) {
  if (!q('SELECT COUNT(*) n FROM accounts')[0].n) return toast('First add the account (Assets › Accounts), then import its bank file.');
  const r = await native('importDb', { title: 'Choose the file from your bank', filter: 'bank' });
  if (!r.b64) { if (r.error) toast('Could not open the file: ' + r.error); return; }
  const t = bankText(b64ToBytes(r.b64));
  let parsed;
  if (/<OFX>|OFXHEADER/i.test(t)) { const parts = parseOfxAll(t).filter(p => p.txs.length || p.balance != null); if (parts.length > 1) return multiReview(parts); parsed = parts[0] || parseOfx(t); }
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
  let map0 = {}; try { map0 = JSON.parse(getSetting('import_map', '{}')) || {}; } catch (e) { map0 = {}; }
  const accts = q('SELECT * FROM accounts ORDER BY name').filter(a => acctOpen(a) || a.id === +accountId || a.id === (parsed.acctId && map0[parsed.acctId]));
  let map = {}; try { map = JSON.parse(getSetting('import_map', '{}')) || {}; } catch (e) { map = {}; }
  let acc = accountId || (parsed.acctId && map[parsed.acctId]) || (accts.find(a => parsed.credit ? a.type === 'credit' : a.type !== 'credit') || accts[0]).id;
  if (!accts.some(a => a.id === +acc)) acc = accts[0].id;
  const dates = parsed.txs.map(x => x.date).sort();
  openSheet(`<h2>Import ${parsed.format} file</h2>
    <label class="f"><span>Into which account?</span><select name="acct">${accts.map(a => `<option value="${a.id}"${a.id === +acc ? ' selected' : ''}>${esc(a.name)}${a.type === 'credit' ? ' (credit card)' : ''}</option>`).join('')}</select></label>
    <div id="cut-wrap"><label class="switch"><span>Only add what is after <input type="date" name="cut"></span><input type="checkbox" name="usecut"></label>
      <p class="hint" style="margin-top:0">Up to that day the account already has its transactions (typed in or from MMEX), so nothing is doubled.</p></div>
    <div id="imp-sum"></div>
    <div class="btns"><button class="btn" data-f="go">Import</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    let prep = null, lastAcct = null, pairChoice = {};
    const show = () => {
      const id = +box.querySelector('[name=acct]').value, cutEl = box.querySelector('[name=cut]'), useEl = box.querySelector('[name=usecut]');
      if (id !== lastAcct) { lastAcct = id; pairChoice = {}; box.querySelectorAll('[data-pairx]').forEach(x => x.remove()); const lo = lastOwnDate(id); cutEl.value = lo || ''; useEl.checked = !!lo; box.querySelector('#cut-wrap').style.display = lo ? '' : 'none'; }
      prep = prepareImport(parsed, id, { cutoff: useEl.checked && cutEl.value ? cutEl.value : null });
      box.querySelectorAll('[data-pairx]').forEach(x => { pairChoice[+x.dataset.pairx] = x.checked; });
      prep.rows.forEach((r, i) => { if (r.pair && i in pairChoice) r.linkPair = pairChoice[i]; });
      const keepMaybe = new Set(Array.from(box.querySelectorAll('[data-maybe]:checked')).map(x => +x.dataset.maybe));
      prep.rows.forEach((r, i) => { if (r.dup === 'maybe' && keepMaybe.has(i)) r.include = true; });
      const maybes = prep.rows.map((r, i) => [r, i]).filter(([r]) => r.dup === 'maybe'), before = prep.rows.filter(r => r.dup === 'before').length;
      const a = prep.account, c = a.currency || home(), fresh = prep.rows.filter(r => !r.dup), dup = prep.rows.length - fresh.length - maybes.length - before;
      const guessed = fresh.filter(r => r.cat || r.transferTo).length, atm = fresh.filter(r => r.transferTo).length, cashA = cashAccount(id);
      box.querySelector('#imp-sum').innerHTML = `<div class="ie3"><div class="stat"><div class="k">New</div><div class="v">${fresh.length}</div></div><div class="stat"><div class="k">Already here</div><div class="v">${dup}</div></div><div class="stat"><div class="k">Categorised</div><div class="v">${guessed}</div></div></div>
        <p class="sub" style="margin:8px 0">${fmtDate(dates[0])} to ${fmtDate(dates[dates.length - 1])}${parsed.balance != null ? ` · balance in the file: <b>${money(a.type === 'credit' ? Math.abs(parsed.balance) : parsed.balance, c)}</b>${a.type === 'credit' ? ' owed' : ''} on ${fmtDate(parsed.balDate || dates[dates.length - 1])}` : ''}</p>
        ${parsed.currency && a.currency && parsed.currency !== a.currency ? `<div class="warn">The file is in ${esc(parsed.currency)} but this account is in ${esc(a.currency)}.</div>` : ''}
        ${fresh.length ? `<div class="preview">${fresh.slice(0, 6).map(r => `${fmtDate(r.date)} · ${esc((r.payee || '').slice(0, 26))} · <span class="${r.amount < 0 ? 'down' : 'up'}">${r.amount < 0 ? '−' : '+'}${money(Math.abs(r.amount), c)}</span>${r.cat ? ' · <i>' + esc(cats().label(r.cat)) + '</i>' : ''}`).join('<br>')}${fresh.length > 6 ? '<br>…and ' + (fresh.length - 6) + ' more' : ''}</div>` : '<p class="sub">Everything in this file is already in the app.</p>'}
        ${(() => { const ps = prep.rows.map((r, i) => [r, i]).filter(([r]) => !r.dup && r.pair), A2 = Object.fromEntries(q('SELECT id, name FROM accounts').map(x => [x.id, x.name])), lo = prep.rows.filter(r => !r.dup && r.xlike).length;
          return (ps.length ? `<h3 class="ieh">Transfers between your accounts: ticked ones become one transfer</h3><div class="maybes">${ps.map(([r, i]) => `<label class="maybe"><input type="checkbox" data-pairx="${i}"${r.linkPair ? ' checked' : ''}>
            <span><b>${money(Math.abs(r.amount), c)} ${r.amount < 0 ? '→ ' + esc(A2[r.pair.account_id] || '?') : '← ' + esc(A2[r.pair.account_id] || '?')}</b><br><small>${fmtDate(r.date)} ${esc((r.payee || '').slice(0, 26))} · there: ${fmtDate(r.pair.date)} ${esc((r.pair.payee || '').slice(0, 22))}</small></span></label>`).join('')}</div>` : '')
            + (lo ? `<p class="sub" style="margin:0 0 8px">🔁 <b>${lo}</b> look${lo === 1 ? 's' : ''} like a transfer with no other side yet (BR TO BR…). After the import, say where ${lo === 1 ? 'it' : 'each'} went under Reconcile.</p>` : ''); })()}
        ${atm ? `<p class="sub" style="margin:0 0 8px">💵 <b>${atm}</b> cash withdrawal${atm > 1 ? 's go' : ' goes'} to ${cashA ? esc(cashA.name) : 'a new "Cash in hand" account'}: moving money to your wallet is not spending.</p>` : ''}
        ${before ? `<p class="sub" style="margin:0 0 8px"><b>${before}</b> up to ${fmtDate(box.querySelector('[name=cut]').value)} left out (already in the account).</p>` : ''}
        ${maybes.length ? `<h3 class="ieh">Possible duplicates: not added unless you tick them</h3><div class="maybes">${maybes.map(([r, i]) => `<label class="maybe"><input type="checkbox" data-maybe="${i}"${r.include ? ' checked' : ''}>
          <span><b>${fmtDate(r.date)} ${esc((r.payee || '').slice(0, 24))} ${money(Math.abs(r.amount), c)}</b><br><small>looks like ${fmtDate(r.maybe.date)} ${esc(r.maybe.payee || cats().label(r.maybe.category_id))}</small></span></label>`).join('')}</div>` : ''}
        <p class="hint">Transactions without a category can be sorted later: tap one under Cash flow. Next time, the same payee gets the same category by itself.</p>`;
      const nIn = fresh.length + maybes.filter(([r]) => r.include).length;
      box.querySelector('[data-f=go]').textContent = nIn ? `Import ${nIn}` : 'Update the balance only';
    };
    box.onchange = show; show();
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      const id = +box.querySelector('[name=acct]').value; let n = 0;
      db.exec('BEGIN');
      try { n = commitImport(parsed, id, prep); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); return bad('Import failed: ' + err.message); }
      if (parsed.acctId) { map[parsed.acctId] = id; setSetting('import_map', JSON.stringify(map)); }
      save(); closeSheet(); offerTransfersSoon(); toast((n ? n + ' transaction' + (n > 1 ? 's' : '') + ' imported' : 'Nothing new; balance updated') + (parsed.balance != null ? lastReconText(id) : '')); if (toastLater) { const m = toastLater; toastLater = ''; setTimeout(() => toast(m), 2600); }
      state.tab = 'accounts'; state.accountId = id; render(); view().scrollTop = 0; };
  });
}

/* ---------------- 1.24: the breakdown report ----------------
   Deposits and payments side by side, grouped by category, subcategory, payee, account or month, or every transaction,
   as a table (totals at the bottom), as bars, or as a pie. All accounts: moves between your own accounts are left out
   (they cancel out). One account: everything in and out of it, like a bank statement, in its own currency. */
const BD_BY = [['cat', 'Category'], ['sub', 'Subcategory'], ['payee', 'Payee'], ['acct', 'Account'], ['month', 'Month'], ['tx', 'Every transaction']];
const BD_VIEW = [['table', 'Table'], ['bars', 'Bars'], ['pie', 'Pie']];
function breakdownData(a, b) {
  const H = home(), C = cats(), A = Object.fromEntries(q('SELECT * FROM accounts').map(x => [x.id, x]));
  const one = state.bdAcct ? +state.bdAcct : null, cur = one ? ((A[one] || {}).currency || H) : H, what = state.bdWhat || 'all', by = state.bdBy || 'cat';
  const txs = one ? q("SELECT * FROM transactions WHERE (account_id=? OR to_account_id=?) AND date>=? AND date<=? ORDER BY date DESC, id DESC", [one, one, a, b])
    : q("SELECT * FROM transactions WHERE kind IN ('in','out') AND date>=? AND date<=? ORDER BY date DESC, id DESC", [a, b]);
  const groups = new Map(), rows = []; let dep = 0, pay = 0;
  for (const t of txs) {
    let v;   /* + deposit, − payment */
    if (one) v = txEffect(t, one, cur);
    else { const c = (A[t.account_id] || {}).currency || H; v = (c === H ? t.amount : conv(t.amount, c, H) || 0) * (t.kind === 'in' ? 1 : -1); }
    if (!v) continue;
    const top = C.top(t.category_id);
    if (what === 'ie' && (t.kind === 'transfer' || (top && top.kind === 'save'))) continue;
    if (v > 0) dep += v; else pay -= v;
    if (by === 'tx') { rows.push({ k: t.payee || (t.kind === 'transfer' ? 'Transfer' : C.label(t.category_id)), date: t.date, sub: t.kind === 'transfer' ? (t.account_id === one ? 'to ' + ((A[t.to_account_id] || {}).name || '') : 'from ' + ((A[t.account_id] || {}).name || '')) : C.label(t.category_id), dep: v > 0 ? v : 0, pay: v < 0 ? -v : 0, id: t.id }); continue; }
    const key = by === 'cat' ? (t.kind === 'transfer' ? 'Transfers between your accounts' : top ? top.name : 'No category')
      : by === 'sub' ? (t.kind === 'transfer' ? 'Transfers between your accounts' : t.category_id ? C.label(t.category_id) : 'No category')
      : by === 'payee' ? (t.payee ? nicePayee(t.payee) : '(no payee)')
      : by === 'acct' ? ((A[t.account_id] || {}).name || '?')
      : t.date.slice(0, 7);
    const g = groups.get(key) || { k: key, dep: 0, pay: 0, n: 0 }; if (v > 0) g.dep += v; else g.pay -= v; g.n++; groups.set(key, g);
  }
  const list = by === 'tx' ? rows : [...groups.values()].sort(by === 'month' ? (x, y) => (x.k < y.k ? 1 : -1) : (x, y) => (y.pay - x.pay) || (y.dep - x.dep));
  return { list, dep, pay, cur, one, by };
}
function breakdownHtml(a, b) {
  state.bdBy = state.bdBy || 'cat'; state.bdView = state.bdView || 'table'; state.bdMeasure = state.bdMeasure || 'pay';
  const D = breakdownData(a, b), c = D.cur, accts = q('SELECT id, name FROM accounts ORDER BY name');
  const sel = (key, opts, val) => `<select data-bd="${key}">${opts.map(([k, l]) => `<option value="${k}"${String(val) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  let h = `<h2 class="sect">Breakdown <span class="sub">deposits and payments</span></h2><div class="card">
    <div class="f2"><label class="f"><span>Group by</span>${sel('bdBy', BD_BY, state.bdBy)}</label><label class="f"><span>Account</span>${sel('bdAcct', [['', 'All accounts']].concat(accts.map(x => [x.id, x.name])), state.bdAcct || '')}</label></div>
    <div class="f2"><label class="f"><span>Include</span>${sel('bdWhat', [['all', 'Everything'], ['ie', 'Income and spending only']], state.bdWhat || 'all')}</label>
      <div class="f"><span>Show as</span><div class="segs" style="margin-top:4px">${BD_VIEW.map(([k, l]) => `<button class="seg${state.bdView === k ? ' on' : ''}" data-act="bd-view" data-v="${k}">${l}</button>`).join('')}</div></div></div>`;
  if (!D.list.length) return h + '<p class="sub">Nothing in this period.</p></div>';
  if (state.bdView === 'table' || D.by === 'tx') {
    const cap = 400, shown = D.list.slice(0, cap), tx = D.by === 'tx';
    h += `<div class="dpwrap"><table class="dptab"><thead><tr>${tx ? '<th>Date</th>' : ''}<th>${tx ? 'Description' : esc((BD_BY.find(x => x[0] === D.by) || [])[1] || '')}</th><th class="n">Deposits</th><th class="n">Payments</th></tr></thead><tbody>
      ${shown.map(r => `<tr${tx ? ` data-tx="${r.id}" class="tap"` : ''}>${tx ? `<td class="dd">${fmtDate(r.date)}</td>` : ''}<td>${esc(D.by === 'month' ? new Date(r.k + '-15T12:00:00').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }) : r.k)}${tx && r.sub ? `<br><small class="sub">${esc(r.sub)}</small>` : !tx ? ` <small class="sub">${r.n}</small>` : ''}</td>
        <td class="n up">${r.dep ? money(r.dep, c) : ''}</td><td class="n down">${r.pay ? money(r.pay, c) : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td${tx ? ' colspan="2"' : ''}><b>Total</b></td><td class="n up"><b>${money(D.dep, c)}</b></td><td class="n down"><b>${money(D.pay, c)}</b></td></tr>
      <tr><td${tx ? ' colspan="2"' : ''}>Deposits − payments</td><td class="n ${signCls(D.dep - D.pay)}" colspan="2"><b>${(D.dep - D.pay >= 0 ? '+' : '−') + money(Math.abs(D.dep - D.pay), c)}</b></td></tr></tfoot></table></div>
      ${D.list.length > cap ? `<p class="sub">The first ${cap} of ${D.list.length} are listed; the totals count all of them.</p>` : ''}`;
    if (tx && state.bdView !== 'table') h += '<p class="sub">Bars and pie group the transactions: choose a grouping other than "Every transaction".</p>';
  } else if (state.bdView === 'bars') {
    const top = D.list.slice(0, 12), rest = D.list.slice(12), other = rest.reduce((x, r) => ({ k: 'Everything else (' + rest.length + ')', dep: x.dep + r.dep, pay: x.pay + r.pay }), { dep: 0, pay: 0 });
    const show = rest.length ? top.concat([other]) : top, max = Math.max(1, ...show.map(r => Math.max(r.dep, r.pay)));
    h += `<div class="legend"><span><i class="lin"></i>Deposits</span><span><i class="lout"></i>Payments</span></div><div class="bdbars">${show.map(r => `<div class="bdb" title="${esc(r.k)}: deposits ${money(r.dep, c)}, payments ${money(r.pay, c)}">
      <div class="bdl">${esc(D.by === 'month' ? new Date(r.k + '-15T12:00:00').toLocaleDateString('en-CA', { month: 'short', year: 'numeric' }) : r.k)}</div>
      ${r.dep ? `<div class="bdt"><i class="in" style="width:${(r.dep / max * 100).toFixed(1)}%"></i><span>${whole(r.dep, c)}</span></div>` : ''}
      ${r.pay ? `<div class="bdt"><i class="out" style="width:${(r.pay / max * 100).toFixed(1)}%"></i><span>${whole(r.pay, c)}</span></div>` : ''}</div>`).join('')}</div>
      <div class="bdtot"><span>Total deposits <b class="up">${money(D.dep, c)}</b></span><span>Total payments <b class="down">${money(D.pay, c)}</b></span></div>`;
  } else {
    const m = state.bdMeasure, vals = D.list.map(r => ({ k: r.k, v: m === 'dep' ? r.dep : r.pay })).filter(r => r.v > 0).sort((x, y) => y.v - x.v);
    const top = vals.slice(0, 7), rest = vals.slice(7), tot = vals.reduce((x, r) => x + r.v, 0);
    if (rest.length) top.push({ k: 'Everything else (' + rest.length + ')', v: rest.reduce((x, r) => x + r.v, 0), other: true });
    h += `<div class="segs" style="margin:8px 0">${[['pay', 'Payments'], ['dep', 'Deposits']].map(([k, l]) => `<button class="seg${m === k ? ' on' : ''}" data-act="bd-measure" data-v="${k}">${l}</button>`).join('')}</div>`;
    if (!tot) h += `<p class="sub">No ${m === 'dep' ? 'deposits' : 'payments'} in this period.</p>`;
    else {
      let ang = -Math.PI / 2; const R = 80, r0 = 50, cx = 100, cy = 100, arc = (a0, a1) => { const big = a1 - a0 > Math.PI ? 1 : 0, p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
        return `M${p(R, a0)} A${R} ${R} 0 ${big} 1 ${p(R, a1)} L${p(r0, a1)} A${r0} ${r0} 0 ${big} 0 ${p(r0, a0)}Z`; };
      const slices = top.map((r, i) => { const a0 = ang, a1 = ang + Math.max(0.0001, r.v / tot * 2 * Math.PI - (top.length > 1 ? 0.02 : 0)); ang += r.v / tot * 2 * Math.PI;
        return `<path d="${top.length === 1 ? `M${cx} ${cy - R}A${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R}L${cx - 0.01} ${cy - r0}A${r0} ${r0} 0 1 0 ${cx} ${cy - r0}Z` : arc(a0, a1)}" class="${r.other ? 'pso' : 'ps' + (i + 1)}"><title>${esc(r.k)}: ${money(r.v, c)} (${(r.v / tot * 100).toFixed(1)}%)</title></path>`; }).join('');
      h += `<div class="bdpie"><svg viewBox="0 0 200 200" class="pie">${slices}<text x="100" y="96" class="pt1">${m === 'dep' ? 'Deposits' : 'Payments'}</text><text x="100" y="114" class="pt2">${whole(tot, c)}</text></svg>
        <div class="pleg">${top.map((r, i) => `<div class="plr"><i class="${r.other ? 'pso' : 'ps' + (i + 1)}"></i><span class="pl">${esc(D.by === 'month' ? new Date(r.k + '-15T12:00:00').toLocaleDateString('en-CA', { month: 'short', year: 'numeric' }) : r.k)}</span><span class="pv">${whole(r.v, c)}</span><span class="pp">${(r.v / tot * 100).toFixed(1)}%</span></div>`).join('')}
        <div class="plr tot"><i></i><span class="pl"><b>Total</b></span><span class="pv"><b>${whole(tot, c)}</b></span><span class="pp">100%</span></div></div></div>`;
    }
  }
  h += `<p class="sub" style="margin:8px 0 0">${D.one ? 'Everything in and out of this account, in ' + esc(c) + ', transfers included, like a bank statement.' : 'All accounts, in ' + esc(c) + '. Moves between your own accounts are left out (they cancel out).'}${(state.bdWhat || 'all') === 'ie' ? ' Savings, loans and transfers are left out.' : ''}</p></div>`;
  return h;
}
document.addEventListener('change', e => { const el = e.target.closest && e.target.closest('select[data-bd]'); if (!el) return; state[el.dataset.bd] = el.value; const st = view().scrollTop; render(); view().scrollTop = st; });
/* ---------------- 1.21 ---------------- */
function mergeCat(id, into) {   /* everything in one category (and its subcategories) moves into another */
  const C = cats(), target = C.byId[into], subs = C.rows.filter(x => x.parent_id === id); if (!target || id === into) return;
  db.exec('BEGIN');
  try {
    for (const tb of ['transactions', 'recurring', 'payee_rules']) run(`UPDATE ${tb} SET category_id=? WHERE category_id=?`, [into, id]);
    for (const sb of subs) {
      if (!target.parent_id && sb.id !== into) { const twin = C.rows.find(x => x.parent_id === into && low(x.name) === low(sb.name));
        if (twin) { for (const tb of ['transactions', 'recurring', 'payee_rules']) run(`UPDATE ${tb} SET category_id=? WHERE category_id=?`, [twin.id, sb.id]); run('DELETE FROM categories WHERE id=?', [sb.id]); }
        else run('UPDATE categories SET parent_id=?, kind=? WHERE id=?', [into, target.kind, sb.id]); }
      else if (sb.id !== into) { for (const tb of ['transactions', 'recurring', 'payee_rules']) run(`UPDATE ${tb} SET category_id=? WHERE category_id=?`, [into, sb.id]); run('DELETE FROM categories WHERE id=?', [sb.id]); }
    }
    run('DELETE FROM categories WHERE id=?', [id]); db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  clearCats();
}
function catMergeMany() {
  const C = cats(), rows = C.rows.slice().sort((a, b) => C.label(a.id).localeCompare(C.label(b.id)));
  openSheet(`<h2>Merge several categories</h2><p class="sub">Tick the categories to merge, then choose the one they all go into. Their transactions, repeats and remembered payees move with them.</p>
    <div class="maybes" style="max-height:44vh;overflow:auto">${rows.map(c => `<label class="maybe"><input type="checkbox" data-mc="${c.id}"><span>${esc(C.label(c.id))} <small class="sub">${catUse(c.id).n}</small></span></label>`).join('')}</div>
    <label class="f"><span>Into</span><select name="into"><option value="">Choose…</option>${rows.map(c => `<option value="${c.id}">${esc(C.label(c.id))}</option>`).join('')}</select></label>
    <div class="btns"><button class="btn" data-f="go">Merge</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return; if (f === 'cancel') return closeSheet();
      const into = +formData(box).into, ids = Array.from(box.querySelectorAll('[data-mc]:checked')).map(x => +x.dataset.mc).filter(x => x !== into);
      if (!into) return bad('Choose the category to merge into.'); if (!ids.length) return bad('Tick at least one category to merge.');
      if (ids.some(x => cats().rows.some(r => r.id === into && r.parent_id === x))) return bad('A category cannot be merged into one of its own subcategories.');
      for (const x of ids) if (cats().byId[x]) mergeCat(x, into);
      save(); closeSheet(); toast(ids.length + ' merged into ' + cats().label(into)); render(); };
  });
}
/* payees that are the same shop written differently: "METRO #123", "Metro 456", "METRO INC" */
/* a clean name: store numbers off the end, and Title Case when the bank wrote it in capitals */
function nicePayee(p) { let n = String(p || '').replace(/\s*[#*]\s*\d+.*$/, '').replace(/\s+\d{2,}\s*$/, '').replace(/\s+(inc|ltd|ltee|llc)\.?$/i, '').replace(/[\s\-–·:,]+$/, '').trim() || String(p || '').trim();
  if (n === n.toUpperCase()) n = n.toLowerCase().replace(/(^|[\s\-\/&(])([a-z])/g, (m, a, b) => a + b.toUpperCase()); return n; }
const simKey = s => normPayee(s).replace(/\b(inc|ltd|ltee|llc|corp|co|ca|com|www|the|store|stores|magasin)\b/g, ' ').replace(/\s+/g, ' ').trim();
function similarPayeesSheet() {
  const list = payeeList(), groups = new Map();
  for (const r of list) { const k = simKey(r.payee); if (k.length < 3) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const gs = [...groups.values()].filter(g => g.length > 1).sort((a, b) => b.length - a.length);
  if (!gs.length) return toast('No payees look alike');
  const nice = g => nicePayee(g.slice().sort((a, b) => b.n - a.n)[0].payee);
  openSheet(`<h2>Similar payees</h2><p class="sub">${gs.length} group${gs.length > 1 ? 's' : ''} that look like the same payee. Ticked groups are merged under the name in the box (you can change it).</p>
    <div class="simgs">${gs.map((g, i) => `<div class="simg"><label class="maybe"><input type="checkbox" data-sg="${i}" checked><span><b>${g.length} names</b> · ${g.reduce((n, r) => n + r.n, 0)} transactions<br><small>${g.slice(0, 6).map(r => esc(r.payee)).join(' · ')}${g.length > 6 ? ' …' : ''}</small></span></label>
      <input class="simname" data-sn="${i}" value="${esc(nice(g))}" autocomplete="off"></div>`).join('')}</div>
    <div class="btns"><button class="btn" data-f="go">Merge the ticked groups</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return; if (f === 'cancel') return closeSheet();
      let n = 0; db.exec('BEGIN');
      try { box.querySelectorAll('[data-sg]:checked').forEach(c => { const i = +c.dataset.sg, nn = (box.querySelector(`[data-sn="${i}"]`).value || '').trim(); if (!nn) return;
          for (const r of gs[i]) { run('UPDATE transactions SET payee=? WHERE payee=?', [nn, r.payee]); run('UPDATE recurring SET payee=? WHERE payee=?', [nn, r.payee]); } n++; }); db.exec('COMMIT'); }
      catch (er) { db.exec('ROLLBACK'); return bad('Could not merge: ' + er.message); }
      state.psel = new Set(); save(); closeSheet(); toast(n + ' group' + (n === 1 ? '' : 's') + ' merged'); render(); };
  });
}
/* repeating payments: the same payee at a steady rhythm (and usually the same amount) */
const RHYTHM = [['weekly', 7, 1.5], ['biweekly', 14, 2.5], ['monthly', 30.4, 5], ['bimonthly', 61, 8], ['quarterly', 91.3, 12], ['halfyearly', 182.6, 18], ['yearly', 365.25, 25]];
function findRepeating() {
  const since = dstr(dnum(today()) - 800), now = dnum(today());
  const rows = q("SELECT id, date, kind, amount, payee, account_id, category_id FROM transactions WHERE kind IN ('in','out') AND date>=? AND payee IS NOT NULL AND payee<>'' ORDER BY date", [since]);
  const have = new Set(q('SELECT payee, kind FROM recurring WHERE active=1').map(r => simKey(r.payee) + '|' + r.kind)), groups = new Map();
  for (const t of rows) { const k = simKey(t.payee) + '|' + t.kind + '|' + t.account_id; if (simKey(t.payee).length < 3) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; }, out = [];
  for (const [k, ts] of groups) {
    if (have.has(k.split('|').slice(0, 2).join('|'))) continue;
    const ds = [...new Set(ts.map(t => t.date))].map(dnum).sort((a, b) => a - b); if (ds.length < 3) continue;
    const gaps = ds.slice(1).map((d, i) => d - ds[i]), g = med(gaps), rh = RHYTHM.find(([, days, tol]) => Math.abs(g - days) <= tol); if (!rh) continue;
    const steady = gaps.filter(x => Math.abs(x - rh[1]) <= rh[2] * 1.6).length / gaps.length; if (steady < 0.7) continue;
    if (rh[0] === 'yearly' ? ds.length < 2 : ds.length < 3) continue;
    const last = ds[ds.length - 1]; if (now - last > rh[1] * 1.6) continue;   /* stopped */
    const amts = ts.map(t => t.amount), m = med(amts), fixed = amts.every(a => Math.abs(a - m) <= Math.max(1, m * 0.03));
    const lastT = ts[ts.length - 1], cnt = {}; for (const t of ts) if (t.category_id) cnt[t.category_id] = (cnt[t.category_id] || 0) + 1; const cat = +(Object.entries(cnt).sort((a, b) => b[1] - a[1])[0] || [null])[0] || null;
    let next = dstr(last); for (let guard = 0; guard < 60 && next <= today(); guard++) next = nextDate(next, rh[0]);
    out.push({ payee: ts.length > 1 && simKey(ts[0].payee) === simKey(lastT.payee) && ts.some(t => t.payee !== lastT.payee) ? nicePayee(lastT.payee) : lastT.payee, kind: lastT.kind, account_id: lastT.account_id, freq: rh[0], amount: fixed ? m : lastT.amount, fixed, n: ds.length, day: +dstr(last).slice(8, 10), next, cat, steady });
  }
  return out.sort((a, b) => b.n - a.n);
}
function findRepeatSheet() {
  const list = findRepeating(), A = Object.fromEntries(q('SELECT id, name, currency FROM accounts').map(a => [a.id, a]));
  if (!list.length) return toast('No new repeating payments found');
  const when = r => r.freq === 'monthly' || r.freq === 'bimonthly' || r.freq === 'quarterly' ? `around the ${r.day}${[, 'st', 'nd', 'rd'][r.day % 10 > 3 || Math.floor(r.day / 10) === 1 ? 0 : r.day % 10] || 'th'}` : '';
  openSheet(`<h2>Repeating payments found</h2><p class="sub">The same payee at a steady rhythm in your transactions. Ticked ones are added under Recurring, as reminders, with the next date and usual amount.</p>
    <div class="maybes">${list.map((r, i) => { const c = (A[r.account_id] || {}).currency || home();
      return `<label class="maybe"><input type="checkbox" data-rp2="${i}" checked><span><b>${esc(r.payee)}</b> · ${r.kind === 'in' ? '+' : '−'}${money(r.amount, c)}${r.fixed ? '' : ' (varies)'}<br>
      <small>${esc(FREQS[r.freq] || r.freq)} ${when(r)} · ${esc((A[r.account_id] || {}).name || '')} · seen ${r.n} times · next ${fmtDate(r.next)}</small></span></label>`; }).join('')}</div>
    <label class="switch"><span>Add them by themselves on the day (instead of reminding me)</span><input type="checkbox" name="auto"></label>
    <div class="btns"><button class="btn" data-f="go">Add the ticked ones</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return; if (f === 'cancel') return closeSheet();
      const auto = box.querySelector('[name=auto]').checked ? 1 : 0; let n = 0;
      box.querySelectorAll('[data-rp2]:checked').forEach(c => { const r = list[+c.dataset.rp2];
        run('INSERT INTO recurring(account_id,kind,amount,category_id,payee,note,freq,next_date,auto,active) VALUES(?,?,?,?,?,?,?,?,?,1)', [r.account_id, r.kind, +r.amount.toFixed(2), r.cat || null, r.payee, r.fixed ? null : 'Amount varies', r.freq, r.next, auto]);
        if (r.cat) learnRule(r.payee, r.cat, null); n++; });
      save(); closeSheet(); toast(n + ' repeating payment' + (n === 1 ? '' : 's') + ' added'); render(); };
  });
}
/* things you bought in the past (metals, property, other assets) and the payment in your accounts */
function purchaseTargets() {
  const H = home(), out = [], linked = new Set(q("SELECT DISTINCT link FROM transactions WHERE link IS NOT NULL").map(r => r.link));
  const hs = q('SELECT * FROM metal_holdings WHERE purchase_date IS NOT NULL').filter(h => !linked.has('metal:' + h.id));
  const byDay = {}; for (const h of hs) { const k = h.purchase_date + '|' + (h.currency || H); (byDay[k] = byDay[k] || []).push(h); }
  for (const g of Object.values(byDay)) {
    const one = (list, label) => { const st = list.map(holdingStats), withFees = st.reduce((x, y) => x + (y.cost || 0), 0), bare = list.reduce((x, h) => x + (h.cost || 0), 0);
      if (withFees > 0) out.push({ link: 'metal:' + list[0].id, label, date: list[0].purchase_date, amounts: [...new Set([withFees, bare].filter(v => v > 0).map(v => +v.toFixed(2)))], cur: list[0].currency || H, cat: 'Precious metals' }); };
    if (g.length > 1) one(g, `${g.length} metal purchases on the same day`);
    for (const h of g) one([h], h.description || METAL[h.metal].name);
  }
  for (const p of q('SELECT * FROM properties WHERE purchase_date IS NOT NULL AND purchase_price>0')) if (!linked.has('property:' + p.id))
    out.push({ link: 'property:' + p.id, label: p.name, date: p.purchase_date, amounts: [...new Set([p.purchase_price, p.purchase_price + (p.purchase_costs || 0)])], cur: p.currency || H, cat: 'Property' });
  for (const a of q('SELECT * FROM other_assets WHERE purchase_date IS NOT NULL AND purchase_price>0')) if (!linked.has('asset:' + a.id))
    out.push({ link: 'asset:' + a.id, label: a.name, date: a.purchase_date, amounts: [a.purchase_price], cur: a.currency || H, cat: 'Big purchases' });
  return out;
}
function purchaseCandidates(tg) {
  const rows = q("SELECT t.*, COALESCE(a.currency, ?) acur, a.name aname FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.kind='out' AND t.link IS NULL AND t.date>=? AND t.date<=?",
    [home(), dstr(dnum(tg.date) - 7), dstr(dnum(tg.date) + 7)]);
  const c = [];
  for (const t of rows) { const v = t.acur === tg.cur ? t.amount : conv(t.amount, t.acur, tg.cur); if (v == null) continue;
    const best = Math.min(...tg.amounts.map(a => Math.abs(v - a) / Math.max(a, 1))); if (best > (t.acur === tg.cur ? 0.01 : 0.03)) continue;
    c.push(Object.assign(t, { off: best, days: Math.abs(dnum(t.date) - dnum(tg.date)) })); }
  return c.sort((x, y) => (x.off - y.off) || (x.days - y.days)).slice(0, 4);
}
function matchPurchases() {
  const tgs = purchaseTargets(); if (!tgs.length) return toast('Every purchase with a date and price is already linked to a payment');
  const used = new Set(), found = [];
  for (const tg of tgs) { const cs = purchaseCandidates(tg).filter(t => !used.has(t.id)); if (!cs.length) continue; found.push([tg, cs]); if (cs[0].off < 0.005 && cs[0].days <= 3) used.add(cs[0].id); }
  const missing = tgs.length - found.length;
  if (!found.length) return toast(`No payments found for ${tgs.length} purchase${tgs.length > 1 ? 's' : ''} (paid in cash, or before your records start?)`);
  openSheet(`<h2>Purchases found in your accounts</h2><p class="sub">Same amount within 1%, within a week of the purchase date. A linked payment shows on the item's page and counts as savings and investments, not spending.</p>
    ${found.map(([tg, cs], i) => `<div class="simg"><b>${esc(tg.label)}</b> <small class="sub">${fmtDate(tg.date)} · ${tg.amounts.map(a => money(a, tg.cur)).join(' or ')}</small>
      <div class="maybes">${cs.map((t, k) => `<label class="maybe"><input type="radio" name="pm${i}" value="${t.id}"${k === 0 && t.off < 0.005 && t.days <= 3 ? ' checked' : ''}><span>${fmtDate(t.date)} · ${money(t.amount, t.acur)} · ${esc(t.aname)}<br><small>${esc(t.payee || '')} ${t.category_id ? '· ' + esc(cats().label(t.category_id)) : ''}</small></span></label>`).join('')}
      <label class="maybe"><input type="radio" name="pm${i}" value=""${cs[0].off < 0.005 && cs[0].days <= 3 ? '' : ' checked'}><span>None of these</span></label></div></div>`).join('')}
    ${missing ? `<p class="hint">${missing} other purchase${missing > 1 ? 's have' : ' has'} no matching payment (paid in cash, from an account not in the app, or before your records start).</p>` : ''}
    <div class="btns"><button class="btn" data-f="go">Link the chosen payments</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return; if (f === 'cancel') return closeSheet();
      const C = cats(), saveTop = C.rows.find(c => !c.parent_id && c.kind === 'save'); let n = 0; const taken = new Set();
      for (let i = 0; i < found.length; i++) { const v = (box.querySelector(`[name=pm${i}]:checked`) || {}).value; if (!v || taken.has(v)) continue; taken.add(v);
        const tg = found[i][0], t = found[i][1].find(x => String(x.id) === v), sub = C.rows.find(c => c.kind === 'save' && c.name === tg.cat) || saveTop;
        const keepCat = t.category_id && C.top(t.category_id) && C.top(t.category_id).kind === 'save';
        run('UPDATE transactions SET link=?, category_id=? WHERE id=?', [tg.link, keepCat ? t.category_id : (sub ? sub.id : t.category_id), t.id]); n++; }
      save(); closeSheet(); toast(n ? n + ' purchase' + (n > 1 ? 's' : '') + ' linked' : 'Nothing linked'); render(); };
  });
}
/* ---------------- 1.18: reconcile with the bank ----------------
   Each balance check (from a bank file, a statement or a cash count) is compared with the check before it plus the
   transactions in between. A difference means something is missing, doubled or wrong. Per month you see the difference,
   per year and in total; one tap adds a correction. Entries you typed that no bank file has shown yet are "not in bank yet".
   Money that left one of your accounts and arrived in another (BR TO BR at RBC) is linked into one transfer. */
const XFER_RE = /\b(br\s*to\s*br|transfer|virement|tfr|xfer|trsf|inter-?account)\b/i, ETR_RE = /\b(e-?transfer|interac|etfr|e-?tfr|send money)\b/i;
const acctOpen = a => !a || (a.status !== 'hidden' && a.status !== 'closed');
function pendFrom(id) {   /* entries from this day on should show up in the bank's files */
  if (id in PFROM) return PFROM[id];
  const a = q('SELECT type FROM accounts WHERE id=?', [id])[0];
  const r = a && a.type !== 'cash' ? q("SELECT MIN(date) d FROM transactions WHERE (account_id=? AND bank_ok=2) OR (to_account_id=? AND import_id2 IS NOT NULL)", [id, id])[0] : null;
  return (PFROM[id] = r && r.d || null);
}
function isWaiting(t, id) {
  if (t.kind === 'transfer' && t.to_account_id === id && t.account_id !== id) { const f = pendFrom(id); return !!f && t.date >= f && !t.import_id2; }
  if (t.account_id !== id) return false; const f = pendFrom(id); return !!f && t.date >= f && !t.bank_ok;
}
function corrCat() {
  let r = cats().rows.find(c => !c.parent_id && c.name === 'Balance corrections');
  if (!r) { run("INSERT INTO categories(name,parent_id,kind,sort) VALUES('Balance corrections',NULL,'save',905)"); clearCats(); r = cats().rows.find(c => !c.parent_id && c.name === 'Balance corrections'); }
  return r ? r.id : null;
}
/* every balance check after the first, with what your transactions say */
function reconPeriods(a) { const k = '__rp' + a.id; return BALC[k] || (BALC[k] = reconPeriods0(a)); }
function reconPeriods0(a) {
  const bs = q('SELECT * FROM account_balances WHERE account_id=? ORDER BY date, COALESCE(created,0), id', [a.id]), out = [], cur = a.currency || home();
  const ck = (d, c) => d + '|' + String(Math.round(c || 0) + 1e15).padStart(18, '0');
  const all = q('SELECT id, date, created, kind, amount, to_amount, account_id, to_account_id, category_id FROM transactions WHERE account_id=? OR to_account_id=?', [a.id, a.id]).map(t => [ck(t.date, t.created), t]).sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
  let j = 0;
  const sg = b => a.type === 'credit' ? -Math.abs(b) : b, cc = (cats().rows.find(c => !c.parent_id && c.name === 'Balance corrections') || {}).id;
  for (let i = 1; i < bs.length; i++) {
    const r = bs[i], prev = bs[i - 1], lo = ck(prev.date, prev.created), hi = ck(r.date, r.created || 9e15);
    while (j < all.length && all[j][0] <= lo) j++;
    const txs = []; let jj = j; while (jj < all.length && all[jj][0] <= hi) { txs.push(all[jj][1]); jj++; }
    let exp = sg(prev.balance), fix = 0; for (const t of txs) { const e = txEffect(t, a.id, cur); exp += e; if (cc && t.category_id === cc) fix += e; }
    const diff = sg(r.balance) - exp;
    out.push({ check: r, prev, bank: sg(r.balance), expected: exp, diff: Math.abs(diff) < 0.005 ? 0 : diff, fix, n: txs.length, txs, ym: r.date.slice(0, 7) });
  }
  return out;
}
function monthsOf(periods) {   /* several checks in one month add up */
  const m = new Map();
  for (const p of periods) { const x = m.get(p.ym) || { ym: p.ym, diff: 0, fix: 0, n: 0, bank: 0, last: null, periods: [] };
    x.diff += p.diff; x.fix += p.fix; x.n += p.n; x.bank = p.bank; x.last = p.check; x.periods.push(p); m.set(p.ym, x); }
  return [...m.values()].reverse();
}
const ymLabel = ym => new Date(ym + '-15T12:00:00').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
/* money moving between two of your accounts, entered on both sides: link each pair into one transfer */
function findTransfers(since) { if (since) return findTransfers0(since); return BALC.__ft || (BALC.__ft = findTransfers0()); }
function findTransfers0(since) {
  let no = []; try { no = JSON.parse(getSetting('xfer_no', '[]')); } catch (e) { no = []; } const NO = new Set(no);
  const A = Object.fromEntries(q('SELECT * FROM accounts').map(a => [a.id, a]));
  const TC = 'id, uid, date, amount, account_id, payee, note, category_id, created, import_id, kind', outs = q(`SELECT ${TC} FROM transactions WHERE kind='out' ORDER BY date`), ins = q(`SELECT ${TC} FROM transactions WHERE kind='in' ORDER BY date`), byAmt = new Map();
  for (const t of ins) { const k = t.amount.toFixed(2); if (!byAmt.has(k)) byAmt.set(k, []); byAmt.get(k).push(t); }
  const used = new Set(), pairs = [], loose = t => XFER_RE.test((t.payee || '') + ' ' + (t.note || '')) && !ETR_RE.test((t.payee || '') + ' ' + (t.note || ''));
  const xc = transferCat();
  const score = (o, i) => (loose(o) ? 2 : 0) + (loose(i) ? 2 : 0) + (xc && o.category_id === xc ? 2 : 0) + (xc && i.category_id === xc ? 2 : 0) + (!o.category_id ? 1 : 0) + (!i.category_id ? 1 : 0) - Math.abs(dnum(o.date) - dnum(i.date));
  const cand = [];
  for (const o of outs) { const ao = A[o.account_id]; if (!ao) continue;
    const grp = byAmt.get(o.amount.toFixed(2)); if (!grp) continue;
    let lo = 0, hi = grp.length, from = dstr(dnum(o.date) - 3), to = dstr(dnum(o.date) + 3); while (lo < hi) { const m = (lo + hi) >> 1; if (grp[m].date < from) lo = m + 1; else hi = m; }
    for (let gi = lo; gi < grp.length && grp[gi].date <= to; gi++) { const i = grp[gi], ai = A[i.account_id];
      if (!ai || i.account_id === o.account_id || (ai.currency || home()) !== (ao.currency || home())) continue;
      if (Math.abs(dnum(o.date) - dnum(i.date)) > 3 || NO.has(o.uid + '|' + i.uid)) continue;
      if (since && Math.max(o.created || 0, i.created || 0) < since) continue;
      cand.push({ o, i, s: score(o, i) }); } }
  cand.sort((x, y) => y.s - x.s);
  for (const c of cand) { if (used.has(c.o.id) || used.has(c.i.id)) continue; used.add(c.o.id); used.add(c.i.id); c.likely = c.s >= 1; pairs.push(c); }
  return pairs.sort((x, y) => x.o.date < y.o.date ? 1 : -1);
}
function linkTransfer(o, i) {   /* the money-out entry becomes the transfer; the money-in entry is folded into it */
  const note = [o.note, o.payee && o.payee !== i.payee ? o.payee : '', i.payee].filter(Boolean).filter((v, k, arr) => arr.indexOf(v) === k).join(' · ').slice(0, 200);
  run("UPDATE transactions SET kind='transfer', to_account_id=?, category_id=NULL, note=?, import_id2=COALESCE(import_id2, ?) WHERE id=?", [i.account_id, note, i.import_id || null, o.id]);
  run('DELETE FROM transactions WHERE id=?', [i.id]);
}
let xferTimer = null;
function offerTransfersSoon() { const t0 = Date.now() - 60000; clearTimeout(xferTimer); xferTimer = setTimeout(() => offerTransfers(true, t0), 900); }
function offerTransfers(quiet, since) {
  const pairs = findTransfers(since), A = Object.fromEntries(q('SELECT * FROM accounts').map(a => [a.id, a]));
  if (!pairs.length) { if (!quiet) toast('No new transfers between your accounts found'); return; }
  openSheet(`<h2>Transfers between your accounts</h2><p class="sub">The same amount left one of your accounts and arrived in another within a few days. Linked, it counts once, as a transfer: not as spending and not as income.</p>
    <div class="maybes">${pairs.map((p, k) => `<label class="maybe"><input type="checkbox" data-pair="${k}"${p.likely ? ' checked' : ''}>
      <span><b>${money(p.o.amount, A[p.o.account_id].currency || home())} · ${esc(A[p.o.account_id].name)} → ${esc(A[p.i.account_id].name)}</b><br>
      <small>${fmtDate(p.o.date)} ${esc(p.o.payee || cats().label(p.o.category_id) || '')}${p.i.date !== p.o.date ? ' · arrived ' + fmtDate(p.i.date) : ''} ${esc(p.i.payee && p.i.payee !== p.o.payee ? '· ' + p.i.payee : '')}</small></span></label>`).join('')}</div>
    <p class="hint">Untick any that are not a transfer (two payments of the same amount by chance); the app will not ask about them again.</p>
    <div class="btns"><button class="btn" data-f="go">Link the ticked ones</button><button class="btn light" data-f="cancel">Not now</button></div>`, box => {
    const cnt = () => { const n = box.querySelectorAll('[data-pair]:checked').length; box.querySelector('[data-f=go]').textContent = n ? `Link ${n} as transfer${n > 1 ? 's' : ''}` : 'None are transfers'; };
    box.onchange = cnt; cnt();
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return; if (f === 'cancel') return closeSheet();
      let no = []; try { no = JSON.parse(getSetting('xfer_no', '[]')); } catch (er) { no = []; }
      let n = 0; db.exec('BEGIN');
      try { box.querySelectorAll('[data-pair]').forEach(c => { const p = pairs[+c.dataset.pair]; if (c.checked) { linkTransfer(p.o, p.i); n++; } else no.push(p.o.uid + '|' + p.i.uid); }); db.exec('COMMIT'); }
      catch (er) { db.exec('ROLLBACK'); return bad('Could not link: ' + er.message); }
      setSetting('xfer_no', JSON.stringify(no.slice(-500))); BALC = {}; save(); closeSheet(); toast(n ? `${n} transfer${n > 1 ? 's' : ''} linked` : 'Noted: not transfers'); render(); };
  });
}
/* "BR TO BR" and the like with no partner in any of your accounts: you say where it went */
function looseTransfers(accountId) {
  let ok = []; try { ok = JSON.parse(getSetting('xfer_ok', '[]')); } catch (e) { ok = []; } const OK = new Set(ok), xc = transferCat();
  const paired = new Set(findTransfers().flatMap(p => [p.o.id, p.i.id]));
  const LK = ['transfer', 'br to br', 'br  to br', 'virement', 'tfr', 'xfer', 'trsf', 'inter'].map(w => `(lower(COALESCE(t.payee,'')||' '||COALESCE(t.note,'')) LIKE '%${w}%')`).join(' OR ');
  return q("SELECT t.* FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.kind<>'transfer' AND a.type<>'credit' AND (" + LK + (xc ? ' OR t.category_id=' + (+xc) : '') + ')' + (accountId ? ' AND t.account_id=?' : '') + ' ORDER BY t.date DESC', accountId ? [accountId] : [])
    .filter(t => !OK.has(t.uid) && !paired.has(t.id) && ((XFER_RE.test((t.payee || '') + ' ' + (t.note || '')) && !ETR_RE.test((t.payee || '') + ' ' + (t.note || ''))) || (xc && t.category_id === xc)));
}
function looseHtml(list) {
  if (!list.length) return '';
  const total = list.length; list = list.slice(0, 40);   /* 1.20: the newest 40; the rest after these are done */
  const A = Object.fromEntries(q('SELECT * FROM accounts').map(a => [a.id, a]));
  return `<h2 class="sect">Transfers with no other side <span class="sub">${total}${total > list.length ? ' · newest ' + list.length + ' shown' : ''}</span></h2><div class="card"><p class="sub" style="margin-top:0">Money moved, but none of your other accounts shows it arriving (or leaving). Say where it went: another account, your cash, or leave it as spending or income.</p>
    <div class="txns" style="margin-top:0">${list.map(t => { const a = A[t.account_id] || {}, c = a.currency || home();
      const opts = Object.values(A).filter(x => x.id !== t.account_id && (x.currency || home()) === c).map(x => `<option value="${x.id}">${t.kind === 'out' ? 'Went to' : 'Came from'} ${esc(x.name)}</option>`).join('');
      return `<div class="txn"><div class="txn-top"><span class="txn-date">${fmtDate(t.date)}</span><span class="txn-desc">${esc(t.payee || '')} · ${esc(a.name || '')}</span></div>
        <div class="txn-body"><select class="loosesel" id="loose${t.id}">${opts}<option value="keep">Not a transfer: keep as ${t.kind === 'out' ? 'spending' : 'income'}</option></select>
        <div class="r"><div class="strongv ${t.kind === 'in' ? 'up' : 'down'}">${t.kind === 'in' ? '+' : '−'}${money(t.amount, c)}</div></div></div>
        <div class="btns" style="margin-top:6px"><button class="btn light" data-act="xfer-apply" data-id="${t.id}">Apply</button></div></div>`; }).join('')}</div></div>`;
}
function applyLoose(id) {
  const t = q('SELECT * FROM transactions WHERE id=?', [id])[0], el = document.getElementById('loose' + id); if (!t || !el) return;
  if (el.value === 'keep') { let ok = []; try { ok = JSON.parse(getSetting('xfer_ok', '[]')); } catch (e) { ok = []; } ok.push(t.uid); setSetting('xfer_ok', JSON.stringify(ok.slice(-2000))); BALC = {};
    if (t.category_id && t.category_id === transferCat()) run('UPDATE transactions SET category_id=NULL WHERE id=?', [id]);
    save(); toast(t.category_id === transferCat() ? 'Kept; give it a category under Cash flow' : 'Kept as it is'); return render(); }
  const z = +el.value, note = [t.note, t.payee].filter(Boolean).join(' · ').slice(0, 200);
  if (t.kind === 'out') run("UPDATE transactions SET kind='transfer', to_account_id=?, category_id=NULL, note=? WHERE id=?", [z, note, id]);
  else run("UPDATE transactions SET kind='transfer', account_id=?, to_account_id=?, category_id=NULL, note=?, import_id2=COALESCE(import_id2, import_id), import_id=NULL, bank_ok=NULL WHERE id=?", [z, t.account_id, note, id]);
  if (t.payee && normPayee(t.payee).length >= 4 && !/\d{4,}/.test(t.payee)) learnRule(t.payee, null, z);
  save(); toast('Linked as a transfer'); render();
}
/* 1.19: type the closing balance of each monthly statement; each becomes a balance check on the last day of that month */
function stmtBalances(id) {
  const a = q('SELECT * FROM accounts WHERE id=?', [id])[0]; if (!a) return;
  const c = a.currency || home(), cr = a.type === 'credit', first = [(q('SELECT MIN(date) d FROM transactions WHERE account_id=? OR to_account_id=?', [id, id])[0] || {}).d, (q('SELECT MIN(date) d FROM account_balances WHERE account_id=?', [id])[0] || {}).d].filter(Boolean).sort()[0] || today();
  const ends = []; let y = +today().slice(0, 4), m = +today().slice(5, 7) - 1;
  for (let k = 0; k < 36; k++) { if (m < 1) { m = 12; y--; } const e = `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; if (e < first) break; ends.push(e); m--; }
  const have = Object.fromEntries(q('SELECT date, balance FROM account_balances WHERE account_id=?', [id]).map(r => [r.date, r.balance]));
  openSheet(`<h2>Balances from statements · ${esc(a.name)}</h2><p class="sub">From each monthly statement, type the ${cr ? 'balance owed' : 'closing balance'} on the last day. Fill in only the months you want to check; start with the months around the difference.</p>
    <div class="stmtgrid">${ends.map(e => `<label class="f"><span>${new Date(e + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })}${have[e] != null ? ' ✓' : ''}</span><input name="e${e}" inputmode="decimal" autocomplete="off" value="${have[e] != null ? +(cr ? Math.abs(have[e]) : have[e]).toFixed(2) : ''}"${have[e] != null ? ' disabled' : ''}></label>`).join('')}</div>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return; if (f === 'cancel') return closeSheet();
      const d = formData(box); let n = 0;
      for (const e2 of ends) { const v = d['e' + e2]; if (v == null || String(v).trim() === '' || have[e2] != null) continue; const x = num(v); if (Number.isNaN(x)) return bad('Check the amount for ' + e2.slice(0, 7) + '.');
        run('INSERT INTO account_balances(account_id,date,balance,note,created) VALUES(?,?,?,?,?)', [id, e2, cr ? Math.abs(x) : x, 'Statement', 9e12]); n++; }
      save(); closeSheet(); toast(n ? n + ' statement balance' + (n > 1 ? 's' : '') + ' added' : 'Nothing added'); render(); };
  });
}
function settingsNav() {
  const v = view(); v.classList.toggle('hasnav', state.tab === 'more'); if (state.tab !== 'more') return;
  const hs = Array.from(v.querySelectorAll(':scope > h2.sect')); if (hs.length < 3) return;
  const nav = document.createElement('nav'); nav.className = 'setnav nomask'; nav.setAttribute('aria-label', 'Settings sections');
  nav.innerHTML = hs.map((h, i) => `<button data-sn="${i}">${esc((h.childNodes[0] && h.childNodes[0].textContent || h.textContent).trim())}</button>`).join('');
  v.prepend(nav);
  const place = () => { const hd = document.getElementById('top'); nav.style.top = window.innerWidth >= 980 && hd ? (hd.getBoundingClientRect().bottom + 14) + 'px' : ''; };
  place(); window.onresize = place;
  nav.onclick = e => { const b = e.target.closest('[data-sn]'); if (!b) return; const h = hs[+b.dataset.sn];
    if (h.classList.contains('closed')) h.click();
    nav.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    v.scrollTo({ top: h.offsetTop - (window.innerWidth >= 980 ? 8 : nav.offsetHeight + 12), behavior: 'smooth' }); };
}
/* 1.20: an error you cannot trace: recorded as a balance correction (not spending, not income), so the balance matches the bank */
function addCorrection(id, date, diff, note, created) {
  run('INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,created,bank_ok) VALUES(?,?,?,?,?,?,?,?,1)',
    [id, date, diff > 0 ? 'in' : 'out', +Math.abs(diff).toFixed(2), corrCat(), 'Balance correction', note, created]);
}
function errorForm(id) {
  const a = q('SELECT * FROM accounts WHERE id=?', [id])[0]; if (!a) return; const c = a.currency || home(), cr = a.type === 'credit';
  openSheet(`<h2>Record an error · ${esc(a.name)}</h2><p class="sub">When the balance is wrong and the cause cannot be found, record the difference here. It is kept under "Balance corrections", shown on the Reconcile page, and not counted as spending or income.</p>
    <div class="f2"><label class="f"><span>Date</span><input type="date" name="date" value="${today()}"></label><label class="f"><span>Amount (${esc(c)})</span><input name="amount" inputmode="decimal" autocomplete="off"></label></div>
    <div class="f"><span>Which way?</span><div class="freqs"><label class="freqo"><input type="radio" name="way" value="more" checked><span>${cr ? 'I owe less than the app says' : 'The bank shows more'}</span></label><label class="freqo"><input type="radio" name="way" value="less"><span>${cr ? 'I owe more than the app says' : 'The bank shows less'}</span></label></div></div>
    <label class="f"><span>Note</span><input name="note" value="Unexplained difference"></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return; if (f === 'cancel') return closeSheet();
      const d = formData(box), x = num(d.amount); if (Number.isNaN(x) || !x) return bad('Type the amount of the error.');
      addCorrection(id, d.date || today(), d.way === 'less' ? -Math.abs(x) : Math.abs(x), (d.note || 'Unexplained difference').slice(0, 200), -1);   /* -1: before a bank balance of the same day */
      save(); closeSheet(); toast('Error recorded as a balance correction'); render(); };
  });
}
/* 1.25: every account at once: a correction in each period that does not match the bank, so all history agrees with the bank */
async function correctEveryAccount() {
  const H = home(), todo = q('SELECT * FROM accounts').map(a => [a, reconPeriods(a).filter(p => p.diff)]).filter(([, ps]) => ps.length);
  if (!todo.length) return toast('Every account already agrees with the bank ✓');
  const n = todo.reduce((x, [, ps]) => x + ps.length, 0);
  if (!await ask(`Add ${n} correction${n > 1 ? 's' : ''} in ${todo.length} account${todo.length > 1 ? 's' : ''} (${todo.map(([a, ps]) => a.name + ' ' + money(ps.reduce((x, p) => x + p.diff, 0), a.currency || H, { dec: 0 })).join(', ')})? Each period that does not match the bank gets one, under "Balance corrections" (not spending or income). Your balances do not change; the history then adds up. You can delete any of them later.`, 'Correct them')) return;
  db.exec('BEGIN');
  try { for (const [a, ps] of todo) for (const p of ps) addCorrection(a.id, p.check.date, p.diff, `Reconcile: the ${a.type === 'cash' ? 'count' : 'bank'} showed ${money(Math.abs(p.bank), a.currency || H)} on ${fmtDate(p.check.date)}`, (p.check.created || 0) - 1); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); return bad('Could not add: ' + e.message); }
  save(); toast(n + ' correction' + (n > 1 ? 's' : '') + ' added'); render();
}
async function correctAll(id) {
  const a = q('SELECT * FROM accounts WHERE id=?', [id])[0]; if (!a) return; const c = a.currency || home();
  const ps = reconPeriods(a).filter(p => p.diff), tot = ps.reduce((s2, p) => s2 + p.diff, 0); if (!ps.length) return;
  if (!await ask(`Add ${ps.length} correction${ps.length > 1 ? 's' : ''} (${tot > 0 ? '+' : '−'}${money(Math.abs(tot), c)} in all), one in each period that is off, so every balance matches the bank? You can delete any of them later.`, 'Correct all')) return;
  db.exec('BEGIN');
  try { for (const p of ps) addCorrection(id, p.check.date, p.diff, `Reconcile: the ${a.type === 'cash' ? 'count' : 'bank'} showed ${money(Math.abs(p.bank), c)} on ${fmtDate(p.check.date)}`, (p.check.created || 0) - 1); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); return bad('Could not add: ' + e.message); }
  save(); toast(ps.length + ' correction' + (ps.length > 1 ? 's' : '') + ' added'); render();
}
/* the Reconcile page: all accounts, or one */
function renderRecon(id) {
  const H = home();
  if (!id) {
    setTitle('Reconcile', true);
    const as = q("SELECT * FROM accounts ORDER BY CASE type WHEN 'cash' THEN 2 WHEN 'credit' THEN 1 ELSE 0 END, name");
    let h = `<div class="card"><p class="sub" style="margin:0">Each balance from your bank (or each cash count) is compared with your transactions since the one before. A difference means something is missing, doubled or wrong in that period. Tap an account to see it month by month.</p>
      <div class="btns"><button class="btn light" data-act="find-xfer">Find transfers between accounts</button><button class="btn light" data-act="fix-all-accts">Correct every account…</button></div></div><h2 class="sect">Accounts</h2><div class="card">`;
    h += as.map(a => { const ps = reconPeriods(a), off = ps.filter(p => p.diff), tot = off.reduce((s, p) => s + p.diff, 0), c = a.currency || home(), last = ps[ps.length - 1];
      const pf = pendFrom(a.id), waits = pf ? q('SELECT * FROM transactions WHERE (account_id=? OR to_account_id=?) AND date>=?', [a.id, a.id, pf]).filter(t => isWaiting(t, a.id)).length : 0;
      const st = !ps.length ? '<span class="sub">needs two balances to compare</span>' : off.length ? `<span class="down">${off.length} period${off.length > 1 ? 's' : ''} off · ${tot > 0 ? '+' : tot < 0 ? '−' : ''}${money(Math.abs(tot), c)} in all</span>` : '<span class="up">✓ all agree</span>';
      return `<div class="arowx" data-act="recon" data-id="${a.id}"><div class="al"><div class="an">${esc(a.name)}</div><div class="sub">${st}</div><div class="sub">${last ? 'last balance ' + fmtDate(last.check.date) : ''}${waits ? (last ? ' · ' : '') + waits + ' not in bank yet' : ''}</div></div><div class="ar"><span class="chev">›</span></div></div>`; }).join('') + '</div>';
    h += looseHtml(looseTransfers());
    { const rs = as.map(a => reconPeriods(a)).filter(ps => ps.length); if (rs.length && rs.every(ps => !ps.some(p => p.diff))) h += moodVerse('agree'); }
    view().innerHTML = h; return;
  }
  const a = q('SELECT * FROM accounts WHERE id=?', [id])[0]; if (!a) { state.reconId = null; return renderRecon(null); }
  setTitle(a.name + ' · Reconcile', true);
  const c = a.currency || home(), cr = a.type === 'credit', isCash = a.type === 'cash', ps = reconPeriods(a), months = monthsOf(ps), b = acctBalance(id);
  const off = months.filter(m => m.diff), tot = ps.reduce((s, p) => s + p.diff, 0), fixes = ps.reduce((s, p) => s + p.fix, 0);
  const show = v => cr ? money(Math.abs(v), c) : money(v, c), sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v), c);
  let h = `<div class="card hero"><div class="label">${isCash ? 'Cash counts' : cr ? 'Statements' : 'Bank balances'} compared with your transactions</div>
    <div class="big ${tot ? 'down' : 'up'}">${ps.length ? (tot ? sgn(tot) : '✓') : '—'}</div>
    <div class="sub">${!ps.length ? `Add ${isCash ? 'two cash counts' : 'two balances (import bank files, or Update balance)'} to compare.` : tot ? `left unexplained in ${off.length} month${off.length > 1 ? 's' : ''}` : 'every period agrees with the bank'}${fixes ? ` · corrections recorded: ${sgn(fixes)}` : ''}</div>
    <div class="btns">${isCash ? `<button class="btn light" data-act="add-balance" data-id="${a.id}">Count your cash</button>` : `<button class="btn light" data-act="bank-import" data-id="${a.id}">Import a bank file</button><button class="btn light" data-act="stmt-bal" data-id="${a.id}">Balances from statements</button>`}</div>
    <div class="btns"><button class="btn light" data-act="err-add" data-id="${a.id}">Record an error</button>${off.length ? `<button class="btn" data-act="err-all" data-id="${a.id}">Correct all ${off.length} month${off.length > 1 ? 's' : ''}</button>` : ''}</div>
    ${(() => { const big = ps.filter(p => p.diff && dnum(p.check.date) - dnum(p.prev.date) > 40).pop(); return big && !isCash ? `<div class="warn" style="margin-top:10px">The difference of ${sgn(big.diff)} covers ${fmtDate(big.prev.date)} to ${fmtDate(big.check.date)}. Add the month-end balances from your statements for that time (<b>Balances from statements</b>): the table then shows which month is off.</div>` : ''; })()}</div>`;
  if (months.length) {
    let yr = null;
    h += `<h2 class="sect">Month by month <span class="sub">tap one to see why</span></h2><div class="card"><div class="rtab"><div class="rth"><span>Month</span><span>${cr ? 'Owed' : isCash ? 'Counted' : 'Bank'}</span><span>Difference</span></div>`;
    const years = {}; for (const m of months) { const y = m.ym.slice(0, 4); years[y] = (years[y] || 0) + m.diff; }
    for (const m of months) { const y = m.ym.slice(0, 4);
      if (y !== yr) { yr = y; h += `<div class="rty"><span>${y}</span><span></span><span class="${years[y] ? 'down' : 'up'}">${years[y] ? sgn(years[y]) : '✓'}</span></div>`; }
      h += `<div class="rtr tap" data-act="recon-month" data-id="${a.id}" data-ym="${m.ym}"><span>${new Date(m.ym + '-15T12:00:00').toLocaleDateString('en-CA', { month: 'long' })}</span><span>${show(m.bank)}</span><span class="${m.diff ? 'down' : 'up'}">${m.diff ? sgn(m.diff) : '✓'}</span></div>`; }
    h += `<div class="rty tot"><span>All</span><span></span><span class="${tot ? 'down' : 'up'}">${tot ? sgn(tot) : '✓'}</span></div></div>
      <p class="sub" style="margin:8px 0 0">${cr ? 'A plus means you owe less than your transactions say' : 'A plus means the bank shows more than your transactions add up to'}; a minus, ${cr ? 'more' : 'less'}.</p></div>`;
  }
  const pf0 = pendFrom(id), waits = pf0 ? q('SELECT * FROM transactions WHERE (account_id=? OR to_account_id=?) AND date>=? ORDER BY date DESC, id DESC', [id, id, pf0]).filter(t => isWaiting(t, id)) : [];
  if (waits.length) { const A = Object.fromEntries(q('SELECT * FROM accounts').map(x => [x.id, x]));
    h += `<h2 class="sect">Not in a bank file yet <span class="sub">${waits.length}</span></h2><div class="card"><p class="sub" style="margin-top:0">You entered these; the next bank file should confirm them. One still waiting after a month or two may be a mistake or a duplicate.</p><div class="txlist">${waits.slice(0, 100).map(t => txRow(t, A, true)).join('')}</div>${waits.length > 100 ? `<p class="sub">and ${waits.length - 100} older</p>` : ''}</div>`; }
  h += looseHtml(looseTransfers(id));
  h += `<div class="btns"><button class="btn light" data-act="find-xfer">Find transfers between accounts</button></div>`;
  if (ps.length && !ps.some(p => p.diff)) h += moodVerse('agree');
  view().innerHTML = h;
}
/* one month: the bank, your transactions, what may be wrong, and a correction in one tap */
function reconMonth(id, ym) {
  const a = q('SELECT * FROM accounts WHERE id=?', [id])[0]; if (!a) return;
  const c = a.currency || home(), cr = a.type === 'credit', ps = reconPeriods(a).filter(p => p.ym === ym), A = Object.fromEntries(q('SELECT * FROM accounts').map(x => [x.id, x]));
  const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v), c), show = v => cr ? money(Math.abs(v), c) : money(v, c);
  const ids = ps.flatMap(p => p.txs.map(t => t.id)), all = ids.length ? q(`SELECT * FROM transactions WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : [], dupIds = new Set();
  for (const t of all) for (const u of all) if (t.id < u.id && Math.abs(t.amount - u.amount) < 0.005 && t.kind === u.kind && Math.abs(dnum(t.date) - dnum(u.date)) <= 3) { dupIds.add(t.id); dupIds.add(u.id); }
  const blocks = ps.map((p, k) => `<div class="rblock"><div class="rrow"><span>${fmtDate(p.prev.date)} → ${fmtDate(p.check.date)}</span></div>
    <div class="rrow"><span>${a.type === 'cash' ? 'You counted' : cr ? 'Statement says you owe' : 'The bank says'}</span><b>${show(p.bank)}</b></div>
    <div class="rrow"><span>Your transactions say</span><b>${show(p.expected)}</b></div>
    <div class="rrow"><span>Difference</span><b class="${p.diff ? 'down' : 'up'}">${p.diff ? sgn(p.diff) : '✓ none'}</b></div>
    ${p.diff ? `<div class="btns"><button class="btn" data-f="fix" data-k="${k}">Add a correction of ${sgn(p.diff)}</button></div>` : ''}</div>`).join('');
  const dups = all.filter(t => dupIds.has(t.id)), waits = all.filter(t => isWaiting(t, id) && !dupIds.has(t.id));
  openSheet(`<h2>${ymLabel(ym)} · ${esc(a.name)}</h2>${blocks}
    ${ps.some(p => p.diff) ? `<p class="hint">First look for the cause: ${dups.length ? 'entries that may be doubled, ' : ''}${waits.length ? 'entries no bank file has shown, ' : ''}a missing entry (import this month's bank file: only what is missing is added), or a wrong amount. If you cannot find it, add a correction so the balance continues from the bank's figure; it is kept under "Balance corrections" and not counted as spending.</p>` : ''}
    ${dups.length ? `<h3 class="ieh">Same amount within 3 days: doubled?</h3><div class="txlist">${dups.map(t => txRow(t, A, true)).join('')}</div>` : ''}
    ${waits.length ? `<h3 class="ieh">Not in a bank file</h3><div class="txlist">${waits.map(t => txRow(t, A, true)).join('')}</div>` : ''}
    <div class="btns">${a.type === 'cash' ? '' : '<button class="btn light" data-f="imp">Import a bank file</button>'}<button class="btn light" data-f="list">All ${all.length} transactions</button></div>
    <div class="btns"><button class="btn light" data-f="cancel">Close</button></div>`, box => {
    box.onclick = e => { const tx = e.target.closest('[data-tx]'); if (tx) { closeSheet(); return txForm(+tx.dataset.tx); }
      const f = (e.target.closest('[data-f]') || {}).dataset; if (!f || !f.f) return;
      if (f.f === 'cancel') return closeSheet();
      if (f.f === 'imp') { closeSheet(); return bankImport(id); }
      if (f.f === 'list') { closeSheet(); state.tab = 'money'; state.msec = 'tx'; state.txAcct = String(id); state.txMonth = ym; render(); view().scrollTop = 0; return; }
      if (f.f === 'fix') { const p = ps[+f.k];
        addCorrection(id, p.check.date, p.diff, `Reconcile: the ${a.type === 'cash' ? 'count' : 'bank'} showed ${show(p.bank)} on ${fmtDate(p.check.date)}`, (p.check.created || 0) - 1);
        save(); toast('Correction added'); render(); reconMonth(id, ym); } };
  });
}

/* ---------------- 1.12: Overview cards fold too; a folded card or section can show its total ---------------- */
const cardFolded = k => folded().has('overview:card:' + k);
function foldBits(k, total) {
  return `<span class="ptot">${total}</span><button class="cfold" data-cfold="${k}" aria-label="Fold or unfold"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`;
}
function toggleCard(k) {
  const F = folded(), key = 'overview:card:' + k; if (F.has(key)) F.delete(key); else F.add(key);
  setSetting('folded', JSON.stringify(Array.from(F))); save();
  const c = view().querySelector(`.ocard[data-go="${k}"]`); if (c) c.classList.toggle('folded', F.has(key));
}
/* ---------------- 1.10: several transactions at once ----------------
   "Select several…" (or a long press on a transaction) turns on ticks; the bar at the bottom edits or deletes them. */
function pickTx(row, id) {
  if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id);
  row.classList.toggle('picked', state.sel.has(id)); const tk = row.querySelector('.tick'); if (tk) tk.classList.toggle('on', state.sel.has(id));
  selBar();
}
function selBar() {
  const b = document.getElementById('selbar'); if (!b) return;
  document.body.classList.toggle('selecting', !!state.sel);
  if (!state.sel) { b.hidden = true; return; }
  const n = state.sel.size, all = Array.from(view().querySelectorAll('[data-tx]')).length;
  b.innerHTML = `<span class="grip" title="Drag to move this bar" aria-label="Move the bar">⠿</span><span class="sn"><b>${n}</b> selected</span><button data-sel="all">${n && n === all ? 'None' : 'All'}</button><button data-sel="edit"${n ? '' : ' disabled'}>Edit</button><button data-sel="del" class="dz"${n ? '' : ' disabled'}>Delete</button><button data-sel="done" aria-label="Done">✕</button>`;
  b.hidden = false; placeSelBar();
}
/* 1.28: the bar can be dragged anywhere (it remembers where), so it never hides what you want to see */
let SELPOS = null; try { SELPOS = JSON.parse(localStorage.getItem('kjt_selbar') || 'null'); } catch (e) { SELPOS = null; }
function placeSelBar() {
  const b = document.getElementById('selbar'); if (!b || b.hidden) return;
  if (!SELPOS) { b.style.top = b.style.left = b.style.width = ''; b.style.bottom = b.style.right = ''; return; }
  const w = Math.min(b.offsetWidth || 360, window.innerWidth - 8), h = b.offsetHeight || 52;
  const x = Math.max(4, Math.min(window.innerWidth - w - 4, SELPOS.x)), y = Math.max(4, Math.min(window.innerHeight - h - 4, SELPOS.y));
  Object.assign(b.style, { top: y + 'px', left: x + 'px', bottom: 'auto', right: 'auto', width: w + 'px' });
}
(() => { const b = document.getElementById('selbar'); if (!b) return; let drag = null;
  b.addEventListener('pointerdown', e => { if (!e.target.closest('.grip')) return; e.preventDefault(); const r = b.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width }; b.setPointerCapture(e.pointerId); b.classList.add('moving'); });
  b.addEventListener('pointermove', e => { if (!drag) return; SELPOS = { x: e.clientX - drag.dx, y: e.clientY - drag.dy }; b.style.width = drag.w + 'px'; placeSelBar(); });
  const end = () => { if (!drag) return; drag = null; b.classList.remove('moving'); try { localStorage.setItem('kjt_selbar', JSON.stringify(SELPOS)); } catch (e) { /* fine */ } };
  b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  b.addEventListener('dblclick', e => { if (!e.target.closest('.grip')) return; SELPOS = null; try { localStorage.removeItem('kjt_selbar'); } catch (er) { /* fine */ } placeSelBar(); });
  window.addEventListener('resize', placeSelBar); })();
function endSel() { state.sel = null; selBar(); render(); }
document.getElementById('selbar').addEventListener('click', e => {
  const k = e.target.dataset.sel; if (!k || !state.sel) return;
  if (k === 'done') return endSel();
  if (k === 'all') { const ids = Array.from(view().querySelectorAll('[data-tx]')).map(r => +r.dataset.tx);
    state.sel = state.sel.size === ids.length ? new Set() : new Set(ids); const st = view().scrollTop; render(); view().scrollTop = st; return selBar(); }
  const ids = Array.from(state.sel); if (!ids.length) return;
  if (k === 'del') { ask(`Delete ${ids.length} transaction${ids.length > 1 ? 's' : ''}?`).then(y => { if (!y) return;
    db.exec('BEGIN'); for (const id of ids) run('DELETE FROM transactions WHERE id=?', [id]); db.exec('COMMIT'); save(); toast(ids.length + ' deleted'); endSel(); }); return; }
  if (k === 'edit') multiEditForm(ids);
});
function multiEditForm(ids) {
  const accts = q('SELECT * FROM accounts ORDER BY name').filter(acctOpen);
  openSheet(`<h2>Change ${ids.length} transaction${ids.length > 1 ? 's' : ''}</h2><p class="sub">Only what you change here is changed; the rest stays as it is.</p>
    <label class="f"><span>Category</span><select name="cat"><option value="keep">Keep as it is</option>${catOptions('any', null).replace('<option value="">No category</option>', '<option value="none">No category</option>')}</select></label>
    <label class="f"><span>Account</span><select name="acct"><option value="keep">Keep as it is</option>${accts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
    ${field('payee', 'Paid to / received from', '', 'autocomplete="off" placeholder="keep as it is"')}
    ${field('date', 'Date', '', 'type="date"')}<p class="hint">Leave the date empty to keep each one's date.</p>
    <label class="f"><span>Linked to something you own</span><select name="link"><option value="keep">Keep as it is</option>${linkOptions('').replace('<option value="">Not linked</option>', '<option value="none">Not linked</option>')}</select></label>
    <div class="btns"><button class="btn" data-f="save">Change ${ids.length}</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      const d = formData(box), sets = [], vals = [];
      if (d.cat !== 'keep') { sets.push('category_id=?'); vals.push(d.cat === 'none' ? null : +d.cat); }
      if (d.acct !== 'keep') { sets.push('account_id=?'); vals.push(+d.acct); }
      if ((d.payee || '').trim()) { sets.push('payee=?'); vals.push(d.payee.trim()); }
      if (d.date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return bad('Check the date.'); sets.push('date=?'); vals.push(d.date); }
      if (d.link !== 'keep') { sets.push('link=?'); vals.push(d.link === 'none' ? null : d.link); }
      if (!sets.length) return bad('Choose what to change.');
      db.exec('BEGIN');
      for (const id of ids) { const t = q('SELECT kind, to_account_id FROM transactions WHERE id=?', [id])[0]; if (!t) continue;
        /* transfers have no category or payee; a transfer cannot go to the account it comes from */
        const s2 = [], v2 = [];
        sets.forEach((s, i) => { if (t.kind === 'transfer' && /category_id|payee/.test(s)) return; if (/account_id/.test(s) && t.kind === 'transfer' && vals[i] === t.to_account_id) return; s2.push(s); v2.push(vals[i]); });
        if (s2.length) run(`UPDATE transactions SET ${s2.join(',')} WHERE id=?`, v2.concat([id])); }
      if (d.cat !== 'keep' && d.cat !== 'none') for (const id of ids) { const t = q('SELECT payee, kind FROM transactions WHERE id=?', [id])[0]; if (t && t.kind !== 'transfer' && t.payee) learnRule(t.payee, +d.cat, null); }
      db.exec('COMMIT'); save(); closeSheet(); toast(ids.length + ' changed · remembered for next time'); endSel(); };
  });
}
/* a long press on a transaction starts choosing several */
view().addEventListener('contextmenu', e => {
  const r = e.target.closest('.txrow[data-tx]'); if (!r) return;
  e.preventDefault(); if (!state.sel) { state.sel = new Set(); render(); }
  const row = view().querySelector(`.txrow[data-tx="${r.dataset.tx}"]`); if (row && !state.sel.has(+r.dataset.tx)) pickTx(row, +r.dataset.tx); selBar();
});

/* ---------------- 1.10: Back goes to the page you saw before ---------------- */
const NAVH = []; let navLast = null, navRestoring = false;
const NAVKEYS = ['tab', 'msec', 'propertyId', 'accountId', 'assetId', 'loanId', 'txAcct', 'txMonth', 'reconId'];
const navKey = s => ['tab', 'msec', 'propertyId', 'accountId', 'assetId', 'loanId', 'reconId'].map(k => s[k] == null ? '' : s[k]).join('|');
function navSnap() { const s = {}; for (const k of NAVKEYS) s[k] = state[k] == null ? null : state[k]; return s; }
function navBefore() {   /* called at the start of every render */
  const cur = navSnap();
  if (navLast && navKey(cur) !== navKey(navLast)) {
    if (!navRestoring) {   /* 1.22: going to a page already in the history goes back to it (no endless loops); at most 20 steps */
      const i = NAVH.findIndex(x => navKey(x) === navKey(cur));
      if (i >= 0) NAVH.length = i; else { navLast.scroll = view().scrollTop; NAVH.push(navLast); if (NAVH.length > 20) NAVH.shift(); } }
    if (state.sel) { state.sel = null; selBar(); }
  }
}
function navAfter() { navLast = navSnap(); navRestoring = false; document.getElementById('back').hidden = !NAVH.length && document.getElementById('back').hidden; }
function navRoot() { NAVH.length = 0; navLast = null; }   /* 1.22: the bottom bar, Settings and Search start fresh: Back then goes to Overview */
function navBack() {
  while (NAVH.length) { const s = NAVH.pop(); if (navKey(s) === navKey(navSnap())) continue;
    navRestoring = true; for (const k of NAVKEYS) state[k] = s[k]; render(); view().scrollTop = s.scroll || 0; return true; }
  return false;
}

/* ---------------- 1.9: every section folds; long lists show a few and "Show all" ----------------
   Runs after each screen is drawn. Tap a section's heading to fold or unfold it; the app remembers. */
let FOLDED = null;
function folded() { if (!FOLDED) { try { FOLDED = new Set(JSON.parse(getSetting('folded', '[]'))); } catch (e) { FOLDED = new Set(); } } return FOLDED; }
const LIST_SHOW = 6;
function enhanceView() {
  document.documentElement.classList.toggle('nofoldtot', getSetting('fold_totals', '1') !== '1');
  const v = view(), F = folded(), page = state.tab + (state.msec && state.tab === 'money' ? '/' + state.msec : '');
  /* sections */
  for (const h of Array.from(v.querySelectorAll(':scope > h2.sect'))) {
    const title = (h.childNodes[0] && h.childNodes[0].textContent || h.textContent).trim(), key = page + ':' + title;
    const body = document.createElement('div'); body.className = 'foldbody';
    let n = h.nextSibling;
    while (n && !(n.nodeType === 1 && n.matches('h2.sect'))) { const nx = n.nextSibling; body.appendChild(n); n = nx; }
    h.after(body);
    h.classList.add('foldh'); h.setAttribute('role', 'button'); h.tabIndex = 0;
    if (h.dataset.ftot) h.insertAdjacentHTML('beforeend', `<span class="ftot">${esc(h.dataset.ftot)}</span>`);
    h.insertAdjacentHTML('beforeend', '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>');
    const set = closed => { h.classList.toggle('closed', closed); body.hidden = closed; h.setAttribute('aria-expanded', String(!closed)); };
    const fdef = !!h.dataset.fdef;   /* folded until you open it (the app remembers that) */
    set(fdef ? !F.has(key + '!open') : F.has(key));
    const toggle = () => { const c = !h.classList.contains('closed'); set(c); if (fdef) { if (c) F.delete(key + '!open'); else F.add(key + '!open'); } else if (c) F.add(key); else F.delete(key); setSetting('folded', JSON.stringify(Array.from(F))); save();
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
  if (fab) { const inDetail = state.propertyId || state.accountId || state.assetId || state.loanId;
    fab.hidden = !!state.sel || !(['overview', 'money', 'accounts'].includes(state.tab) && !(state.tab === 'accounts' && inDetail) && q('SELECT COUNT(*) n FROM accounts')[0].n); v.style.paddingBottom = fab.hidden ? '' : '96px'; }
}


/* ---------------- Sync between your devices, and merging two databases ----------------
   Every row has a lasting id (uid) and the time it last changed (mod); deletions leave a small note (sync_tomb).
   Merging another copy of the data (from the sync folder, or a file you pick):
   - a row only the other copy has is added; a row both have keeps the newer version;
   - a row deleted on one side is deleted on the other, unless it was changed there afterwards;
   - the same thing entered on two devices is recognised (same bank reference, same repeating payment on the
     same day, same account or category name…), so nothing is doubled.
   The sync folder is any folder your devices share, for example with Syncthing: the app keeps one file there,
   "KJT Finance data.kjtf" (encrypted when you use a passcode), and merges the copies other devices write. */
const SYNC_TABLES = ['categories', 'accounts', 'properties', 'metal_holdings', 'other_assets', 'loans', 'recurring', 'transactions',
  'account_balances', 'rent_periods', 'property_items', 'property_values', 'property_years', 'asset_values', 'loan_payments', 'payee_rules'];
const NOW_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const NOT_BUSY = 'NOT EXISTS (SELECT 1 FROM sync_busy)';
const SYNC_SETTINGS = /^(home_currency|metal_currency|fav_currencies|fx_source|metal_source|fold_totals|auto_prices|csvmap:.*)$/;
function syncMeta() {
  run('CREATE TABLE IF NOT EXISTS sync_tomb (tbl TEXT NOT NULL, uid TEXT NOT NULL, mod INTEGER, PRIMARY KEY(tbl, uid))');
  run('CREATE TABLE IF NOT EXISTS sync_busy (x INTEGER)'); run('DELETE FROM sync_busy');
  for (const t of SYNC_TABLES) {
    const cols = q(`PRAGMA table_info(${t})`).map(r => r.name); if (!cols.length) continue;
    if (!cols.includes('uid')) run(`ALTER TABLE ${t} ADD COLUMN uid TEXT`);
    if (!cols.includes('mod')) run(`ALTER TABLE ${t} ADD COLUMN mod INTEGER`);
    run(`UPDATE ${t} SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL`);
    run(`UPDATE ${t} SET mod = 1 WHERE mod IS NULL`);
    run(`CREATE UNIQUE INDEX IF NOT EXISTS ${t}_uid ON ${t}(uid)`);
    run(`CREATE TRIGGER IF NOT EXISTS ${t}_si AFTER INSERT ON ${t} WHEN NEW.uid IS NULL OR NEW.mod IS NULL BEGIN UPDATE ${t} SET uid = COALESCE(NEW.uid, lower(hex(randomblob(16)))), mod = COALESCE(NEW.mod, ${NOW_MS}) WHERE rowid = NEW.rowid; END`);
    run(`CREATE TRIGGER IF NOT EXISTS ${t}_su AFTER UPDATE ON ${t} WHEN NEW.mod IS OLD.mod AND ${NOT_BUSY} BEGIN UPDATE ${t} SET mod = ${NOW_MS} WHERE rowid = NEW.rowid; END`);
    run(`CREATE TRIGGER IF NOT EXISTS ${t}_sd AFTER DELETE ON ${t} WHEN ${NOT_BUSY} BEGIN INSERT OR REPLACE INTO sync_tomb(tbl, uid, mod) VALUES('${t}', OLD.uid, ${NOW_MS}); END`);
  }
  if (!q('PRAGMA table_info(settings)').some(r => r.name === 'mod')) { run('ALTER TABLE settings ADD COLUMN mod INTEGER'); run('UPDATE settings SET mod = 1'); }
  run(`CREATE TRIGGER IF NOT EXISTS settings_si AFTER INSERT ON settings WHEN NEW.mod IS NULL BEGIN UPDATE settings SET mod = ${NOW_MS} WHERE key = NEW.key; END`);
  run(`CREATE TRIGGER IF NOT EXISTS settings_su AFTER UPDATE ON settings WHEN NEW.mod IS OLD.mod AND ${NOT_BUSY} BEGIN UPDATE settings SET mod = ${NOW_MS} WHERE key = NEW.key; END`);
}
/* the newest change in the data you would want on your other devices */
function dataStamp() {
  let m = 0;
  for (const t of SYNC_TABLES) { const r = q(`SELECT MAX(mod) m FROM ${t}`)[0]; if (r && r.m > m) m = r.m; }
  const tb = q('SELECT MAX(mod) m FROM sync_tomb')[0]; if (tb && tb.m > m) m = tb.m;
  for (const s of q('SELECT key, mod FROM settings')) if (SYNC_SETTINGS.test(s.key) && s.mod > m) m = s.mod;
  return m;
}
function qd(dbx, sql, params) { const st = dbx.prepare(sql), out = []; try { if (params) st.bind(params); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); } return out; }
/* what links one row to another, and how the same thing is recognised when entered on two devices */
const LINKS = { property: 'properties', metal: 'metal_holdings', asset: 'other_assets', loan: 'loans' };
const low = v => String(v == null ? '' : v).trim().toLowerCase();
const SYNC_SPEC = {
  categories: { fk: { parent_id: 'categories' }, nat: r => [r.kind, low(r.name), r.parent_id || 0] },
  accounts: { nat: r => [low(r.name), r.type, r.currency] },
  properties: { nat: r => [low(r.name)] },
  metal_holdings: { nat: r => [r.metal, low(r.description), r.purchase_date, r.quantity, r.weight] },
  other_assets: { nat: r => [low(r.name)] },
  loans: { nat: r => [low(r.person), r.date, r.amount] },
  recurring: { fk: { account_id: 'accounts', to_account_id: 'accounts', category_id: 'categories' }, link: true, nat: r => [r.account_id, low(r.payee), r.amount, r.freq, r.kind] },
  transactions: { fk: { account_id: 'accounts', to_account_id: 'accounts', category_id: 'categories', recurring_id: 'recurring' }, link: true,
    always: r => r.import_id ? ['imp', r.account_id, r.import_id] : r.recurring_id ? ['rec', r.recurring_id, r.date] : null,
    nat: r => [r.account_id, r.date, r.kind, r.amount, low(r.payee)] },
  account_balances: { fk: { account_id: 'accounts' }, nat: r => [r.account_id, r.date, r.balance] },
  rent_periods: { fk: { property_id: 'properties' }, nat: r => [r.property_id, r.start_date, r.monthly_rent] },
  property_items: { fk: { property_id: 'properties' }, nat: r => [r.property_id, r.kind, r.start_date, r.amount] },
  property_values: { fk: { property_id: 'properties' }, nat: r => [r.property_id, r.date, r.value] },
  property_years: { fk: { property_id: 'properties' }, nat: r => [r.property_id, r.year] },
  asset_values: { fk: { asset_id: 'other_assets' }, nat: r => [r.asset_id, r.date, r.value] },
  loan_payments: { fk: { loan_id: 'loans', account_id: 'accounts' }, nat: r => [r.loan_id, r.date, r.principal, r.interest] },
  payee_rules: { fk: { category_id: 'categories', to_account_id: 'accounts' }, nat: r => [r.pattern] },
};
const REQUIRED = { account_balances: 'account_id', transactions: 'account_id', recurring: 'account_id', rent_periods: 'property_id', property_items: 'property_id',
  property_values: 'property_id', property_years: 'property_id', asset_values: 'asset_id', loan_payments: 'loan_id' };
/* brings another copy of the data into this one. firstTime: the two copies were started separately, so things that look the same are the same */
function mergeDb(rdb, firstTime) {
  const st = { added: 0, updated: 0, deleted: 0, theirsOlder: 0 }, idmap = {}, tomb = {};
  for (const t of q('SELECT * FROM sync_tomb')) tomb[t.tbl + ':' + t.uid] = t.mod;
  run('INSERT INTO sync_busy VALUES (1)'); db.exec('BEGIN');
  try {
    for (const t of SYNC_TABLES) {
      const spec = SYNC_SPEC[t] || {}, lcols = q(`PRAGMA table_info(${t})`).map(c => c.name); if (!lcols.length) continue;
      let R; try { R = qd(rdb, `SELECT * FROM ${t}`); } catch (e) { continue; }
      if (t === 'categories') R.sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0));
      const L = q(`SELECT * FROM ${t}`), byUid = new Map(L.map(r => [r.uid, r])), remoteUids = new Set(R.map(r => r.uid));
      const key = (f, r) => { const k = f && f(r); return k ? JSON.stringify(k) : null; };
      const alwaysMap = new Map(), natMap = new Map();
      for (const r of L) { const a = key(spec.always, r); if (a) alwaysMap.set(a, r); if (!remoteUids.has(r.uid)) { const n = key(spec.nat, r); if (n && !natMap.has(n)) natMap.set(n, r); } }
      for (const r of L) if (!remoteUids.has(r.uid)) st.theirsOlder++;
      idmap[t] = {};
      for (const r0 of R) {
        const dead = tomb[t + ':' + r0.uid]; if (dead != null && dead >= r0.mod) continue;   /* deleted here after its last change there */
        const r = {}; for (const c of lcols) if (c !== 'id' && c in r0) r[c] = r0[c];
        let skip = false;
        for (const [c, ref] of Object.entries(spec.fk || {})) if (r[c] != null) { const m = (idmap[ref] || {})[r[c]]; r[c] = m == null ? null : m; }
        if (REQUIRED[t] && r[REQUIRED[t]] == null) skip = true;
        if (spec.link && r.link) { const [k, n] = String(r.link).split(':'); const m = LINKS[k] && (idmap[LINKS[k]] || {})[n]; r.link = m == null ? null : k + ':' + m; }
        if (skip) continue;
        let loc = byUid.get(r0.uid), adopt = null;
        if (!loc) { const a = key(spec.always, r); if (a && alwaysMap.has(a)) loc = alwaysMap.get(a); }
        if (!loc && (firstTime || t === 'categories' || t === 'accounts' || t === 'payee_rules')) { const n = key(spec.nat, r); if (n && natMap.has(n)) { loc = natMap.get(n); natMap.delete(n); } }
        if (loc && loc.uid !== r0.uid) adopt = loc.uid < r0.uid ? loc.uid : r0.uid;   /* both sides settle on the same id */
        const cols = Object.keys(r);
        if (!loc) {
          if (t === 'payee_rules' && q('SELECT id FROM payee_rules WHERE pattern=?', [r.pattern]).length) continue;
          run(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, cols.map(c => r[c]));
          idmap[t][r0.id] = q('SELECT last_insert_rowid() id')[0].id; st.added++;
        } else {
          idmap[t][r0.id] = loc.id;
          if ((r0.mod || 0) > (loc.mod || 0)) { if (adopt) r.uid = adopt; run(`UPDATE ${t} SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`, cols.map(c => r[c]).concat([loc.id])); st.updated++; }
          else { if ((loc.mod || 0) > (r0.mod || 0)) st.theirsOlder++; if (adopt && adopt !== loc.uid) run(`UPDATE ${t} SET uid=? WHERE id=?`, [adopt, loc.id]); }
        }
      }
    }
    /* deletions made on the other device */
    let RT = []; try { RT = qd(rdb, 'SELECT * FROM sync_tomb'); } catch (e) { RT = []; }
    for (const d of RT) {
      if (!SYNC_TABLES.includes(d.tbl)) continue;
      const loc = q(`SELECT id, mod FROM ${d.tbl} WHERE uid=?`, [d.uid])[0];
      if (loc && (loc.mod || 0) <= d.mod) { run(`DELETE FROM ${d.tbl} WHERE id=?`, [loc.id]); st.deleted++; }
      const mine = tomb[d.tbl + ':' + d.uid];
      if (mine == null || mine < d.mod) run('INSERT OR REPLACE INTO sync_tomb(tbl, uid, mod) VALUES(?,?,?)', [d.tbl, d.uid, d.mod]);
    }
    for (const t of Object.keys(tomb)) { const [tbl, uid] = t.split(':'); if (!RT.some(d => d.tbl === tbl && d.uid === uid)) { st.theirsOlder++; break; } }
    /* your choices (home currency, favourite currencies…) */
    let RS = []; try { RS = qd(rdb, 'SELECT * FROM settings'); } catch (e) { RS = []; }
    for (const s of RS) {
      if (!SYNC_SETTINGS.test(s.key)) continue;
      const loc = q('SELECT value, mod FROM settings WHERE key=?', [s.key])[0];
      if (!loc || (s.mod || 0) > (loc.mod || 0)) { run('INSERT INTO settings(key,value,mod) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, mod=excluded.mod', [s.key, s.value, s.mod || 1]); st.updated++; }
      else if ((loc.mod || 0) > (s.mod || 0)) st.theirsOlder++;
    }
    /* prices and rates: the newest of each; history: whatever is missing */
    for (const [t, k] of [['prices', 'symbol'], ['fx', 'currency']]) {
      let R = []; try { R = qd(rdb, `SELECT * FROM ${t}`); } catch (e) { R = []; }
      for (const r of R) { const loc = q(`SELECT updated FROM ${t} WHERE ${k}=?`, [r[k]])[0];
        if (!loc || String(r.updated || '') > String(loc.updated || '')) { const cols = Object.keys(r); run(`INSERT OR REPLACE INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, cols.map(c => r[c])); } }
    }
    for (const t of ['price_history', 'fx_history']) {
      let R = []; try { R = qd(rdb, `SELECT * FROM ${t}`); } catch (e) { R = []; }
      if (!R.length) continue; const cols = Object.keys(R[0]), stx = db.prepare(`INSERT OR IGNORE INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`);
      try { for (const r of R) stx.run(cols.map(c => r[c])); } finally { stx.free(); }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); run('DELETE FROM sync_busy'); throw e; }
  run('DELETE FROM sync_busy'); clearCats();
  return st;
}
/* opens a copy of the data (maybe encrypted) as a database, ready to merge */
async function openCopy(bytes, who) {
  if (isEncrypted(bytes)) {
    let o = CRYPT ? await decryptWith(bytes, null, CRYPT.raw) : null;
    if (!o) {
      let msg = '';
      for (let i = 0; i < 5 && !o; i++) {
        const v = await pad({ title: `${who} is protected: enter its passcode`, cancel: true, msg });
        if (v == null) break; o = await decryptWith(bytes, v); msg = 'Wrong passcode';
        if (o) { o.pass = v; }
      }
      hideLock(); if (!o) return null;
      /* from now on this device uses the same key as your other devices, so it never asks again */
      CRYPT = o.crypt; PREFS.pinLength = o.pass.length; await savePrefs(); native('secure', { on: true });
      if (PREFS.bio) native('bioEnable', { dek: bytesToB64(CRYPT.raw) });
      toast('From now on use that passcode on this device too');
    }
    bytes = o.plain;
  }
  let c; try { c = new SQL.Database(bytes); } catch (e) { return null; }
  if (!isOurDb(c)) { c.close(); return null; }
  const keep = db; db = c; try { prepareDb(); } finally { db = keep; } clearCats();
  return c;
}
/* ---- the sync folder ---- */
const SYNC_FILE = 'KJT Finance data.kjtf';
const SYNC = { on: false, label: '', busy: false, last: null, err: null, timer: null };
async function syncInit() {
  const r = await native('syncInfo', {}); SYNC.on = !!r.set; SYNC.label = r.label || '';
  if (SYNC.on) syncNow();
  if (!SYNC.timer) SYNC.timer = setInterval(() => { if (!document.hidden && SYNC.on) syncNow(); }, 20000);
}
let syncSoonT = null;
function syncSoon() { if (!SYNC.on) return; clearTimeout(syncSoonT); syncSoonT = setTimeout(syncNow, 4000); }
async function syncNow(manual) {
  if (!SYNC.on || SYNC.busy || !db || (!manual && nativeBusy)) return; SYNC.busy = true;
  try {
    const l = await native('syncList', {}); if (l.error) { SYNC.err = l.error; if (manual) toast('Sync folder: ' + l.error); return; }
    const files = l.files || [], main = files.find(f => f.name === SYNC_FILE);
    const conflicts = files.filter(f => /^KJT Finance data\.sync-conflict-.*\.kjtf$/.test(f.name));
    let needWrite = !main || dataStamp() > +getSetting('sync_wrote', '0'), got = null;
    const sig = main ? main.mtime + ':' + main.size : '';
    for (const f of (main && sig !== getSetting('sync_seen', '') ? [main] : []).concat(conflicts)) {
      const rd = await native('syncRead', { name: f.name }); if (!rd.b64) continue;
      const c = await openCopy(b64ToBytes(rd.b64), 'The data from your other device'); if (!c) { SYNC.err = 'could not open ' + f.name; continue; }
      const s = mergeDb(c, false); c.close();
      got = got || { added: 0, updated: 0, deleted: 0 }; got.added += s.added; got.updated += s.updated; got.deleted += s.deleted;
      if (s.theirsOlder || f !== main) needWrite = true;
      if (f !== main) await native('syncDelete', { name: f.name });
    }
    if (main && sig) setSetting('sync_seen', sig);
    if (got && (got.added || got.updated || got.deleted)) { await saveNow(); const st = view().scrollTop; render(); view().scrollTop = st;
      if (manual || got.added + got.updated + got.deleted) toast(`Synced: ${got.added} added, ${got.updated} updated, ${got.deleted} removed`); }
    if (needWrite) {
      const w = await native('syncWrite', { name: SYNC_FILE, b64: bytesToB64(await fileBytes()) });
      if (w.error) { SYNC.err = w.error; return; }
      setSetting('sync_wrote', String(dataStamp()));
      const l2 = await native('syncList', {}); const m2 = (l2.files || []).find(f => f.name === SYNC_FILE); if (m2) setSetting('sync_seen', m2.mtime + ':' + m2.size);
      await saveNow();
    }
    SYNC.err = null; SYNC.last = Date.now();
    if (manual && !got) toast('Everything is in sync');
  } catch (e) { SYNC.err = String(e.message || e); if (manual) toast('Sync failed: ' + SYNC.err); }
  finally { SYNC.busy = false; }
}
async function syncSetup() {
  const r = await native('syncPick', {}); if (!r.ok) { if (r.error) toast('Could not use that folder: ' + r.error); return; }
  SYNC.on = true; SYNC.label = r.label || '';
  setSetting('sync_seen', ''); setSetting('sync_wrote', '0');
  const l = await native('syncList', {}); const there = (l.files || []).some(f => f.name === SYNC_FILE);
  if (there) {
    const choice = await new Promise(res => openSheet(`<h2>Data from another device is here</h2>
      <p class="sub">This folder already has KJT Finance data, probably from your other device. What should this device do?</p>
      <div class="btns"><button class="btn" data-f="merge">Combine both (recommended)</button></div>
      <div class="btns"><button class="btn light" data-f="theirs">Use only the folder's data (this device's data is replaced)</button></div>
      <div class="btns"><button class="btn light" data-f="mine">Use only this device's data (the folder's is replaced)</button></div>
      <div class="btns"><button class="btn light" data-f="cancel">Cancel</button></div>`, box => { box.onclick = e => { const f = e.target.dataset.f; if (f) { closeSheet(); res(f); } }; }));
    if (choice === 'cancel') { await native('syncForget', {}); SYNC.on = false; render(); return; }
    if (choice === 'mine') { await native('syncWrite', { name: SYNC_FILE, b64: bytesToB64(await fileBytes()) }); setSetting('sync_wrote', String(dataStamp())); await syncNow(true); render(); return; }
    const rd = await native('syncRead', { name: SYNC_FILE }); const c = rd.b64 ? await openCopy(b64ToBytes(rd.b64), 'The data in the folder') : null;
    if (!c) { await native('syncForget', {}); SYNC.on = false; render(); return toast('Could not open the data in the folder.'); }
    if (choice === 'theirs') { db.close(); db = c; prepareDb(); loadFx(); setSetting('sync_seen', ''); setSetting('sync_wrote', String(dataStamp())); }
    else { const s = mergeDb(c, true); c.close(); toast(`Combined: ${s.added} added, ${s.updated} updated`); }
    await saveNow();
  }
  await syncNow(true);
  if (!SYNC.timer) SYNC.timer = setInterval(() => { if (!document.hidden && SYNC.on) syncNow(); }, 20000);
  render();
}
async function syncStop() {
  if (!await ask('Stop syncing this device? Your data stays here; the file in the folder stays too.', 'Stop syncing')) return;
  await native('syncForget', {}); SYNC.on = false; render();
}
/* ---- merging a file you pick (for example an export from another device) ---- */
async function mergeFile() {
  const r = await native('importDb', {}); if (!r.b64) { if (r.error) toast('Could not open the file: ' + r.error); return; }
  const c = await openCopy(b64ToBytes(r.b64), 'This file'); if (!c) return toast('That file is not a KJT Finance database.');
  if (!await ask('Combine that file with the data here? Nothing is doubled: what is the same is recognised, and newer changes win.', 'Combine')) { c.close(); return; }
  const s = mergeDb(c, true); c.close(); await saveNow(); syncSoon();
  toast(`Combined: ${s.added} added, ${s.updated} updated, ${s.deleted} removed`); render();
}
function syncCard() {
  return `<h2 class="sect">Sync between your devices</h2><div class="card">` + (SYNC.on
    ? `<p class="sub">Syncing through the folder <b>${esc(SYNC.label || 'chosen')}</b>${SYNC.last ? ' · last checked ' + new Date(SYNC.last).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : ''}.${SYNC.err ? ` <span class="down">Problem: ${esc(SYNC.err)}</span>` : ''}</p>
      <p class="sub">Changes from your other devices come in by themselves while the app is open; changes made at the same time on two devices are combined.</p>
      <div class="btns"><button class="btn" data-act="sync-now">Sync now</button><button class="btn light" data-act="sync-stop">Stop syncing</button></div>`
    : `<p class="sub">Keep the same data on your phone and computer, privately: no account and no cloud.</p>
      <ol class="steps"><li>Install <b>Syncthing</b> on each device (Android: <b>Syncthing-Fork</b> from F-Droid; Fedora: from Software; postmarketOS: the <i>syncthing</i> package).</li>
      <li>In Syncthing, share one folder between your devices, for example <i>KJT Finance</i>.</li>
      <li>Here, choose that folder. Do the same on each device.</li></ol>
      <div class="btns"><button class="btn" data-act="sync-setup">Choose the sync folder</button></div>`) +
    `<h3 class="ieh">Without Syncthing</h3><p class="sub">Export the database on one device (Settings › Your data), bring the file to the other (USB, email, KDE Connect…), then press this there. What is the same is recognised, newer changes win, nothing is doubled.</p>
    <div class="btns"><button class="btn light" data-act="merge-file">Combine with a database file…</button></div></div>`;
}

/* ================= 1.15 ================= */
/* ---- MMEX (Money Manager Ex) import: reads its .mmb database directly ----
   Accounts (with their opening balances), categories (deeper levels become category › sub / sub),
   every transaction (split ones become one line per split; voided and deleted ones are left out),
   transfers, payees (remembered with their category), scheduled bills (repeating) and assets.
   Each MMEX transaction remembers its MMEX number, so importing the same file again adds only what is new. */
const MMEX_ASSET = t => /^(asset|assets)$/i.test(String(t || '').trim());   /* 1.27: MMEX asset accounts hold property, metals, cars: not money */
const MMEX_TYPES = { cash: 'cash', checking: 'chequing', 'credit card': 'credit', term: 'gic', loan: 'other', investment: 'other', shares: 'other', asset: 'other' };
const MMEX_FREQ = { 1: 'weekly', 2: 'biweekly', 3: 'monthly', 4: 'bimonthly', 5: 'quarterly', 6: 'halfyearly', 7: 'yearly' };
function mmexCols(m, t) { try { return qd(m, `PRAGMA table_info(${t})`).map(c => c.name); } catch (e) { return []; } }
function mmexRead(m) {
  const cur = {}; for (const c of (mmexCols(m, 'CURRENCYFORMATS_V1').length ? qd(m, 'SELECT * FROM CURRENCYFORMATS_V1') : [])) cur[c.CURRENCYID] = c.CURRENCY_SYMBOL || c.CURRENCYNAME;
  const tc = mmexCols(m, 'CHECKINGACCOUNT_V1'), live = [tc.includes('DELETEDTIME') ? "(DELETEDTIME IS NULL OR DELETEDTIME='')" : '1', "COALESCE(STATUS,'')<>'V'"].join(' AND ');
  const accts = qd(m, 'SELECT * FROM ACCOUNTLIST_V1 ORDER BY ACCOUNTNAME').map(a => {
    const n = qd(m, `SELECT COUNT(*) n, MIN(substr(TRANSDATE,1,10)) a, MAX(substr(TRANSDATE,1,10)) b FROM CHECKINGACCOUNT_V1 WHERE (ACCOUNTID=? OR TOACCOUNTID=?) AND ${live}`, [a.ACCOUNTID, a.ACCOUNTID])[0];
    return { id: a.ACCOUNTID, name: a.ACCOUNTNAME, type: MMEX_TYPES[low(a.ACCOUNTTYPE)] || 'other', mtype: a.ACCOUNTTYPE, cur: cur[a.CURRENCYID] || home(), init: +a.INITIALBAL || 0,
      initDate: a.INITIALDATE ? String(a.INITIALDATE).slice(0, 10) : null, closed: low(a.STATUS) === 'closed', heldAt: a.HELDAT || '', notes: a.NOTES || '',
      limit: +a.CREDITLIMIT || null, rate: +a.INTERESTRATE || null, n: n.n, from: n.a, to: n.b };
  });
  return { accts, live, tc };
}
async function mmexImport() {
  const r = await native('importDb', { title: 'Choose your MMEX database (.mmb)', filter: 'mmex' });
  if (!r.b64) { if (r.error) toast('Could not open the file: ' + r.error); return; }
  let m; try { m = new SQL.Database(b64ToBytes(r.b64)); qd(m, 'SELECT 1 FROM ACCOUNTLIST_V1 LIMIT 1'); }
  catch (e) { return toast('This is not an MMEX database (.mmb). If it ends in .emb, save it as .mmb in MMEX first.'); }
  const info = mmexRead(m), accts = q('SELECT * FROM accounts ORDER BY name');
  openSheet(`<h2>Import from MMEX</h2><p class="sub">${info.accts.length} accounts. Choose where each one goes; "New" makes the account here with its opening balance.</p>
    ${info.accts.map((a, i) => `<div class="mpart"><div class="mph"><b>${esc(a.name)}</b> <span class="sub">${esc(a.mtype)} · ${esc(a.cur)} · ${a.n} transaction${a.n === 1 ? '' : 's'}${a.from ? ' · ' + fmtDate(a.from) + ' – ' + fmtDate(a.to) : ''}${a.closed ? ' · closed' : ''}</span></div>
      <select name="to${i}">${MMEX_ASSET(a.mtype) ? `<option value="asset">Not money: its payments become purchases of ${esc(a.name)}</option>` : ''}<option value="new">New account: ${esc(a.name)}</option><option value="skip">Skip it</option>${accts.map(x => `<option value="${x.id}"${low(x.name) === low(a.name) ? ' selected' : ''}>Into ${esc(x.name)}</option>`).join('')}</select></div>`).join('')}
    <label class="switch"><span>Payees: remember their categories</span><input type="checkbox" name="payees" checked></label>
    <label class="switch"><span>Scheduled bills: as repeating transactions</span><input type="checkbox" name="bills" checked></label>
    <label class="switch"><span>Assets</span><input type="checkbox" name="assets" checked></label>
    <p class="hint">Importing the same MMEX file again later adds only what is new.</p>
    <div class="btns"><button class="btn" data-f="go">Import</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    info.accts.forEach((a, i) => { const s = box.querySelector(`[name=to${i}]`); if (MMEX_ASSET(a.mtype)) s.value = 'asset'; else if (!accts.some(x => low(x.name) === low(a.name))) s.value = a.n || !a.closed ? 'new' : 'skip'; });
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') { m.close(); return closeSheet(); }
      const map = {}; info.accts.forEach((a, i) => { map[a.id] = box.querySelector(`[name=to${i}]`).value; });
      const opt = { payees: box.querySelector('[name=payees]').checked, bills: box.querySelector('[name=bills]').checked, assets: box.querySelector('[name=assets]').checked };
      let st;
      db.exec('BEGIN');
      try { st = mmexDo(m, info, map, opt); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); m.close(); return bad('Import failed: ' + err.message); }
      m.close(); clearCats(); save(); closeSheet();
      toast(`MMEX: ${st.tx} transactions, ${st.accts} accounts, ${st.cats} categories${st.rules ? ', ' + st.rules + ' payees' : ''}${st.bills ? ', ' + st.bills + ' repeating' : ''}${st.assets ? ', ' + st.assets + ' assets' : ''}${st.again ? ' (' + st.again + ' already here)' : ''}`);
      state.tab = 'accounts'; state.accountId = null; render(); view().scrollTop = 0; };
  });
}
function mmexDo(m, info, map, opt) {
  const st = { tx: 0, accts: 0, cats: 0, rules: 0, bills: 0, assets: 0, again: 0, skipped: 0 }, B = Date.now();
  /* categories: MMEX 1.6+ (PARENTID, any depth) or older (CATEGORY + SUBCATEGORY) */
  const cc = mmexCols(m, 'CATEGORY_V1'), nested = cc.includes('PARENTID');
  const catRows = cc.length ? qd(m, 'SELECT * FROM CATEGORY_V1') : [], byId = {}; for (const c of catRows) byId[c.CATEGID] = c;
  const subRows = !nested && mmexCols(m, 'SUBCATEGORY_V1').length ? qd(m, 'SELECT * FROM SUBCATEGORY_V1') : [], subById = {}; for (const s of subRows) subById[s.SUBCATEGID] = s;
  const path = (cid, sid) => {   /* -> [top, sub] names */
    if (!nested) { const c = byId[cid]; if (!c) return null; const s = sid > 0 ? subById[sid] : null; return [c.CATEGNAME, s ? s.SUBCATEGNAME : null]; }
    const chain = []; let c = byId[cid], guard = 0; while (c && guard++ < 20) { chain.unshift(c.CATEGNAME); c = c.PARENTID > 0 ? byId[c.PARENTID] : null; }
    return chain.length ? [chain[0], chain.length > 1 ? chain.slice(1).join(' / ') : null] : null;
  };
  /* income or expense: from how each main category is used */
  const tc = info.tc, hasSub = tc.includes('SUBCATEGID'), use = {};
  for (const r of qd(m, `SELECT CATEGID${hasSub ? ', SUBCATEGID' : ''}, TRANSCODE, COUNT(*) n FROM CHECKINGACCOUNT_V1 WHERE ${info.live} GROUP BY CATEGID${hasSub ? ', SUBCATEGID' : ''}, TRANSCODE`)) {
    const p = path(r.CATEGID, r.SUBCATEGID); if (!p) continue; const u = use[low(p[0])] = use[low(p[0])] || { in: 0, out: 0 }; if (r.TRANSCODE === 'Deposit') u.in += r.n; else if (r.TRANSCODE === 'Withdrawal') u.out += r.n; }
  const catCache = {};
  const ensureCat = (cid, sid) => {
    const p = path(cid, sid); if (!p) return null; const k = low(p[0]) + '|' + low(p[1]);
    if (k in catCache) return catCache[k];
    const u = use[low(p[0])] || { in: 0, out: 0 }, kind = u.in > u.out ? 'in' : 'out';
    let top = q('SELECT * FROM categories WHERE parent_id IS NULL AND lower(name)=lower(?) ORDER BY kind=? DESC LIMIT 1', [p[0], kind])[0];
    if (!top) { run('INSERT INTO categories(name,parent_id,kind,sort) VALUES(?,?,?,?)', [p[0], null, kind, 500]); top = { id: q('SELECT last_insert_rowid() id')[0].id, kind }; st.cats++; }
    let id = top.id;
    if (p[1]) { const s = q('SELECT id FROM categories WHERE parent_id=? AND lower(name)=lower(?)', [top.id, p[1]])[0];
      if (s) id = s.id; else { run('INSERT INTO categories(name,parent_id,kind,sort) VALUES(?,?,?,?)', [p[1], top.id, top.kind, 501]); id = q('SELECT last_insert_rowid() id')[0].id; st.cats++; } }
    return (catCache[k] = id);
  };
  /* accounts */
  const acc = {}, assetAcct = {}, toLink = [];
  for (const a of info.accts) {
    const v = map[a.id]; if (v === 'skip') continue;
    if (v === 'asset') { assetAcct[a.id] = a.name; continue; }
    if (v === 'new') {
      run('INSERT INTO accounts(name,type,institution,currency,interest_rate,owners,notes,share_pct,credit_limit) VALUES(?,?,?,?,?,1,?,100,?)',
        [a.name, a.type, a.heldAt, a.cur, a.type === 'credit' ? null : a.rate, (a.notes + (a.closed ? ' (closed in MMEX)' : '')).trim(), a.type === 'credit' ? a.limit : null]);
      if (a.closed) run("UPDATE accounts SET status='closed' WHERE id=last_insert_rowid()");
      acc[a.id] = q('SELECT last_insert_rowid() id')[0].id; st.accts++;
      /* the opening balance, on or before the first transaction, so every MMEX transaction counts as it did in MMEX */
      const d = [a.initDate, a.from].filter(Boolean).sort()[0] || today();
      run('INSERT INTO account_balances(account_id,date,balance,note,created) VALUES(?,?,?,?,?)', [acc[a.id], d, a.type === 'credit' ? Math.max(0, -a.init) : a.init, 'Opening balance (MMEX)', B - 1]);
    } else acc[a.id] = +v;
  }
  /* payees */
  const pc = mmexCols(m, 'PAYEE_V1'), payees = {}; for (const p of (pc.length ? qd(m, 'SELECT * FROM PAYEE_V1') : [])) payees[p.PAYEEID] = p;
  /* splits */
  const splits = {}; if (mmexCols(m, 'SPLITTRANSACTIONS_V1').length) for (const s of qd(m, 'SELECT * FROM SPLITTRANSACTIONS_V1')) (splits[s.TRANSID] = splits[s.TRANSID] || []).push(s);
  const have = new Set(q("SELECT import_id FROM transactions WHERE import_id LIKE 'mmex:%'").map(r => r.import_id));
  const ins = db.prepare('INSERT INTO transactions(account_id,date,kind,amount,category_id,payee,note,to_account_id,link,recurring_id,created,import_id,to_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  try {
    for (const t of qd(m, `SELECT * FROM CHECKINGACCOUNT_V1 WHERE ${info.live} ORDER BY TRANSDATE, TRANSID`)) {
      const from = acc[t.ACCOUNTID], to = t.TOACCOUNTID > 0 ? acc[t.TOACCOUNTID] : null, date = String(t.TRANSDATE || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { st.skipped++; continue; }
      let kind = t.TRANSCODE === 'Deposit' ? 'in' : t.TRANSCODE === 'Transfer' ? 'transfer' : 'out', acct = from, toA = null, amt = Math.abs(+t.TRANSAMOUNT || 0);
      if (kind === 'transfer') {
        if (from && to) toA = to;
        else if (from) kind = 'out';                                     /* the other account was skipped, or is an asset: a purchase */
        else if (to) { kind = 'in'; acct = to; amt = Math.abs(+t.TOTRANSAMOUNT || amt); }   /* sold, or money from a skipped account */
      }
      const assetName = kind !== 'transfer' && t.TRANSCODE === 'Transfer' ? (assetAcct[t.TOACCOUNTID] || assetAcct[t.ACCOUNTID] || null) : null;
      const fromCur = (info.accts.find(x => x.id === t.ACCOUNTID) || {}).cur, toCur = (info.accts.find(x => x.id === t.TOACCOUNTID) || {}).cur;
      const toAmt = kind === 'transfer' && +t.TOTRANSAMOUNT > 0 && (Math.abs((+t.TOTRANSAMOUNT || 0) - (+t.TRANSAMOUNT || 0)) > 0.004 || fromCur !== toCur) ? Math.abs(+t.TOTRANSAMOUNT) : null;
      if (!acct) continue;
      const payee = kind === 'transfer' ? null : (payees[t.PAYEEID] || {}).PAYEENAME || null;
      const note = [t.NOTES, t.TRANSACTIONNUMBER ? '#' + t.TRANSACTIONNUMBER : ''].filter(Boolean).join(' ').slice(0, 200);
      const parts = splits[t.TRANSID] && kind !== 'transfer' ? splits[t.TRANSID] : null;
      if (parts) {
        for (const s of parts) { const iid = `mmex:${t.TRANSID}:${s.SPLITTRANSID}`; if (have.has(iid)) { st.again++; continue; }
          const v = +s.SPLITTRANSAMOUNT || 0, k = v < 0 ? (kind === 'in' ? 'out' : 'in') : kind;
          ins.run([acct, date, k, Math.abs(v), ensureCat(s.CATEGID, s.SUBCATEGID), payee, [note, s.NOTES, '(split)'].filter(Boolean).join(' ').slice(0, 200), null, null, null, B, iid, null]); st.tx++; }
      } else {
        const iid = 'mmex:' + t.TRANSID; if (have.has(iid)) { st.again++; continue; }
        ins.run([acct, date, kind, amt, kind === 'transfer' || assetName ? null : ensureCat(t.CATEGID, t.SUBCATEGID), assetName ? assetName : payee, note, toA, null, null, B, iid, toAmt]); st.tx++;
        if (assetName) toLink.push([iid, assetName]);
      }
    }
  } finally { ins.free(); }
  /* 1.18: what you marked as reconciled in MMEX counts as confirmed by the bank */
  if (tc.includes('STATUS')) for (const t of qd(m, `SELECT TRANSID FROM CHECKINGACCOUNT_V1 WHERE STATUS='R' AND ${info.live}`))
    run("UPDATE transactions SET bank_ok=COALESCE(bank_ok,1) WHERE import_id=? OR import_id LIKE ?", ['mmex:' + t.TRANSID, 'mmex:' + t.TRANSID + ':%']);
  /* payees remember their category */
  if (opt.payees) for (const p of Object.values(payees)) { if (!(p.CATEGID > 0) || !p.PAYEENAME) continue; const c = ensureCat(p.CATEGID, p.SUBCATEGID); const pat = normPayee(p.PAYEENAME);
    if (c && pat && !q('SELECT id FROM payee_rules WHERE pattern=?', [pat]).length) { run('INSERT INTO payee_rules(pattern,category_id,created) VALUES(?,?,?)', [pat, c, B]); st.rules++; } }
  /* scheduled bills */
  if (opt.bills && mmexCols(m, 'BILLSDEPOSITS_V1').length) for (const b of qd(m, 'SELECT * FROM BILLSDEPOSITS_V1')) {
    const freq = MMEX_FREQ[(+b.REPEATS || 0) % 100], from = acc[b.ACCOUNTID]; if (!freq || !from) continue;
    const kind = b.TRANSCODE === 'Deposit' ? 'in' : b.TRANSCODE === 'Transfer' && acc[b.TOACCOUNTID] ? 'transfer' : 'out', payee = kind === 'transfer' ? null : (payees[b.PAYEEID] || {}).PAYEENAME || null;
    const nd = String(b.NEXTOCCURRENCEDATE || b.TRANSDATE || today()).slice(0, 10);
    if (q("SELECT id FROM recurring WHERE account_id=? AND COALESCE(payee,'')=? AND amount=? AND freq=?", [from, payee || '', Math.abs(+b.TRANSAMOUNT || 0), freq]).length) continue;
    run('INSERT INTO recurring(account_id,kind,amount,category_id,payee,note,to_account_id,link,freq,next_date,auto,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)',
      [from, kind, Math.abs(+b.TRANSAMOUNT || 0), kind === 'transfer' ? null : ensureCat(b.CATEGID, b.SUBCATEGID), payee, b.NOTES || '', kind === 'transfer' ? acc[b.TOACCOUNTID] : null, null, freq, nd, +b.REPEATS >= 200 ? 1 : 0]); st.bills++;
  }
  /* assets */
  if (opt.assets && mmexCols(m, 'ASSETS_V1').length) {
    const cur = {}; if (mmexCols(m, 'CURRENCYFORMATS_V1').length) for (const c of qd(m, 'SELECT * FROM CURRENCYFORMATS_V1')) cur[c.CURRENCYID] = c.CURRENCY_SYMBOL;
    const AT = { automobile: 'car', jewellery: 'jewelry', jewelry: 'jewelry', art: 'art', 'household object': 'equipment' };
    for (const a of qd(m, 'SELECT * FROM ASSETS_V1')) {
      if (low(a.ASSETSTATUS) === 'closed') continue; const c = cur[a.CURRENCYID] || home(), d = a.STARTDATE ? String(a.STARTDATE).slice(0, 10) : null;
      if (low(a.ASSETTYPE) === 'property') { if (q('SELECT id FROM properties WHERE lower(name)=lower(?)', [a.ASSETNAME]).length) continue;
        run('INSERT INTO properties(name,currency,purchase_date,purchase_price,notes,owners,type,share_pct) VALUES(?,?,?,?,?,1,?,100)', [a.ASSETNAME, c, d, +a.VALUE || 0, a.NOTES || '', 'house']); }
      else { if (q('SELECT id FROM other_assets WHERE lower(name)=lower(?)', [a.ASSETNAME]).length) continue;
        run('INSERT INTO other_assets(name,type,purchase_date,purchase_price,currency,owners,notes,share_pct) VALUES(?,?,?,?,?,1,?,100)', [a.ASSETNAME, AT[low(a.ASSETTYPE)] || 'other', d, +a.VALUE || 0, c, a.NOTES || '']); }
      st.assets++;
    }
  }
  /* 1.27: payments into MMEX asset accounts: purchases, linked to the property or asset of the same name */
  for (const [iid, name] of toLink) linkPurchase(q('SELECT id FROM transactions WHERE import_id=?', [iid]).map(r => r.id), name);
  return st;
}
/* a payment for something you own: Savings & investments (Property, Precious metals or Big purchases), linked to it */
function linkPurchase(ids, name) {
  if (!ids.length) return;
  const pr = q('SELECT id FROM properties WHERE lower(name)=lower(?)', [name])[0], oa = pr ? null : q('SELECT id FROM other_assets WHERE lower(name)=lower(?)', [name])[0];
  const metal = /\b(gold|silver|platinum|palladium|au|ag|bullion)\b/i.test(name);
  const C = cats(), save = C.rows.find(c => !c.parent_id && c.kind === 'save' && /savings/i.test(c.name)) || C.rows.find(c => !c.parent_id && c.kind === 'save');
  let sub = save ? C.rows.find(c => c.parent_id === save.id && c.name === (pr ? 'Property' : metal ? 'Precious metals' : 'Big purchases')) : null;
  if (save && !sub) { run('INSERT INTO categories(name,parent_id,kind,sort) VALUES(?,?,?,?)', [pr ? 'Property' : metal ? 'Precious metals' : 'Big purchases', save.id, 'save', 950]); clearCats(); sub = { id: q('SELECT last_insert_rowid() id')[0].id }; }
  const link = pr ? 'property:' + pr.id : oa ? 'asset:' + oa.id : null;
  for (const id of ids) run('UPDATE transactions SET category_id=?, link=COALESCE(?, link) WHERE id=?', [sub ? sub.id : null, link, id]);
}

/* ---- imports you can undo ---- */
function importBatches() {
  return q(`SELECT created, COUNT(*) n, MIN(date) a, MAX(date) b, MAX(CASE WHEN import_id LIKE 'mmex:%' THEN 1 ELSE 0 END) mmex,
    GROUP_CONCAT(DISTINCT account_id) accts FROM transactions WHERE import_id IS NOT NULL AND created IS NOT NULL GROUP BY created ORDER BY created DESC LIMIT 12`);
}
function importsHtml() {
  const bs = importBatches(); if (!bs.length) return '';
  const A = Object.fromEntries(q('SELECT id, name FROM accounts').map(a => [a.id, a.name]));
  return `<h3 class="ieh">Recent imports</h3><div class="txns" style="margin-top:0">${bs.map(b => `<div class="txn"><div class="txn-top"><span class="txn-date">${new Date(b.created).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><span class="txn-desc">${b.mmex ? 'MMEX' : 'Bank file'}: ${b.n} transaction${b.n === 1 ? '' : 's'}</span></div>
    <div class="txn-body"><div class="sub">${String(b.accts || '').split(',').map(i => esc(A[i] || '?')).join(', ')} · ${fmtDate(b.a)} – ${fmtDate(b.b)}</div><div class="r"><button class="btn light small" data-act="undo-import" data-id="${b.created}">Undo</button></div></div></div>`).join('')}</div>`;
}
async function undoImport(created) {
  const n = q('SELECT COUNT(*) n FROM transactions WHERE created=? AND import_id IS NOT NULL', [created])[0].n;
  if (!await ask(`Remove the ${n} transactions of this import? The balances it set are removed too.`, 'Remove them')) return;
  run('DELETE FROM transactions WHERE created=? AND import_id IS NOT NULL', [created]);
  run("DELETE FROM account_balances WHERE created IN (?, ?) AND note IN ('From the bank file', 'Opening balance (MMEX)')", [created - 1, created + 1]);
  save(); toast(n + ' removed'); render();
}

/* ---- start fresh ---- */
async function startFresh() {
  if (!await ask('Erase ALL your data on this device (accounts, transactions, assets, loans…) and start fresh? Export a backup first if you are not sure. Your settings (look, currencies) stay.', 'Erase everything')) return;
  if (!await ask('Are you sure? This cannot be undone.', 'Yes, start fresh')) return;
  if (SYNC.on) { await native('syncForget', {}); SYNC.on = false; }
  run('INSERT INTO sync_busy VALUES (1)'); db.exec('BEGIN');
  try {
    for (const t of SYNC_TABLES.concat(['sync_tomb'])) { try { run(`DELETE FROM ${t}`); } catch (e) { } }
    run("DELETE FROM settings WHERE key IN ('import_map','folded','sync_seen','sync_wrote','cats_seeded','cats_v19','cats_v111') OR key LIKE 'csvmap:%'");
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); run('DELETE FROM sync_busy'); return bad('Could not erase: ' + e.message); }
  run('DELETE FROM sync_busy'); FOLDED = null; clearCats(); prepareDb(); await saveNow();
  Object.assign(state, { tab: 'overview', propertyId: null, accountId: null, assetId: null, loanId: null, txAcct: '', txCat: '', txSearch: '' });
  toast('Everything is erased: you can import your MMEX file now (Settings › Your data)'); render();
}

/* ---- payees: see them all, rename, merge, give a category ---- */
function payeeList() {
  const rows = q("SELECT payee, COUNT(*) n, SUM(CASE WHEN kind='out' THEN amount ELSE 0 END) outv, SUM(CASE WHEN kind='in' THEN amount ELSE 0 END) inv, MAX(date) last FROM transactions WHERE payee IS NOT NULL AND payee<>'' GROUP BY payee");
  const rules = payeeRules();
  for (const r of rows) { const rl = matchRule(r.payee, rules); r.rule = rl; r.cat = rl && rl.category_id;
    if (!r.cat) { const c = q('SELECT category_id, COUNT(*) n FROM transactions WHERE payee=? AND category_id IS NOT NULL GROUP BY category_id ORDER BY n DESC LIMIT 1', [r.payee])[0]; r.usual = c && c.category_id; } }
  return rows;
}
function payeesHtml() {
  const srt = state.psort || 'name', srch = low(state.psearch);
  let rows = payeeList(); if (srch) rows = rows.filter(r => low(r.payee).includes(srch));
  rows.sort(srt === 'n' ? (a, b) => b.n - a.n : srt === 'amt' ? (a, b) => (b.outv + b.inv) - (a.outv + a.inv) : srt === 'last' ? (a, b) => (b.last < a.last ? -1 : 1) : (a, b) => a.payee.localeCompare(b.payee, 'en', { sensitivity: 'base' }));
  const sel = state.psel || new Set();
  let h = `<h2 class="sect">Payees <span class="sub">who you pay and who pays you</span></h2><div class="card">
    <div class="f2"><label class="f"><span>Sort</span><select id="p-sort">${[['name', 'Name A–Z'], ['n', 'Most used'], ['amt', 'Largest total'], ['last', 'Most recent']].map(([k, l]) => `<option value="${k}"${k === srt ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f"><span>Search</span><input id="p-search" value="${esc(state.psearch || '')}" autocomplete="off" placeholder="name…"></label></div>
    <div class="btns"><button class="btn light" data-act="p-similar">Find similar payees</button>${rows.length && rows.length <= 300 && srch ? `<button class="btn light" data-act="p-tickall">Tick all ${rows.length} shown</button>` : ''}</div>
    ${sel.size ? `<div class="btns"><button class="btn" data-act="p-merge">Merge ${sel.size} into one…</button><button class="btn light" data-act="p-cat">Category for ${sel.size}…</button></div><div class="btns"><button class="btn light" data-act="p-clear">Untick all</button></div>`
      : '<p class="sub" style="margin:6px 0 0">Tick payees to merge them (e.g. "METRO #123" and "Metro") or give them a category together. Tap a name to rename it.</p>'}</div>`;
  if (!rows.length) return h + `<div class="card empty">No payees${srch ? ' match' : ' yet'}.</div>`;
  h += `<div class="card"><div class="txlist">${rows.map(r => `<div class="txrow prow${sel.has(r.payee) ? ' picked' : ''}"><span class="tick${sel.has(r.payee) ? ' on' : ''}" data-ptick="${esc(r.payee)}"></span>
    <div class="txl" data-payee="${esc(r.payee)}"><div class="txt">${esc(r.payee)}</div><div class="sub">${r.n} · ${r.cat ? '→ ' + esc(cats().label(r.cat)) : r.usual ? 'usually ' + esc(cats().label(r.usual)) : 'no category'}</div></div>
    <div class="txa" data-payee="${esc(r.payee)}">${whole(r.outv + r.inv, home())}</div></div>`).join('')}</div></div>`;
  return h;
}
function payeeForm(name) {
  const r = payeeList().find(x => x.payee === name); if (!r) return;
  const others = q("SELECT DISTINCT payee FROM transactions WHERE payee IS NOT NULL AND payee<>'' AND payee<>? ORDER BY payee LIMIT 500", [name]).map(x => x.payee);
  openSheet(`<h2>${esc(name)}</h2><p class="sub">${r.n} transaction${r.n === 1 ? '' : 's'} · last ${fmtDate(r.last)}</p>
    ${field('name', 'Name', name, 'autocomplete="off" list="p-others"')}<datalist id="p-others">${others.map(o => `<option value="${esc(o)}">`).join('')}</datalist>
    <p class="hint">Type the name of another payee to merge this one into it.</p>
    <label class="f"><span>Usual category (remembered for imports and typing)</span><select name="cat">${catOptions('any', r.cat || null)}</select></label>
    <label class="switch"><span>Also put its transactions without a category in it</span><input type="checkbox" name="fill" checked></label>
    <label class="switch"><span>Put ALL its transactions in it</span><input type="checkbox" name="all"></label>
    <div class="btns"><button class="btn" data-f="save">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>
    <div class="btns"><button class="btn light" data-f="list">See its transactions</button>${r.rule ? '<button class="btn light" data-f="forget">Forget its category</button>' : ''}</div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'list') { closeSheet(); Object.assign(state, { tab: 'money', msec: 'tx', txPer: 'all', txSearch: name, txCat: '' }); render(); return; }
      if (f === 'forget') { run('DELETE FROM payee_rules WHERE id=?', [r.rule.id]); save(); closeSheet(); render(); return; }
      const d = formData(box), nn = (d.name || '').trim(), cat = +d.cat || null; if (!nn) return bad('Enter a name.');
      db.exec('BEGIN');
      if (nn !== name) { run('UPDATE transactions SET payee=? WHERE payee=?', [nn, name]); run('UPDATE recurring SET payee=? WHERE payee=?', [nn, name]);
        if (r.rule && r.rule.pattern === normPayee(name)) run('DELETE FROM payee_rules WHERE id=?', [r.rule.id]); }
      if (cat) { learnRule(nn, cat, null);
        if (box.querySelector('[name=all]').checked) run("UPDATE transactions SET category_id=? WHERE payee=? AND kind<>'transfer'", [cat, nn]);
        else if (box.querySelector('[name=fill]').checked) run("UPDATE transactions SET category_id=? WHERE payee=? AND category_id IS NULL AND kind<>'transfer'", [cat, nn]); }
      db.exec('COMMIT'); save(); closeSheet(); toast(nn !== name ? 'Renamed' + (others.includes(nn) ? ' and merged' : '') : 'Saved'); render(); };
  });
}
function payeeMergeForm(names) {
  const sugg = names.slice().sort((a, b) => a.length - b.length)[0];
  openSheet(`<h2>Merge ${names.length} payees</h2><p class="sub">${names.map(esc).join(' · ')}</p>
    ${field('name', 'Keep them all as', sugg, 'autocomplete="off"')}
    <div class="btns"><button class="btn" data-f="go">Merge</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return; if (f === 'cancel') return closeSheet();
      const nn = (formData(box).name || '').trim(); if (!nn) return bad('Enter a name.');
      db.exec('BEGIN'); for (const n of names) { run('UPDATE transactions SET payee=? WHERE payee=?', [nn, n]); run('UPDATE recurring SET payee=? WHERE payee=?', [nn, n]); } db.exec('COMMIT');
      state.psel = new Set(); save(); closeSheet(); toast('Merged'); render(); };
  });
}
function payeeCatForm(names) {
  openSheet(`<h2>Category for ${names.length} payees</h2>
    <label class="f"><span>Category</span><select name="cat">${catOptions('any', null)}</select></label>
    <label class="switch"><span>Also change their existing transactions</span><input type="checkbox" name="all" checked></label>
    <div class="btns"><button class="btn" data-f="go">Save</button><button class="btn light" data-f="cancel">Cancel</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return; if (f === 'cancel') return closeSheet();
      const cat = +formData(box).cat; if (!cat) return bad('Choose a category.');
      db.exec('BEGIN'); for (const n of names) { learnRule(n, cat, null); if (box.querySelector('[name=all]').checked) run("UPDATE transactions SET category_id=? WHERE payee=? AND kind<>'transfer'", [cat, n]); } db.exec('COMMIT');
      state.psel = new Set(); save(); closeSheet(); toast('Saved'); render(); };
  });
}

/* ---- categories: merge, move, clean up ---- */
function catUse(id) { return q('SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM transactions WHERE category_id=?', [id])[0]; }
function catManage(id) {
  const C = cats(), c = C.byId[id]; if (!c) return;
  const subs = C.rows.filter(x => x.parent_id === id), u = catUse(id), tops = C.rows.filter(x => !x.parent_id && x.id !== id && x.id !== c.parent_id);
  openSheet(`<h2>${esc(C.label(id))}</h2><p class="sub">${u.n} transaction${u.n === 1 ? '' : 's'} · ${whole(u.s, home())}${subs.length ? ' · ' + subs.length + ' subcategories' : ''}</p>
    ${field('name', 'Name', c.name, 'autocomplete="off"')}
    <div class="btns"><button class="btn" data-f="rename">Save the name</button><button class="btn light" data-f="cancel">Close</button></div>
    <h3 class="ieh">Merge into another category</h3><label class="f"><span>Its transactions, repeats and remembered payees go to</span><select name="into"><option value="">Choose…</option>${catOptions('any', null).replace('<option value="">No category</option>', '')}</select></label>
    <div class="btns"><button class="btn light" data-f="merge">Merge</button></div>
    ${subs.length ? '' : `<h3 class="ieh">Move</h3><label class="f"><span>${c.parent_id ? 'Move under' : 'Make it a subcategory of'}</span><select name="under">${c.parent_id ? '<option value="top">Make it a main category</option>' : '<option value="">Choose…</option>'}${tops.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
      <div class="btns"><button class="btn light" data-f="move">Move</button></div>`}
    <div class="btns"><button class="btn danger" data-f="delete">Delete</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (!f) return;
      if (f === 'cancel') return closeSheet();
      if (f === 'delete') { closeSheet(); return catForm(id); }
      if (f === 'rename') { const n = (formData(box).name || '').trim(); if (!n) return bad('Enter a name.');
        const same = C.rows.find(x => x.id !== id && (x.parent_id || null) === (c.parent_id || null) && low(x.name) === low(n));
        if (same) { ask(`"${same.name}" already exists. Merge "${c.name}" into it? All its transactions, repeats and remembered payees move there.`, 'Merge').then(y => { if (!y) return; mergeCat(id, same.id); save(); closeSheet(); toast('Merged into ' + cats().label(same.id)); render(); }); return; }
        run('UPDATE categories SET name=? WHERE id=?', [n, id]); clearCats(); save(); closeSheet(); toast('Renamed: every transaction in it now shows "' + n + '"'); render(); return; }
      if (f === 'merge') { const into = +formData(box).into; if (!into || into === id) return bad('Choose the category to merge into.');
        mergeCat(id, into); save(); closeSheet(); toast('Merged into ' + cats().label(into)); render(); return; }
      if (f === 'move') { const v = formData(box).under; if (!v) return bad('Choose where to move it.');
        if (v === 'top') run('UPDATE categories SET parent_id=NULL WHERE id=?', [id]);
        else { const p = C.byId[+v]; run('UPDATE categories SET parent_id=?, kind=? WHERE id=?', [p.id, p.kind, id]); }
        clearCats(); save(); closeSheet(); render(); }
    };
  });
}
async function removeUnusedCats() {
  const used = new Set(q('SELECT DISTINCT category_id c FROM transactions WHERE category_id IS NOT NULL UNION SELECT DISTINCT category_id FROM recurring WHERE category_id IS NOT NULL UNION SELECT DISTINCT category_id FROM payee_rules WHERE category_id IS NOT NULL').map(r => r.c));
  const C = cats(), keep = new Set(['Transfers & card payments', 'Loans', 'Lent', 'Repaid', 'Interest', 'Cash spending']);
  const gone = C.rows.filter(c => !used.has(c.id) && !keep.has(c.name) && !C.rows.some(s => s.parent_id === c.id && (used.has(s.id) || keep.has(s.name))));
  if (!gone.length) return toast('Every category is in use');
  if (!await ask(`Remove ${gone.length} categories that nothing uses? (${gone.slice(0, 8).map(c => c.name).join(', ')}${gone.length > 8 ? '…' : ''})`, 'Remove them')) return;
  db.exec('BEGIN'); for (const c of gone.filter(c => c.parent_id)) run('DELETE FROM categories WHERE id=?', [c.id]); for (const c of gone.filter(c => !c.parent_id)) run('DELETE FROM categories WHERE id=?', [c.id]); db.exec('COMMIT');
  clearCats(); save(); toast(gone.length + ' removed'); render();
}

/* ---- this month, at a glance (like MMEX) ---- */
/* 1.24: what "This month" is made of, line by line, next to the Cash flow figures */
function monthSheet() {
  const H = home(), ym = today().slice(0, 7), x = ieModel()[ym] || { rent: 0, other: 0, interest: 0, hin: 0, costs: 0, byKind: {} };
  const A = Object.fromEntries(q('SELECT * FROM accounts').map(a => [a.id, a])), C = cats();
  let allIn = 0, allOut = 0, saveIn = 0, saveOut = 0, propIn = 0, propOut = 0;
  for (const t of q("SELECT * FROM transactions WHERE kind IN ('in','out') AND date>=? AND date<=?", [ym + '-01', today()])) {
    const v = conv(t.amount, (A[t.account_id] || {}).currency || H, H) || 0, top = C.top(t.category_id);
    if (t.kind === 'in') allIn += v; else allOut += v;
    if (t.link && t.link.startsWith('property:')) { if (t.kind === 'in') propIn += v; else propOut += v; }
    else if (top && top.kind === 'save') { if (t.kind === 'in') saveIn += v; else saveOut += v; }
  }
  const catOut = Object.entries(x.byKind).filter(([k]) => k.startsWith('cat:')).reduce((a, [, v]) => a + v, 0);
  const propCosts = Object.entries(x.byKind).filter(([k]) => !k.startsWith('cat:'));
  const row = (l, v, cls, sub) => `<div class="arow ie"><span class="al">${l}${sub ? `<span class="sub"><br>${sub}</span>` : ''}</span><span class="av ${cls || ''}">${whole(v, H)}</span><span class="ap"></span></div>`;
  const inc = x.rent + x.other + x.interest + (x.hin || 0);
  openSheet(`<h2>${new Date(ym + '-15T12:00:00').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}: what makes up the numbers</h2>
    <h3 class="ieh">Cash flow (every transaction, as under Cash flow)</h3><div class="alloc">
      ${row('Money in', allIn, 'up')}${row('Money out', allOut, 'down')}
      ${saveIn ? row('of the money in: savings, loans repaid, transfers in', saveIn, '', 'your own money coming back: not income') : ''}
      ${saveOut ? row('of the money out: savings, loans lent, transfers out', saveOut, '', 'money put aside or moved: not spending') : ''}
      ${propIn ? row('of the money in: linked to a property', propIn, '', 'counted with the property below') : ''}
      ${propOut ? row('of the money out: linked to a property', propOut, '', 'counted with the property below') : ''}</div>
    <h3 class="ieh">Income (this month)</h3><div class="alloc">
      ${row('Your income transactions', x.hin || 0, 'up', 'money in, without savings, loans and property-linked ones; your share of joint accounts')}
      ${x.rent ? row('Rent', x.rent, 'up', 'from the rent set on your properties (your share)') : ''}${x.other ? row('Other property income', x.other, 'up', 'set on the property, plus property-linked money in') : ''}
      ${x.interest ? row('Interest (estimated)', x.interest, 'up', 'from the interest rate set on savings accounts') : ''}
      ${row('<b>Income</b>', inc, 'up')}</div>
    <h3 class="ieh">Expenses (this month)</h3><div class="alloc">
      ${row('Your spending transactions', catOut, 'down', 'money out, without savings, loans and property-linked ones; your share of joint accounts')}
      ${propCosts.map(([k, v]) => row(esc(pmeta(k)[0]) + ' (property)', v, 'down', k.startsWith('linked') ? 'payments linked to a property' : 'set on the property page: check the amount and how often (a month, a year)')).join('')}
      ${row('<b>Expenses</b>', x.costs, 'down')}</div>
    <p class="hint">Property figures come from what is set on each property (rent, taxes, fees…), counted for the month. If one looks too high, open the property and check its amount and "how often".</p>
    <div class="btns"><button class="btn light" data-f="cf">Open Cash flow</button><button class="btn light" data-f="cancel">Close</button></div>`, box => {
    box.onclick = e => { const f = e.target.dataset.f; if (f === 'cancel') closeSheet(); if (f === 'cf') { closeSheet(); navRoot(); state.tab = 'money'; state.msec = 'tx'; render(); } };
  });
}
function monthCard() {
  const ym = today().slice(0, 7), x = ieModel()[ym] || { rent: 0, other: 0, interest: 0, hin: 0, costs: 0 }, H = home();
  const inc = x.rent + x.other + x.interest + (x.hin || 0), out = x.costs, mx = Math.max(inc, out, 1), net = inc - out;
  return `<h2 class="sect" data-ftot="${esc((net >= 0 ? '+' : '') + whole(net, H))}">This month <span class="sub">${new Date(ym + '-15T12:00:00').toLocaleDateString('en-CA', { month: 'long' })}</span></h2><div class="card tap" data-act="why-month">
    <div class="mrow"><span class="k up">Income</span><span class="v up">${whole(inc, H)}</span><span class="mb"><i class="mbi" style="width:${(inc / mx * 100).toFixed(1)}%"></i></span></div>
    <div class="mrow"><span class="k down">Expenses</span><span class="v down">${whole(out, H)}</span><span class="mb"><i class="mbo" style="width:${(out / mx * 100).toFixed(1)}%"></i></span></div>
    <div class="mrow tot"><span class="k">Difference</span><span class="v ${signCls(net)}">${(net >= 0 ? '+' : '') + whole(net, H)}</span><span></span></div><div class="sub" style="margin-top:6px">Tap to see what makes up these numbers ›</div></div>${net < -0.005 ? moodVerse('short') : ''}`;
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
    if (manual) toast('KJT Finance ' + it.version + ' is available');
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
    updateInfo.state = r.installed ? 'installed' : r.manual ? 'manual' : r.opened ? 'opened' : null; if (r.command) updateInfo.command = r.command; showUpdateBar();
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
  if (st === 'downloading') msg = `Downloading KJT Finance <b>${v}</b>…`;
  else if (st === 'waiting') { msg = `<b>KJT Finance ${v}</b> is ready. It installs by itself when you leave the app.`; btn = 'Install now'; }
  else if (st === 'installed') { msg = `<b>KJT Finance ${v}</b> is installed. Restart to use it.`; btn = 'Restart'; }
  else if (st === 'opened') msg = `Press <b>Install</b> in Software to finish updating to ${v}.`;
  else if (st === 'manual') { msg = `<b>KJT Finance ${v}</b> is downloaded. To install it, copy this command, paste it in Terminal and press Enter (your data stays):`; btn = 'Copy the command'; }
  else { msg = `<b>KJT Finance ${v}</b> is ready${updateInfo.notes ? ': ' + esc(updateInfo.notes) : ''}`; btn = 'Update'; }
  b.innerHTML = `<span>${msg}</span>${btn ? `<button class="btn" id="upd-go">${btn}</button>` : ''}`;
  b.hidden = false;
  const g = document.getElementById('upd-go'); if (g) g.onclick = st === 'manual' ? () => { native('copyText', { text: updateInfo.command || '' }); toast('Copied: open Terminal, paste it (Ctrl+Shift+V) and press Enter'); } : installUpdate;
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
    else { updateInfo.state = r.installed ? 'installed' : r.manual ? 'manual' : 'opened'; if (r.command) updateInfo.command = r.command; }
    showUpdateBar();
  }
}
/* look again when you come back to the app, and every few hours while it stays open */
function maybeCheck(minMinutes) {
  if (getSetting('auto_update', '1') !== '1' || !db) return;
  const uc = getSetting('update_checked');
  if (!uc || Date.now() - new Date(uc) > minMinutes * 60000) checkUpdate(false);
}
window.__onResume = () => { maybeCheck(30); if (typeof SYNC !== 'undefined' && SYNC.on) syncNow(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) { maybeCheck(30); if (SYNC.on) syncNow(); } });
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
      if (!isOurDb(opened)) throw new Error('The data file is not a KJT Finance database. It was not changed.');
    }
    db = opened || new SQL.Database();
    native('secure', { on: !!CRYPT || !!PREFS.noShots });
    prepareDb(); loadFx(); processRecurring(); syncInit();
    await saveNow();   /* also stores any upgrade of an older database */
    render(); APP_READY = true;
    if (window.__quickPending) setTimeout(window.__quickAdd, 300);
    if (getSetting('auto_update', '1') === '1') setTimeout(() => checkUpdate(false), 3000);   /* every start */
    const last = getSetting('prices_updated');
    if (getSetting('auto_prices', '1') === '1' && (!last || Date.now() - new Date(last) > 15 * 60000)) updatePrices(true);
  } catch (e) {
    view().innerHTML = `<div class="card"><h2>Could not start</h2><p class="sub">${esc(e && e.message || e)}</p></div>`;
  }
})();

/* ---------------- 1.31: Steward ----------------
   Bible verses (King James Version, public domain) on work, honesty and the right use of money:
   a page to read and reflect, a verse of the day on Overview, and a quiet verse matched to some pages.
   Settings › Steward turns the verses around the app off (the page stays). */
const KJV = {
  'Psalm 24:1': "The earth is the LORD's, and the fulness thereof; the world, and they that dwell therein.",
  'Proverbs 10:4': 'He becometh poor that dealeth with a slack hand: but the hand of the diligent maketh rich.',
  'Proverbs 21:5': 'The thoughts of the diligent tend only to plenteousness; but of every one that is hasty only to want.',
  'Luke 14:28': 'For which of you, intending to build a tower, sitteth not down first, and counteth the cost, whether he have sufficient to finish it?',
  'Proverbs 27:23': 'Be thou diligent to know the state of thy flocks, and look well to thy herds.',
  'Proverbs 11:1': 'A false balance is abomination to the LORD: but a just weight is his delight.',
  'Leviticus 19:13': 'Thou shalt not defraud thy neighbour, neither rob him: the wages of him that is hired shall not abide with thee all night until the morning.',
  '1 Timothy 5:18': 'For the scripture saith, Thou shalt not muzzle the ox that treadeth out the corn. And, The labourer is worthy of his reward.',
  'Colossians 3:23-24': 'And whatsoever ye do, do it heartily, as to the Lord, and not unto men; knowing that of the Lord ye shall receive the reward of the inheritance: for ye serve the Lord Christ.',
  '1 Timothy 6:10': 'For the love of money is the root of all evil: which while some coveted after, they have erred from the faith, and pierced themselves through with many sorrows.',
  'Hebrews 13:5': 'Let your conversation be without covetousness; and be content with such things as ye have: for he hath said, I will never leave thee, nor forsake thee.',
  'Proverbs 13:11': 'Wealth gotten by vanity shall be diminished: but he that gathereth by labour shall increase.',
  '2 Corinthians 9:6-8': 'But this I say, He which soweth sparingly shall reap also sparingly; and he which soweth bountifully shall reap also bountifully. Every man according as he purposeth in his heart, so let him give; not grudgingly, or of necessity: for God loveth a cheerful giver. And God is able to make all grace abound toward you; that ye, always having all sufficiency in all things, may abound to every good work.',
  'Philippians 2:14': 'Do all things without murmurings and disputings.',
  'Luke 16:10-11': 'He that is faithful in that which is least is faithful also in much: and he that is unjust in the least is unjust also in much. If therefore ye have not been faithful in the unrighteous mammon, who will commit to your trust the true riches?',
  'Matthew 25:21': 'His lord said unto him, Well done, thou good and faithful servant: thou hast been faithful over a few things, I will make thee ruler over many things: enter thou into the joy of thy lord.',
  'Matthew 6:19-21': 'Lay not up for yourselves treasures upon earth, where moth and rust doth corrupt, and where thieves break through and steal: but lay up for yourselves treasures in heaven, where neither moth nor rust doth corrupt, and where thieves do not break through nor steal: for where your treasure is, there will your heart be also.',
  'Matthew 6:24': 'No man can serve two masters: for either he will hate the one, and love the other; or else he will hold to the one, and despise the other. Ye cannot serve God and mammon.',
  'Matthew 6:33': 'But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.',
  'Luke 12:15': "Take heed, and beware of covetousness: for a man's life consisteth not in the abundance of the things which he possesseth.",
  'Luke 12:20-21': 'But God said unto him, Thou fool, this night thy soul shall be required of thee: then whose shall those things be, which thou hast provided? So is he that layeth up treasure for himself, and is not rich toward God.',
  'Mark 12:43-44': 'Verily I say unto you, That this poor widow hath cast more in, than all they which have cast into the treasury: for all they did cast in of their abundance; but she of her want did cast in all that she had, even all her living.',
  'Matthew 22:21': "Render therefore unto Caesar the things which are Caesar's; and unto God the things that are God's.",
  'Matthew 16:26': "For what is a man profited, if he shall gain the whole world, and lose his own soul? or what shall a man give in exchange for his soul?",
  'Acts 20:35': 'Remember the words of the Lord Jesus, how he said, It is more blessed to give than to receive.',
  'Proverbs 1:5': 'A wise man will hear, and will increase learning; and a man of understanding shall attain unto wise counsels.',
  'Proverbs 4:7': 'Wisdom is the principal thing; therefore get wisdom: and with all thy getting get understanding.',
  'Proverbs 6:6-8': 'Go to the ant, thou sluggard; consider her ways, and be wise: which having no guide, overseer, or ruler, provideth her meat in the summer, and gathereth her food in the harvest.',
  'Proverbs 21:20': 'There is treasure to be desired and oil in the dwelling of the wise; but a foolish man spendeth it up.',
  'Genesis 41:35-36': 'And let them gather all the food of those good years that come, and lay up corn under the hand of Pharaoh, and let them keep food in the cities. And that food shall be for store to the land against the seven years of famine.',
  'Philippians 4:11-12': 'I have learned, in whatsoever state I am, therewith to be content. I know both how to be abased, and I know how to abound: every where and in all things I am instructed both to be full and to be hungry, both to abound and to suffer need.',
  'Ecclesiastes 11:2': 'Give a portion to seven, and also to eight; for thou knowest not what evil shall be upon the earth.',
  'Proverbs 22:7': 'The rich ruleth over the poor, and the borrower is servant to the lender.',
  'Romans 13:8': 'Owe no man any thing, but to love one another: for he that loveth another hath fulfilled the law.',
  '1 Corinthians 10:31': 'Whether therefore ye eat, or drink, or whatsoever ye do, do all to the glory of God.',
  'Colossians 3:17': 'And whatsoever ye do in word or deed, do all in the name of the Lord Jesus, giving thanks to God and the Father by him.',
  'Proverbs 3:6': 'In all thy ways acknowledge him, and he shall direct thy paths.',
  'Luke 6:35': 'But love ye your enemies, and do good, and lend, hoping for nothing again; and your reward shall be great, and ye shall be the children of the Highest.',
  'Deuteronomy 8:18': 'But thou shalt remember the LORD thy God: for it is he that giveth thee power to get wealth.',
  'Proverbs 16:3': 'Commit thy works unto the LORD, and thy thoughts shall be established.',
  'Proverbs 3:9': 'Honour the LORD with thy substance, and with the firstfruits of all thine increase.',
  'Proverbs 22:1': 'A good name is rather to be chosen than great riches, and loving favour rather than silver and gold.',
  'Proverbs 16:8': 'Better is a little with righteousness than great revenues without right.',
  'Proverbs 15:16': 'Better is little with the fear of the LORD than great treasure and trouble therewith.',
  'Proverbs 23:4-5': 'Labour not to be rich: cease from thine own wisdom. Wilt thou set thine eyes upon that which is not? for riches certainly make themselves wings; they fly away as an eagle toward heaven.',
  'Ecclesiastes 5:10': 'He that loveth silver shall not be satisfied with silver; nor he that loveth abundance with increase: this is also vanity.',
  'Proverbs 28:20': 'A faithful man shall abound with blessings: but he that maketh haste to be rich shall not be innocent.',
  '1 Timothy 6:6-8': 'But godliness with contentment is great gain. For we brought nothing into this world, and it is certain we can carry nothing out. And having food and raiment let us be therewith content.',
  'Proverbs 14:23': 'In all labour there is profit: but the talk of the lips tendeth only to penury.',
  '1 Corinthians 4:2': 'Moreover it is required in stewards, that a man be found faithful.',
  '1 Peter 4:10': 'As every man hath received the gift, even so minister the same one to another, as good stewards of the manifold grace of God.',
  'Proverbs 11:24-25': 'There is that scattereth, and yet increaseth; and there is that withholdeth more than is meet, but it tendeth to poverty. The liberal soul shall be made fat: and he that watereth shall be watered also himself.',
  'Ephesians 4:28': 'Let him labour, working with his hands the thing which is good, that he may have to give to him that needeth.',
  'Psalm 90:17': 'And let the beauty of the LORD our God be upon us: and establish thou the work of our hands upon us; yea, the work of our hands establish thou it.',
  'Haggai 2:8': 'The silver is mine, and the gold is mine, saith the LORD of hosts.',
  'Psalm 37:21': 'The wicked borroweth, and payeth not again: but the righteous sheweth mercy, and giveth.',
  'Matthew 6:34': 'Take therefore no thought for the morrow: for the morrow shall take thought for the things of itself. Sufficient unto the day is the evil thereof.',
};
/* words of Christ, shown with a small mark */
const CHRIST = new Set(['Luke 14:28', 'Luke 16:10-11', 'Matthew 25:21', 'Matthew 6:19-21', 'Matthew 6:24', 'Matthew 6:33', 'Luke 12:15', 'Luke 12:20-21', 'Mark 12:43-44', 'Matthew 22:21', 'Matthew 16:26', 'Acts 20:35', 'Luke 6:35', 'Matthew 6:34']);
const DAILY = ['Psalm 24:1', 'Proverbs 10:4', 'Proverbs 21:5', 'Luke 14:28', 'Proverbs 27:23', 'Proverbs 11:1', 'Hebrews 13:5', 'Proverbs 13:11',
  'Philippians 2:14', 'Matthew 6:33', 'Luke 12:15', 'Matthew 22:21', 'Matthew 16:26', 'Acts 20:35', 'Proverbs 4:7',
  'Proverbs 21:20', 'Ecclesiastes 11:2', 'Romans 13:8', '1 Corinthians 10:31', 'Colossians 3:17', 'Proverbs 3:6', 'Deuteronomy 8:18', 'Proverbs 16:3',
  'Proverbs 3:9', 'Proverbs 22:1', 'Proverbs 16:8', 'Proverbs 15:16', 'Ecclesiastes 5:10', 'Proverbs 28:20', 'Proverbs 14:23',
  '1 Corinthians 4:2', '1 Peter 4:10', 'Psalm 90:17', 'Psalm 37:21', '1 Timothy 6:10'];
const versesOn = () => getSetting('verses', '1') === '1';
function verseHtml(ref, cls) {
  const t = KJV[ref]; if (!t) return '';
  return `<figure class="verse nomask${cls ? ' ' + cls : ''}"><blockquote>${esc(t)}</blockquote><figcaption>${CHRIST.has(ref) ? '<span class="xc" title="Words of Christ">☩</span> ' : ''}${esc(ref)}</figcaption></figure>`;
}
/* the same verse all day, a new one each day */
function dailyRef(d) { const n = Math.floor(dnum(d || today())); return DAILY[((n % DAILY.length) + DAILY.length) % DAILY.length]; }
function dailyCard() {
  if (!versesOn()) return '';
  return `<div class="card tap vday nomask" data-act="stewardship"><div class="vlabel">Verse of the day</div>${verseHtml(dailyRef())}<div class="sub vmore">Steward: reflect on God, work and money ›</div></div>`;
}
/* a quiet verse at the foot of some pages; two verses alternate by day where there are two */
function pageVerse() {
  if (!versesOn()) return '';
  const inDetail = state.propertyId && state.tab === 'property' || state.accountId && state.tab === 'accounts' || state.assetId && state.tab === 'assets' || state.loanId && state.tab === 'loans';
  let refs = null;
  if (state.tab === 'metals') refs = ['Matthew 6:19-21', 'Haggai 2:8'];
  else if (state.tab === 'property' && !inDetail) refs = ['Psalm 24:1', 'Psalm 90:17'];
  else if (state.tab === 'loans') refs = state.loanId && q('SELECT written_off FROM loans WHERE id=?', [state.loanId]).some(l => l.written_off) ? ['Luke 6:35'] : ['Luke 6:35', 'Psalm 37:21'];
  else if (state.tab === 'assets' && !inDetail) refs = ['Luke 12:15', '1 Timothy 6:6-8'];
  else if (state.tab === 'accounts' && !inDetail) refs = q("SELECT COUNT(*) n FROM accounts WHERE type='credit'")[0].n ? ['Proverbs 22:7', 'Romans 13:8'] : ['Proverbs 27:23', 'Proverbs 21:20'];
  else if (state.tab === 'accounts' && inDetail) { const a = q('SELECT type FROM accounts WHERE id=?', [state.accountId])[0]; if (a && a.type === 'credit') refs = ['Proverbs 22:7', 'Romans 13:8']; }
  else if (state.tab === 'money') refs = ['Deuteronomy 8:18', 'Proverbs 14:23'];
  if (!refs) return '';
  return `<div class="pverse">${verseHtml(refs[Math.floor(dnum(today())) % refs.length])}</div>`;
}
/* a verse that answers what the screen shows */
function moodVerse(kind) {
  if (!versesOn()) return '';
  const m = { short: ['Luke 14:28', 'Proverbs 21:5'], agree: ['Proverbs 27:23', 'Proverbs 11:1'], start: ['Proverbs 16:3'] }[kind]; if (!m) return '';
  return `<div class="pverse">${verseHtml(m[Math.floor(dnum(today())) % m.length])}</div>`;
}
const SV = (...refs) => refs.map(r => verseHtml(r)).join('');
function renderStewardship() {
  setTitle('Steward', true);
  const sec = (title, intro, body) => `<h2 class="sect">${title}</h2><div class="card stw">${intro ? `<p>${intro}</p>` : ''}${body}</div>`;
  let h = `<div class="card stw stwhead"><p class="lead">We are stewards, not owners.</p>
    <p>Everything we have is lent to us by God, to be used well and accounted for. This app is a tool for that work: knowing the state of what has been entrusted to us, keeping honest records, and planning wisely. Money itself is not the danger; <b>the love of money</b> is. Its right use and good management are a service to God, to our family and to our neighbour.</p>${SV('Psalm 24:1', '1 Corinthians 4:2')}</div>`;
  h += sec('Diligence and honesty', 'Work steadily, count the cost before you build, know where things stand, and keep honest weights: every record true, to the cent.',
    SV('Proverbs 10:4', 'Proverbs 21:5', 'Luke 14:28', 'Proverbs 27:23', 'Proverbs 11:1'));
  h += sec('Fair compensation', 'Pay what is owed, on time, and receive fair pay for honest work. Do not hold back the wages of another.',
    SV('Leviticus 19:13', '1 Timothy 5:18', 'Colossians 3:23-24'));
  h += sec('Stewardship', 'Be content, gather patiently by labour rather than by quick schemes, and give freely and cheerfully.',
    SV('1 Timothy 6:10', 'Hebrews 13:5', 'Proverbs 13:11', '2 Corinthians 9:6-8'));
  h += sec('Doing it all as if for God, without grumbling', 'Whatever the task, the dull or the hard, do it with your whole heart, as service to the Lord, and without complaining.',
    SV('Colossians 3:23-24', 'Philippians 2:14', 'Psalm 90:17'));
  h += sec('The love of money, not money', '<b>Very important.</b> Scripture does not condemn money, or using and managing it well. It warns against <i>loving</i> it: trusting in it, serving it, letting it rule the heart. The faithful servant in the parable is praised for making good use of what he was given; the one who buried it out of fear is not.',
    SV('1 Timothy 6:10', 'Luke 16:10-11', 'Matthew 25:21', 'Ecclesiastes 5:10', 'Proverbs 16:8'));
  h += sec('The words of Christ', 'What our Lord taught about treasure, masters and the heart.',
    SV('Matthew 6:19-21', 'Matthew 6:24', 'Matthew 6:33', 'Luke 12:15', 'Luke 12:20-21', 'Mark 12:43-44', 'Matthew 22:21', 'Matthew 16:26', 'Acts 20:35'));
  const stage = (n, t, txt, refs) => `<div class="stage"><div class="stn">${n}</div><div class="stb"><h3>${t}</h3><p>${txt}</p>${SV(...refs)}</div></div>`;
  h += sec('Stages in life', 'Some sound advice, for each season.',
    stage(1, 'Learn and grow', 'Invest first in yourself: learn a trade or a skill well, seek good counsel, and gain wisdom before wealth.', ['Proverbs 1:5', 'Proverbs 4:7']) +
    stage(2, 'Accumulate and save', 'Like the ant in summer: put something aside from every income, build a reserve for hard times, and spend less than you earn.', ['Proverbs 6:6-8', 'Proverbs 21:20']) +
    stage(3, 'Tighten the belt', 'In lean years, cut back without despair, as Joseph stored grain in the good years for the years of famine. Learn contentment in plenty and in want.', ['Genesis 41:35-36', 'Philippians 4:11-12']) +
    stage(4, 'Invest and grow', 'Put what you are given to work, like the faithful servants with their talents, and spread it out rather than risking everything on one thing.', ['Matthew 25:21', 'Ecclesiastes 11:2']) +
    `<div class="stage"><div class="stn">·</div><div class="stb"><h3>About debt</h3><p>Borrow little and repay what you owe; debt makes us servants.</p>${SV('Proverbs 22:7', 'Romans 13:8')}</div></div>`);
  h += sec('In remembrance of God in everything', 'All of it fairly, and in constant remembrance of God in everything you do.',
    SV('1 Corinthians 10:31', 'Colossians 3:17', 'Proverbs 3:6'));
  h += `<p class="sub stwfoot">Scripture quotations from the King James Version (public domain). <span class="xc">☩</span> marks the words of Christ.</p>`;
  view().innerHTML = h;
}
