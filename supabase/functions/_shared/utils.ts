// Shared helpers for the upload Edge Functions.
// Deno allows relative imports between functions in the same `supabase/functions` folder.

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function splitCSVLine(line: string): string[] {
  const out: string[] = [];
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

export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const cells = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
  return { headers, rows };
}

function normHeader(h: string): string {
  return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function findCol(headers: string[], ...candidates: string[]): string | null {
  const set = new Map(headers.map(h => [normHeader(h), h]));
  for (const c of candidates) {
    const k = normHeader(c);
    if (set.has(k)) return set.get(k)!;
  }
  return null;
}

export function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/[€%,]/g, '').replace(/\s/g, ''));
  return isNaN(n) ? 0 : n;
}

export function toDateStr(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
