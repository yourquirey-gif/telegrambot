const mongoose = require('mongoose');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');

const FB = 'https://5sim.net/v1';
const VB = 'https://vak-sms.com/stubs/handler_api.php';
const TB = 'https://api.temporasms.com/stubs/handler_api.php';
const VK = process.env.VAKSMS_API_KEY || '';
const TK = process.env.TEMPORASMS_API_KEY || process.env.TEMPO_API_KEY || process.env.TEMPO_SMS_API_KEY || '';
const state = new Map();
const cache = new Map();
const enc = x => encodeURIComponent(String(x));
const dec = x => { try { return decodeURIComponent(x); } catch { return String(x); } };
const norm = x => String(x ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

async function cfg(s) { try { return await mongoose.connection.db.collection('number_server_configs').findOne({ server: s }); } catch { return null; } }
async function api(s, action, params = {}) {
  if (s === '5sim') return (await axios.get(FB + '/guest/prices', { params, timeout: 20000, headers: { Accept: 'application/json' } })).data;
  const base = s === 'vak' ? VB : TB;
  const key = s === 'vak' ? VK : TK;
  if (!key) throw Error(`${s} API key is not configured`);
  return (await axios.get(base, { params: { action, api_key: key, ...params }, timeout: 20000, headers: { Accept: 'application/json' } })).data;
}
function addService(out, id, name) {
  id = String(id ?? '').trim(); name = String(name ?? id).trim();
  if (!id || !name) return;
  if (/^(status|success|error|message|code|balance|country|countries|operator|operators|service|services|result|data)$/i.test(id)) return;
  if (!out.has(id)) out.set(id, { id, name });
}
function parseServicesFromPrices(s, d) {
  const out = new Map();
  if (!d || typeof d !== 'object') return [];
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 5) return;
    for (const [k, v] of Object.entries(o)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      if (v.cost != null || v.price != null || v.rate != null || v.count != null || v.stock != null) { addService(out, k, k); continue; }
      if (depth === 0 && s !== '5sim') for (const [sk, sv] of Object.entries(v)) if (sv && typeof sv === 'object') addService(out, sk, sk);
      walk(v, depth + 1);
    }
  };
  walk(d);
  if (s === '5sim') for (const v of Object.values(d)) if (v && typeof v === 'object') for (const service of Object.keys(v)) addService(out, service, service);
  return [...out.values()];
}
function operatorIds(d) {
  const out = new Set();
  if (!d) return [];
  const add = x => { const v = String(x ?? '').trim(); if (v && !/^(status|success|error|message|code|balance)$/i.test(v)) out.add(v); };
  if (Array.isArray(d)) for (const x of d) {
    if (typeof x === 'string' || typeof x === 'number') add(x);
    else if (x && typeof x === 'object') add(x.id ?? x.code ?? x.operator ?? x.operatorId ?? x.value ?? x.name);
  } else if (typeof d === 'object') for (const [k, v] of Object.entries(d)) {
    if (/^(status|success|error|message|code|balance)$/i.test(k)) continue;
    if (typeof v === 'string' || typeof v === 'number') add(v);
    else if (v && typeof v === 'object') add(v.id ?? v.code ?? v.operator ?? v.operatorId ?? k);
    else add(k);
  } else if (typeof d === 'string') for (const x of d.split(/[,;|\n]+/)) add(x.replace(/^OK:/i, '').trim());
  return [...out].filter(x => x.toLowerCase() !== 'any').slice(0, 40);
}
async function priceTrees(s) {
  const key = 'trees:' + s, h = cache.get(key);
  if (h && Date.now() - h.t < 5000) return h.v;
  const trees = [];
  if (s === '5sim') trees.push(await api(s, 'getPrices', {}));
  else {
    let ops = [];
    try { ops = operatorIds(await api(s, 'getOperators', {})); } catch (e) { console.log('LIVE OPERATORS', s, 'ERROR=', e.response?.data || e.message); }
    console.log('LIVE OPERATORS', s, 'count=', ops.length);
    for (const operator of ops) try {
      const d = await api(s, 'getPrices', { operator });
      if (d && typeof d === 'object' && !Array.isArray(d)) trees.push(d);
    } catch (e) { console.log('LIVE OPERATOR PRICE', s, operator, e.response?.data || e.message); }
    if (!trees.length && s === 'tempo') for (const action of ['getPricesV3', 'getPricesV2']) try {
      const d = await api(s, action, {});
      if (d && typeof d === 'object' && !Array.isArray(d)) { trees.push(d); console.log('LIVE PRICE FALLBACK', s, action); break; }
    } catch (e) { console.log('LIVE PRICE FALLBACK', s, action, e.response?.data || e.message); }
  }
  cache.set(key, { t: Date.now(), v: trees });
  return trees;
}
async function services(s) {
  const key = 'svc2:' + s, h = cache.get(key);
  if (h && Date.now() - h.t < 10000) return h.v;
  const out = new Map();
  try {
    const d = await api(s, s === '5sim' ? 'getPrices' : 'getServices', {});
    for (const x of parseServicesFromPrices(s, d)) addService(out, x.id, x.name);
  } catch (e) { console.log('LIVE SERVICES', s, 'ERROR=', e.response?.data || e.message); }
  if (s !== '5sim' && !out.size) try {
    const merged = {};
    for (const tree of await priceTrees(s)) Object.assign(merged, tree);
    for (const x of parseServicesFromPrices(s, merged)) addService(out, x.id, x.name);
  } catch (e) { console.log('LIVE SERVICES FROM PRICES', s, 'ERROR=', e.message); }
  const c = await cfg(s);
  for (const x of (c?.services || [])) {
    const id = String(x.id ?? x.code ?? x.service ?? x.serviceCode ?? '');
    const name = String(x.name || x.title || x.serviceName || x.text_en || x.eng || x.rus || x.text || id);
    const hit = [...out.values()].find(v => norm(v.id) === norm(id));
    if (hit) hit.name = name;
  }
  const a = [...out.values()].sort((x, y) => x.name.localeCompare(y.name));
  console.log('LIVE SERVICES FIX', s, 'count=', a.length);
  cache.set(key, { t: Date.now(), v: a });
  return a;
}
function block(v) {
  let p = 0, stock = 0;
  const w = o => {
    if (!o) return;
    if (Array.isArray(o)) return o.forEach(w);
    if (typeof o !== 'object') return;
    for (const k of ['cost','price','rate','sell_price','buy_price','Price']) { const n = Number(o[k]); if (Number.isFinite(n) && n > 0) p = p ? Math.min(p, n) : n; }
    for (const k of ['count','stock','qty','quantity','available','Qty']) { const n = Number(o[k]); if (Number.isFinite(n) && n >= 0) stock += n; }
    for (const [k, x] of Object.entries(o)) if (!['cost','price','rate','sell_price','buy_price','Price','count','stock','qty','quantity','available','Qty'].includes(k) && x && typeof x === 'object') w(x);
  };
  w(v); return { p, stock };
}
function countryName(id, map) { return map?.get(String(id)) || String(id).replace(/[_-]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase()); }
function countriesFromTree(d, service, names, out = new Map()) {
  const svc = String(service), ns = norm(service);
  const walk = o => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    for (const [k, v] of Object.entries(o)) {
      if (!v || typeof v !== 'object') continue;
      if (norm(k) === ns) {
        for (const [country, val] of Object.entries(v)) { const b = block(val); if (b.p > 0 || b.stock > 0) out.set(String(country), { id: String(country), name: countryName(country, names), ...b }); }
        continue;
      }
      if (v[svc] && typeof v[svc] === 'object') { const b = block(v[svc]); if (b.p > 0 || b.stock > 0) out.set(String(k), { id: String(k), name: countryName(k, names), ...b }); }
      for (const [sk, sv] of Object.entries(v)) if (norm(sk) === ns && sv && typeof sv === 'object') { const b = block(sv); if (b.p > 0 || b.stock > 0) out.set(String(k), { id: String(k), name: countryName(k, names), ...b }); }
      walk(v);
    }
  };
  walk(d); return out;
}
async function countries(s, svc) {
  const key = 'ct2:' + s + ':' + svc.id, h = cache.get(key);
  if (h && Date.now() - h.t < 5000) return h.v;
  const c = await cfg(s), names = new Map((c?.countries || []).map(x => [String(x.id ?? x.countryId ?? x.code), String(x.name || x.title || x.text_en || x.eng || x.rus || x.countryName || x.id || x.countryId || x.code)])), out = new Map();
  if (s === '5sim') try { countriesFromTree(await api(s, 'getPrices', { product: svc.id }), svc.id, names, out); } catch (e) { console.log('LIVE COUNTRY FIX 5SIM', e.response?.data || e.message); }
  else for (const tree of await priceTrees(s)) countriesFromTree(tree, svc.id, names, out);
  const a = [...out.values()].sort((x, y) => x.name.localeCompare(y.name));
  console.log('LIVE COUNTRY FIX', s, svc.id, 'count=', a.length);
  cache.set(key, { t: Date.now(), v: a });
  return a;
}
function sell(p, c) { let x = Number(p || 0), f = Number(c?.profit || c?.profitAmount || 0), q = Number(c?.profitPercent || c?.markup || 0); if (f > 0) x += f; if (q > 0) x *= 1 + q / 100; return Math.ceil(x * 100) / 100; }
function page(a, q, p) { const r = q ? a.filter(x => norm(x.name).includes(norm(q)) || String(x.id).toLowerCase().includes(String(q).toLowerCase())) : a, size = 8, total = Math.max(1, Math.ceil(r.length / size)), n = Math.min(Math.max(1, Number(p) || 1), total); return { r, total, n, items: r.slice((n - 1) * size, n * size) }; }
async function showServices(bot, q, s, query = '', p = 1, chatId = null) {
  const a = await services(s), d = page(a, query, p), rows = d.items.map(x => [Markup.button.callback('📦 ' + x.name, 'fsvc:' + s + ':' + enc(x.id))]), nav = [];
  if (d.n > 1) nav.push(Markup.button.callback('⬅ Previous', 'fpage2:' + s + ':' + (d.n - 1) + ':' + enc(query)));
  if (d.n < d.total) nav.push(Markup.button.callback('Next ➡', 'fpage2:' + s + ':' + (d.n + 1) + ':' + enc(query)));
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback('🔎 Search Service', 'fsearch2:' + s)]);
  rows.push([Markup.button.callback('⬅ Servers', 'ns_user_menu')]);
  const label = s === 'tempo' ? '1' : s === 'vak' ? '2' : '3', text = query ? `🔎 Search Result\n\n🖥 Server ${label}\n\nSearch: ${query}\nFound: ${d.r.length}\nPage ${d.n}/${d.total}` : `📦 Select Service\n\n🖥 Server ${label}\n\nLive Services: ${a.length}\nPage ${d.n}/${d.total}`;
  const target = chatId || q?.chat?.id || q?.from?.id;
  if (!target) throw Error('Live catalog chat_id missing');
  if (q?.message?.chat?.id && q?.message?.message_id) return bot.telegram.editMessageText(q.message.chat.id, q.message.message_id, undefined, text, Markup.inlineKeyboard(rows));
  return bot.telegram.sendMessage(target, text, Markup.inlineKeyboard(rows));
}
async function showAll(bot, q, s, svc) {
  const a = await countries(s, svc), c = await cfg(s);
  let rr = 100; try { const x = await mongoose.connection.db.collection('settings').findOne({ key: 'usdtInrRate' }); if (Number(x?.value) > 0) rr = Number(x.value); } catch {}
  const rows = a.slice(0, 50).map(x => { let p = sell(Number(x.p) * rr, c); const label = s === 'tempo' ? '1' : s === 'vak' ? '2' : '3'; return [Markup.button.callback(`🖥 Server ${label} • 🌍 ${x.name} • ₹${p} • Stock: ${x.stock}`, 'fbuy:' + s + ':' + enc(x.id) + ':' + enc(svc.id))]; });
  if (!rows.length) rows.push([Markup.button.callback('🔄 Refresh', 'fsvc:' + s + ':' + enc(svc.id))]);
  rows.push([Markup.button.callback('⬅ Services', 'nsfix:' + s)]);
  const label = s === 'tempo' ? '1' : s === 'vak' ? '2' : '3';
  return bot.telegram.editMessageText(q.message.chat.id, q.message.message_id, undefined, `📦 ${svc.name}\n\n🖥 Server ${label}\n\n🌍 Live countries: ${a.length}`, Markup.inlineKeyboard(rows));
}
const prev = Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate = async function (u, ...args) {
  try {
    const q = u?.callback_query, cb = q?.data || '', uid = q?.from?.id || u?.message?.from?.id || u?.message?.chat?.id, text = u?.message?.text || '';
    if (q && uid) {
      if (['ns_user_5sim','ns_user_vak','tempo_user'].includes(cb)) { const s = cb === 'tempo_user' ? 'tempo' : cb === 'ns_user_vak' ? 'vak' : '5sim'; try { await this.telegram.answerCbQuery(q.id); } catch {} return showServices(this, q, s, '', 1, uid); }
      if (cb.startsWith('fsearch2:')) { const s = cb.slice(9); state.set(String(uid), 'search2:' + s); try { await this.telegram.answerCbQuery(q.id); } catch {} return this.telegram.sendMessage(uid, '🔎 Search Service\n\nService name ya service ID bheje:'); }
      if (cb.startsWith('fpage2:')) { const z = cb.split(':'), s = z[1], p = Number(z[2]) || 1, query = dec(z.slice(3).join(':')); try { await this.telegram.answerCbQuery(q.id); } catch {} return showServices(this, q, s, query, p, uid); }
      if (cb.startsWith('fsvc:')) { const z = cb.split(':'), s = z[1], id = dec(z.slice(2).join(':')), a = await services(s), svc = a.find(x => String(x.id) === String(id)); if (svc) { try { await this.telegram.answerCbQuery(q.id); } catch {} return showAll(this, q, s, svc); } }
      if (cb.startsWith('nsfix:')) { try { await this.telegram.answerCbQuery(q.id); } catch {} return showServices(this, q, cb.slice(7), '', 1, uid); }
    }
    if (u?.message?.chat?.type === 'private' && uid && text && !text.startsWith('/')) { const v = state.get(String(uid)); if (v?.startsWith('search2:')) { state.delete(String(uid)); return showServices(this, null, v.slice(8), text.trim(), 1, uid); } }
  } catch (e) { console.log('LIVE PROVIDER FIX:', e.message); }
  return prev.call(this, u, ...args);
};
