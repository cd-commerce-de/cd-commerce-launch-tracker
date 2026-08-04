import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS_HEADERS, json, parseCSV, findCol, toNum, toDateStr } from '../_shared/utils.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return json({ error: 'no file uploaded' }, 400);

    const text = await (file as File).text();
    const { headers, rows } = parseCSV(text);

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
    const missing = (['week', 'asin', 'sales'] as const).filter(k => !c[k]);
    if (missing.length) return json({ error: 'Missing required column(s): ' + missing.join(', ') }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const productAsins = new Set<string>();
    const records = [];
    for (const r of rows) {
      const week = toDateStr(r[c.week!]);
      const asin = String(r[c.asin!] || '').trim();
      if (!week || !asin) continue;
      productAsins.add(asin);
      records.push({
        asin, week,
        marketplace: c.mkt ? String(r[c.mkt] || '').trim() : '',
        tag: c.tag ? String(r[c.tag] || '').trim() : '',
        name: c.name ? String(r[c.name] || '').trim() : '',
        sales: toNum(r[c.sales!]), organic: toNum(r[c.organic!]), ad: toNum(r[c.ad!]),
        units: toNum(r[c.units!]), refunds: toNum(r[c.refunds!]), spend: toNum(r[c.spend!]),
        profit: toNum(r[c.profit!]),
      });
    }
    if (!records.length) return json({ error: 'No valid rows found in file' }, 400);

    // Ensure every referenced product exists first (FK constraint), without
    // clobbering launch dates/tags a person may have already set.
    const { data: existing } = await supabase.from('products').select('asin').in('asin', [...productAsins]);
    const existingAsins = new Set((existing || []).map((p: { asin: string }) => p.asin));
    const newProducts = [...productAsins].filter(a => !existingAsins.has(a));
    if (newProducts.length) {
      const toInsert = newProducts.map(asin => {
        const rec = records.find(r => r.asin === asin)!;
        return { asin, name: rec.name || asin, tag: rec.tag || 'launch', marketplace: rec.marketplace, launch: null };
      });
      const { error: prodErr } = await supabase.from('products').insert(toInsert);
      if (prodErr) return json({ error: 'Failed to create products: ' + prodErr.message }, 500);
    }

    const { error } = await supabase.from('sellerboard_rows').upsert(records, { onConflict: 'asin,week' });
    if (error) return json({ error: error.message }, 500);

    return json({ rowsLoaded: records.length, newProducts: newProducts.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
