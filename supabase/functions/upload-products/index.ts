import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS_HEADERS, json, parseCSV, findCol, toDateStr } from '../_shared/utils.ts';

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
      name: findCol(headers, 'Product Name', 'Product'),
      asin: findCol(headers, 'Parent ASIN / SKU', 'Parent ASIN', 'SKU', 'ASIN'),
      tag: findCol(headers, 'Tag'),
      mkt: findCol(headers, 'Marketplace'),
      launch: findCol(headers, 'Launch Date', 'Launch'),
    };
    if (!c.name || !c.asin) return json({ error: 'Missing Product Name or Parent ASIN column' }, 400);

    const records = [];
    for (const r of rows) {
      const name = String(r[c.name!] || '').trim();
      const asin = String(r[c.asin!] || '').trim();
      if (!name || !asin) continue;
      records.push({
        name, asin,
        tag: c.tag ? String(r[c.tag] || '').trim() : 'launch',
        marketplace: c.mkt ? String(r[c.mkt] || '').trim() : '',
        launch: c.launch ? toDateStr(r[c.launch]) : null,
      });
    }
    if (!records.length) return json({ error: 'No valid rows found in file' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error } = await supabase.from('products').upsert(records, { onConflict: 'asin' });
    if (error) return json({ error: error.message }, 500);

    return json({ productsLoaded: records.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
