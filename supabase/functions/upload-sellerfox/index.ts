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
      sessions: findCol(headers, 'Sessions'),
      impressions: findCol(headers, 'Impressions'),
      clicks: findCol(headers, 'Clicks'),
      orders: findCol(headers, 'Orders'),
      bsr: findCol(headers, 'Highest BSR (best/lowest rank in week)', 'Highest BSR', 'Best BSR', 'BSR'),
    };
    const missing = (['week', 'asin'] as const).filter(k => !c[k]);
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
        sessions: toNum(r[c.sessions!]), impressions: toNum(r[c.impressions!]),
        clicks: toNum(r[c.clicks!]), orders: toNum(r[c.orders!]),
        bsr: c.bsr ? toNum(r[c.bsr]) : null,
      });
    }
    if (!records.length) return json({ error: 'No valid rows found in file' }, 400);

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

    const { error } = await supabase.from('sellerfox_rows').upsert(records, { onConflict: 'asin,week' });
    if (error) return json({ error: error.message }, 500);

    return json({ rowsLoaded: records.length, newProducts: newProducts.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
