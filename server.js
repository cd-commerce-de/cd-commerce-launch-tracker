const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'db.json');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// Storage (flat JSON file). Swap loadDB/saveDB for a real database later —
// every route below only talks to these two functions.
// ---------------------------------------------------------------------------
function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { products: [], sellerboard: [], sellerfox: [] };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ---------------------------------------------------------------------------
// CSV parsing (small dependency-free parser — handles quoted fields/commas)
// ---------------------------------------------------------------------------
function splitCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}
function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const cells = splitCSVLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
  return { headers, rows };
}
function normHeader(h) { return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function findCol(headers, ...candidates) {
  const set = new Map(headers.map(h => [normHeader(h), h]));
  for (const c of candidates) { const k = normHeader(c); if (set.has(k)) return set.get(k); }
  return null;
}
function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/[€%,]/g, '').replace(/\s/g, ''));
  return isNaN(n) ? 0 : n;
}
function toDateStr(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function upsertRow(arr, rec, keyFields) {
  const idx = arr.findIndex(r => keyFields.every(k => r[k] === rec[k]));
  if (idx >= 0) arr[idx] = rec; else arr.push(rec);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
app.get('/api/products', (req, res) => {
  res.json(loadDB().products);
});

app.post('/api/products', (req, res) => {
  const db = loadDB();
  const p = req.body || {};
  if (!p.name || !p.asin) return res.status(400).json({ error: 'name and asin are required' });
  const rec = { name: p.name, asin: p.asin, tag: p.tag || 'launch', marketplace: p.marketplace || '', launch: p.launch ? toDateStr(p.launch) : null };
  upsertRow(db.products, rec, ['asin']);
  saveDB(db);
  res.json(db.products);
});

app.put('/api/products/:asin', (req, res) => {
  const db = loadDB();
  const idx = db.products.findIndex(p => p.asin === req.params.asin);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  db.products[idx] = { ...db.products[idx], ...req.body };
  if (req.body.launch !== undefined) db.products[idx].launch = req.body.launch ? toDateStr(req.body.launch) : null;
  saveDB(db);
  res.json(db.products[idx]);
});

app.delete('/api/products/:asin', (req, res) => {
  const db = loadDB();
  db.products = db.products.filter(p => p.asin !== req.params.asin);
  saveDB(db);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// CSV uploads — parsing + storage happens here on the server, not the client
// ---------------------------------------------------------------------------
app.post('/api/upload/sellerboard', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const { headers, rows } = parseCSV(req.file.buffer.toString('utf8'));
  const c = {
    week: findCol(headers, 'Week Start Date', 'Week', 'Date'),
    mkt: findCol(headers, 'Marketplace', 'Market'),
    tag: findCol(headers, 'Tag'),
    asin: findCol(headers, 'Parent ASIN / SKU', 'Parent ASIN', 'SKU', 'ASIN'),
    name: findCol(headers, 'Product Name', 'Product'),
    sales: findCol(headers, 'Total Sales (€)', 'Total Sales', 'Sales'),
    organic: findCol(headers, 'Organic Sales (€)', 'Organic Sales'),
    ad: findCol(headers, 'Ad Sales (€)', 'Ad Sales', 'Advertised Revenue'),
    units: findCol(headers, 'Units Sold', 'Units'),
    refunds: findCol(headers, 'Refund Units', 'Refunds'),
    spend: findCol(headers, 'Ad Spend (€)', 'Ad Spend', 'Advertising Cost', 'Advertising Expenses'),
    profit: findCol(headers, 'Net Profit (€)', 'Net Profit'),
  };
  const missing = ['week', 'asin', 'sales'].filter(k => !c[k]);
  if (missing.length) return res.status(400).json({ error: 'Missing required column(s): ' + missing.join(', ') });

  const db = loadDB();
  let count = 0, newProducts = 0;
  rows.forEach(r => {
    const week = toDateStr(r[c.week]);
    const asin = String(r[c.asin] || '').trim();
    if (!week || !asin) return;
    const rec = {
      week, marketplace: c.mkt ? String(r[c.mkt] || '').trim() : '', tag: c.tag ? String(r[c.tag] || '').trim() : '',
      asin, name: c.name ? String(r[c.name] || '').trim() : '',
      sales: toNum(r[c.sales]), organic: toNum(r[c.organic]), ad: toNum(r[c.ad]),
      units: toNum(r[c.units]), refunds: toNum(r[c.refunds]), spend: toNum(r[c.spend]), profit: toNum(r[c.profit]),
    };
    upsertRow(db.sellerboard, rec, ['asin', 'week']);
    if (!db.products.find(p => p.asin === asin)) { db.products.push({ name: rec.name || asin, asin, tag: rec.tag || 'launch', marketplace: rec.marketplace, launch: null }); newProducts++; }
    count++;
  });
  saveDB(db);
  res.json({ rowsLoaded: count, newProducts });
});

app.post('/api/upload/sellerfox', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const { headers, rows } = parseCSV(req.file.buffer.toString('utf8'));
  const c = {
    week: findCol(headers, 'Week Start Date', 'Week', 'Date'),
    mkt: findCol(headers, 'Marketplace', 'Market'),
    tag: findCol(headers, 'Tag'),
    asin: findCol(headers, 'Parent ASIN / SKU', 'Parent ASIN', 'SKU', 'ASIN'),
    name: findCol(headers, 'Product Name', 'Product'),
    sessions: findCol(headers, 'Sessions'),
    impressions: findCol(headers, 'Impressions'),
    clicks: findCol(headers, 'Clicks'),
    orders: findCol(headers, 'Orders'),
    bsr: findCol(headers, 'Highest BSR (best/lowest rank in week)', 'Highest BSR', 'Best BSR', 'BSR'),
  };
  const missing = ['week', 'asin'].filter(k => !c[k]);
  if (missing.length) return res.status(400).json({ error: 'Missing required column(s): ' + missing.join(', ') });

  const db = loadDB();
  let count = 0, newProducts = 0;
  rows.forEach(r => {
    const week = toDateStr(r[c.week]);
    const asin = String(r[c.asin] || '').trim();
    if (!week || !asin) return;
    const rec = {
      week, marketplace: c.mkt ? String(r[c.mkt] || '').trim() : '', tag: c.tag ? String(r[c.tag] || '').trim() : '',
      asin, name: c.name ? String(r[c.name] || '').trim() : '',
      sessions: toNum(r[c.sessions]), impressions: toNum(r[c.impressions]), clicks: toNum(r[c.clicks]),
      orders: toNum(r[c.orders]), bsr: c.bsr ? toNum(r[c.bsr]) : 0,
    };
    upsertRow(db.sellerfox, rec, ['asin', 'week']);
    if (!db.products.find(p => p.asin === asin)) { db.products.push({ name: rec.name || asin, asin, tag: rec.tag || 'launch', marketplace: rec.marketplace, launch: null }); newProducts++; }
    count++;
  });
  saveDB(db);
  res.json({ rowsLoaded: count, newProducts });
});

app.post('/api/upload/products', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const { headers, rows } = parseCSV(req.file.buffer.toString('utf8'));
  const c = {
    name: findCol(headers, 'Product Name', 'Product'),
    asin: findCol(headers, 'Parent ASIN / SKU', 'Parent ASIN', 'SKU', 'ASIN'),
    tag: findCol(headers, 'Tag'),
    mkt: findCol(headers, 'Marketplace'),
    launch: findCol(headers, 'Launch Date', 'Launch'),
  };
  if (!c.name || !c.asin) return res.status(400).json({ error: 'Missing Product Name or Parent ASIN column' });

  const db = loadDB();
  let count = 0;
  rows.forEach(r => {
    const name = String(r[c.name] || '').trim();
    if (!name) return;
    const rec = { name, asin: String(r[c.asin] || '').trim(), tag: c.tag ? String(r[c.tag] || '').trim() : 'launch',
      marketplace: c.mkt ? String(r[c.mkt] || '').trim() : '', launch: c.launch ? toDateStr(r[c.launch]) : null };
    upsertRow(db.products, rec, ['asin']);
    count++;
  });
  saveDB(db);
  res.json({ productsLoaded: count });
});

// ---------------------------------------------------------------------------
// CSV templates (so the UI's download buttons don't need any client logic)
// ---------------------------------------------------------------------------
const TEMPLATES = {
  sellerboard: 'Week Start Date,Marketplace,Tag,Parent ASIN / SKU,Product Name,Total Sales (€),Organic Sales (€),Ad Sales (€),Units Sold,Refund Units,Ad Spend (€),Net Profit (€)\n'
    + '2025-08-29,DE,launch,PARENT-ASIN-001,Toilet Seat Adults - D shape,1199,0,1199,20,0,432,193.49\n',
  sellerfox: 'Week Start Date,Marketplace,Tag,Parent ASIN / SKU,Product Name,Sessions,Impressions,Clicks,Orders,Highest BSR (best/lowest rank in week)\n'
    + '2025-08-29,DE,launch,PARENT-ASIN-001,Toilet Seat Adults - D shape,380,6800,400,20,58210\n',
  products: 'Product Name,Parent ASIN / SKU,Tag,Marketplace,Launch Date\n'
    + 'Toilet Seat Adults - D shape,PARENT-ASIN-001,launch,DE,2025-08-29\n',
};
app.get('/api/templates/:kind', (req, res) => {
  const csv = TEMPLATES[req.params.kind];
  if (!csv) return res.status(404).send('unknown template');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.kind}_template.csv"`);
  res.send(csv);
});

// ---------------------------------------------------------------------------
// Dashboard aggregation — computed server-side, client only renders the result
// ---------------------------------------------------------------------------
function weekNumber(launchDate, rowDate) {
  const l = new Date(launchDate), d = new Date(rowDate);
  const diffDays = Math.round((d - l) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

function computeWeeks(db, product, marketplaceFilter) {
  const weeks = Array.from({ length: 12 }, () => ({
    sales: 0, organic: 0, ad: 0, units: 0, refunds: 0, spend: 0, profit: 0,
    sessions: 0, impressions: 0, clicks: 0, orders: 0, bsr: null,
  }));
  if (!product || !product.launch) return weeks;

  db.sellerboard.filter(r => r.asin === product.asin && (marketplaceFilter === 'ALL' || r.marketplace === marketplaceFilter))
    .forEach(r => {
      const wk = weekNumber(product.launch, r.week);
      if (wk < 1 || wk > 12) return;
      const w = weeks[wk - 1];
      w.sales += r.sales; w.organic += r.organic; w.ad += r.ad; w.units += r.units;
      w.refunds += r.refunds; w.spend += r.spend; w.profit += r.profit;
    });

  db.sellerfox.filter(r => r.asin === product.asin && (marketplaceFilter === 'ALL' || r.marketplace === marketplaceFilter))
    .forEach(r => {
      const wk = weekNumber(product.launch, r.week);
      if (wk < 1 || wk > 12) return;
      const w = weeks[wk - 1];
      w.sessions += r.sessions; w.impressions += r.impressions; w.clicks += r.clicks; w.orders += r.orders;
      w.bsr = (w.bsr === null) ? (r.bsr || null) : (r.bsr ? Math.min(w.bsr, r.bsr) : w.bsr);
    });

  weeks.forEach(w => {
    w.organicPct = w.sales ? w.organic / w.sales : 0;
    w.refundPct = w.units ? w.refunds / w.units : 0;
    w.acos = w.ad ? w.spend / w.ad : 0;
    w.tacos = w.sales ? w.spend / w.sales : 0;
    w.margin = w.sales ? w.profit / w.sales : 0;
    w.cvr = w.sessions ? w.orders / w.sessions : 0;
    w.ctr = w.impressions ? w.clicks / w.impressions : 0;
  });
  return weeks;
}

app.get('/api/overview', (req, res) => {
  const db = loadDB();
  const marketplace = req.query.marketplace || 'ALL';
  const rows = db.products.map(product => {
    const weeks = computeWeeks(db, product, marketplace);
    const sum = key => weeks.reduce((a, w) => a + w[key], 0);
    const avg = key => weeks.reduce((a, w) => a + w[key], 0) / weeks.length;
    const bsrVals = weeks.map(w => w.bsr).filter(x => x !== null && x > 0);
    return {
      product,
      totalSales: sum('sales'),
      netProfit: sum('profit'),
      avgMargin: avg('margin'),
      units: sum('units'),
      sessions: sum('sessions'),
      bestBSR: bsrVals.length ? Math.min(...bsrVals) : null,
      weeksWithData: weeks.filter(w => w.sales > 0 || w.sessions > 0).length,
    };
  });
  res.json(rows);
});

app.get('/api/dashboard', (req, res) => {
  const db = loadDB();
  const asin = req.query.asin;
  const marketplace = req.query.marketplace || 'ALL';
  const product = db.products.find(p => p.asin === asin) || db.products[0];
  if (!product) return res.json({ product: null, weeks: [], marketplaces: [] });

  const weeks = computeWeeks(db, product, marketplace);
  const marketplaces = Array.from(new Set([...db.sellerboard, ...db.sellerfox].map(r => r.marketplace).filter(Boolean)));
  res.json({ product, weeks, marketplaces });
});

// ---------------------------------------------------------------------------
// Backup / restore / reset
// ---------------------------------------------------------------------------
app.get('/api/export', (req, res) => res.json(loadDB()));

app.post('/api/import', (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.products)) return res.status(400).json({ error: 'invalid backup file' });
  saveDB({ products: incoming.products || [], sellerboard: incoming.sellerboard || [], sellerfox: incoming.sellerfox || [] });
  res.json({ ok: true });
});

app.delete('/api/data', (req, res) => {
  saveDB({ products: [], sellerboard: [], sellerfox: [] });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`CD Commerce Launch Tracker running at http://localhost:${PORT}`));
