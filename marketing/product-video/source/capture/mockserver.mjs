// Tiny in-memory PostgREST look-alike, enough for supabase-js to run the app with demo data.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { seed } from './seed.mjs';

const db = seed();
const PORT = Number(process.env.PORT || 54321);

function parseVal(v) {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}
function cmp(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  const na = Number(a), nb = Number(b);
  if (typeof a !== 'boolean' && !isNaN(na) && !isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '' && !/^\d{4}-\d\d-\d\d/.test(String(a))) return na - nb;
  return String(a).localeCompare(String(b));
}
function likeRe(p, ci) {
  const s = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*');
  return new RegExp('^' + s + '$', ci ? 'i' : '');
}
function test(row, col, expr) {
  const dot = expr.indexOf('.');
  let op = expr.slice(0, dot), val = expr.slice(dot + 1);
  let neg = false;
  if (op === 'not') { neg = true; const d2 = val.indexOf('.'); op = val.slice(0, d2); val = val.slice(d2 + 1); }
  const cell = row[col];
  let r;
  switch (op) {
    case 'eq': r = String(cell) === String(parseVal(val)) || cell === parseVal(val); break;
    case 'neq': r = !(String(cell) === String(parseVal(val))); break;
    case 'gt': r = cmp(cell, val) > 0; break;
    case 'gte': r = cmp(cell, val) >= 0; break;
    case 'lt': r = cmp(cell, val) < 0; break;
    case 'lte': r = cmp(cell, val) <= 0; break;
    case 'like': r = likeRe(val, false).test(String(cell ?? '')); break;
    case 'ilike': r = likeRe(val, true).test(String(cell ?? '')); break;
    case 'is': r = val === 'null' ? cell === null || cell === undefined : cell === parseVal(val); break;
    case 'in': {
      const list = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      r = list.includes(String(cell));
      break;
    }
    default: r = true;
  }
  return neg ? !r : r;
}
function orFilter(row, expr) {
  const inner = expr.replace(/^\(|\)$/g, '');
  return inner.split(',').some((part) => {
    const d = part.indexOf('.');
    return test(row, part.slice(0, d), part.slice(d + 1));
  });
}

function embed(table, rows, select) {
  if (!select) return rows;
  const m = [...select.matchAll(/(\w+)\(\*\)/g)].map((x) => x[1]);
  if (!m.length) return rows;
  return rows.map((r) => {
    const out = { ...r };
    for (const child of m) {
      if (child === 'shop_invoice_items') out[child] = (db.shop_invoice_items || []).filter((l) => l.invoice_id === r.id);
    }
    return out;
  });
}
function project(rows, select) {
  if (!select || select.includes('*')) return rows;
  const cols = select.split(',').map((s) => s.trim()).filter(Boolean);
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,PUT,OPTIONS,HEAD',
    'Access-Control-Expose-Headers': 'Content-Range',
    'Content-Type': 'application/json',
    ...headers,
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const sessions = new Map();

function rpc(name, args) {
  switch (name) {
    case 'app_login': {
      const u = db.app_users.find((x) => x.username.toLowerCase() === String(args.p_username).toLowerCase());
      if (!u || u.password_hash !== args.p_password) return null;
      const token = randomUUID();
      sessions.set(token, u);
      return { token, user: { id: u.id, username: u.username, role: u.role } };
    }
    case 'app_logout': return null;
    case 'shop_item_sale_counts': {
      const counts = {};
      for (const l of db.shop_invoice_items) if (l.item_id) counts[l.item_id] = (counts[l.item_id] || 0) + 1;
      return Object.entries(counts).map(([item_id, sale_count]) => ({ item_id, sale_count }));
    }
    case 'shop_save_sale': {
      const p = args.p;
      const existing = db.shop_invoices.find((i) => i.client_id === p.client_id);
      if (existing) return { id: existing.id, bill_number: existing.bill_number, already_saved: true };
      const c = db.shop_counters.find((x) => x.bill_type === 'sale' && x.fy === p.fy && x.series === p.series);
      c.last_number += 1;
      const bill_number = `S-${p.series}/${p.fy}/${String(c.last_number).padStart(4, '0')}`;
      const id = randomUUID();
      const { lines, ...rest } = p;
      db.shop_invoices.push({ ...rest, id, bill_type: 'sale', bill_number, status: 'active', version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      lines.forEach((l, i) => { const { update_saved_rate, ...line } = l; db.shop_invoice_items.push({ ...line, id: randomUUID(), invoice_id: id, line_no: i, cost_rate: '0' }); });
      return { id, bill_number, already_saved: false };
    }
    case 'shop_receive_payment': {
      const inv = db.shop_invoices.find((i) => i.id === args.p_invoice_id) || {};
      const amt = Number(args.p_amount || 0);
      inv.paid_amount = String(Number(inv.paid_amount || 0) + amt);
      db.shop_payments.push({ id: randomUUID(), client_id: args.p_client_id || randomUUID(), invoice_id: inv.id, party_id: inv.party_id, direction: 'in', amount: String(amt), mode: args.p_mode || 'cash', payment_date: new Date().toISOString().slice(0, 10), created_at: new Date().toISOString(), created_by: null, note: '' });
      return { paid_amount: inv.paid_amount };
    }
    case 'shop_edit_sale': return { ok: true };
    default: return null;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  let body = '';
  for await (const chunk of req) body += chunk;
  if (url.pathname.startsWith('/storage/')) return send(res, 200, { Key: 'bill-photos/demo', Id: 'demo' });
  let json = null; try { json = body ? JSON.parse(body) : null; } catch {}
  const m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?(\w+)/);
  if (!m) return send(res, 404, { message: 'not found' });
  if (m[1]) return send(res, 200, rpc(m[2], json || Object.fromEntries(url.searchParams)));

  const table = m[2];
  if (!db[table]) return send(res, 404, { code: '42P01', message: `relation "${table}" does not exist` });
  const params = url.searchParams;
  const special = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
  const match = (r) => {
    for (const [k, v] of params) {
      if (special.has(k)) continue;
      if (k === 'or') { if (!orFilter(r, v)) return false; continue; }
      if (!test(r, k, v)) return false;
    }
    return true;
  };
  const prefer = req.headers['prefer'] || '';
  const wantRep = prefer.includes('return=representation');

  if (req.method === 'GET' || req.method === 'HEAD') {
    let rows = db[table].filter(match);
    const order = params.get('order');
    if (order) {
      const keys = order.split(',').map((s) => { const [c, dir] = s.split('.'); return [c, dir === 'desc' ? -1 : 1]; });
      rows = rows.slice().sort((a, b) => { for (const [c, d] of keys) { const x = cmp(a[c], b[c]); if (x) return x * d; } return 0; });
    }
    const total = rows.length;
    const offset = Number(params.get('offset') || 0);
    const limit = params.get('limit') ? Number(params.get('limit')) : undefined;
    rows = rows.slice(offset, limit !== undefined ? offset + limit : undefined);
    rows = project(embed(table, rows, params.get('select')), params.get('select'));
    const headers = { 'Content-Range': `${offset}-${offset + rows.length - 1}/${prefer.includes('count=') ? total : '*'}` };
    if ((req.headers['accept'] || '').includes('vnd.pgrst.object')) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: '', hint: null });
      return send(res, 200, rows[0], headers);
    }
    return send(res, 200, req.method === 'HEAD' ? undefined : rows, headers);
  }
  if (req.method === 'POST') {
    const list = Array.isArray(json) ? json : [json];
    const out = [];
    for (const r0 of list) {
      const r = { id: r0.id ?? randomUUID(), created_at: new Date().toISOString(), ...r0 };
      const conflict = params.get('on_conflict');
      const idx = conflict ? db[table].findIndex((x) => conflict.split(',').every((c) => String(x[c]) === String(r[c]))) : db[table].findIndex((x) => x.id === r.id);
      if (idx >= 0) db[table][idx] = { ...db[table][idx], ...r0 };
      else db[table].push(r);
      out.push(idx >= 0 ? db[table][idx] : r);
    }
    return send(res, 201, wantRep ? out : undefined);
  }
  if (req.method === 'PATCH') {
    const rows = db[table].filter(match);
    rows.forEach((r) => Object.assign(r, json));
    return send(res, 200, wantRep ? rows : undefined);
  }
  if (req.method === 'DELETE') {
    const keep = db[table].filter((r) => !match(r));
    const gone = db[table].filter(match);
    db[table] = keep;
    return send(res, 200, wantRep ? gone : undefined);
  }
  send(res, 405, { message: 'method' });
});
server.listen(PORT, () => console.log('mock supabase on', PORT));
