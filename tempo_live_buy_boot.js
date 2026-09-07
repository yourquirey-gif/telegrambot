const mongoose = require('mongoose');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');

const BASE = 'https://api.temporasms.com/stubs/handler_api.php';
const KEY = process.env.TEMPORASMS_API_KEY || process.env.TEMPO_API_KEY || process.env.TEMPO_SMS_API_KEY || '';
const cache = new Map();
const enc = x => encodeURIComponent(String(x));
const dec = x => { try { return decodeURIComponent(x); } catch { return String(x); } };
const norm = x => String(x ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

async function tempo(action, params = {}) {
  if (!KEY) throw new Error('TemporaSMS API key is not configured');
  return (await axios.get(BASE, { params: { action, api_key: KEY, ...params }, timeout: 20000, headers: { Accept: 'application/json' } })).data;
}
async function cfg() {
  try { return await mongoose.connection.db.collection('number_server_configs').findOne({ server: 'tempo' }); } catch { return null; }
}
function countryName(id, c) {
  const x = (c?.countries || []).find(v => String(v.id ?? v.countryId ?? v.code) === String(id));
  return String(x?.name || x?.title || x?.text_en || x?.eng || x?.rus || id).replace(/[_-]+/g, ' ');
}
function block(v) {
  let p = 0, stock = 0;
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    for (const k of ['cost','price','rate','sell_price','buy_price','Price']) {
      const n = Number(o[k]); if (Number.isFinite(n) && n > 0) p = p ? Math.min(p, n) : n;
    }
    for (const k of ['count','stock','qty','quantity','available','Qty']) {
      const n = Number(o[k]); if (Number.isFinite(n) && n >= 0) stock += n;
    }
    for (const [k,x] of Object.entries(o)) if (!['cost','price','rate','sell_price','buy_price','Price','count','stock','qty','quantity','available','Qty'].includes(k) && x && typeof x === 'object') walk(x);
  };
  walk(v); return { p, stock };
}
async function priceTreesFresh() {
  const trees = [];
  let ops = [];
  try {
    const d = await tempo('getOperators', {});
    if (Array.isArray(d)) ops = d.map(x => String(x?.id ?? x?.code ?? x?.operator ?? x)).filter(Boolean);
    else if (d && typeof d === 'object') ops = Object.entries(d).map(([k,v]) => String(v?.id ?? v?.code ?? v?.operator ?? k)).filter(Boolean);
    else if (typeof d === 'string') ops = d.replace(/^OK:/i,'').split(/[,;|\n]+/).map(x=>x.trim()).filter(Boolean);
  } catch (e) { console.log('TEMPO LIVE OPERATORS ERROR:', e.response?.data || e.message); }
  ops = [...new Set(ops)].filter(x => x.toLowerCase() !== 'any').slice(0, 40);
  for (const operator of ops) {
    try {
      const d = await tempo('getPrices', { operator });
      if (d && typeof d === 'object' && !Array.isArray(d)) trees.push(d);
    } catch (e) { console.log('TEMPO LIVE PRICE ERROR:', operator, e.response?.data || e.message); }
  }
  if (!trees.length) {
    for (const action of ['getPricesV3','getPricesV2','getPrices']) {
      try {
        const d = await tempo(action, {});
        if (d && typeof d === 'object' && !Array.isArray(d)) { trees.push(d); console.log('TEMPO LIVE PRICE FALLBACK:', action); break; }
      } catch (e) { console.log('TEMPO LIVE PRICE FALLBACK ERROR:', action, e.response?.data || e.message); }
    }
  }
  return trees;
}
function countriesFromTree(d, service, names, out = new Map()) {
  const svc = String(service), ns = norm(service);
  const walk = o => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    for (const [k,v] of Object.entries(o)) {
      if (!v || typeof v !== 'object') continue;
      if (norm(k) === ns) {
        for (const [country,val] of Object.entries(v)) {
          const b = block(val);
          if (b.p > 0 || b.stock > 0) out.set(String(country), { id:String(country), name:countryName(country,names), ...b });
        }
        continue;
      }
      if (v[svc] && typeof v[svc] === 'object') {
        const b = block(v[svc]);
        if (b.p > 0 || b.stock > 0) out.set(String(k), { id:String(k), name:countryName(k,names), ...b });
      }
      for (const [sk,sv] of Object.entries(v)) if (norm(sk) === ns && sv && typeof sv === 'object') {
        const b = block(sv);
        if (b.p > 0 || b.stock > 0) out.set(String(k), { id:String(k), name:countryName(k,names), ...b });
      }
      walk(v);
    }
  };
  walk(d); return out;
}
async function liveCountries(serviceId) {
  const c = await cfg();
  const names = new Map((c?.countries || []).map(x => [String(x.id ?? x.countryId ?? x.code), String(x.name || x.title || x.text_en || x.eng || x.rus || x.countryName || x.id)]));
  const out = new Map();
  for (const tree of await priceTreesFresh()) countriesFromTree(tree, serviceId, names, out);
  return [...out.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
async function livePriceFor(serviceId, countryId) {
  const all = await liveCountries(serviceId);
  return all.find(x => String(x.id) === String(countryId)) || null;
}
function sell(p,c) {
  let x = Number(p || 0), f = Number(c?.profit || c?.profitAmount || 0), q = Number(c?.profitPercent || c?.markup || 0);
  if (f > 0) x += f;
  if (q > 0) x *= 1 + q / 100;
  return Math.ceil(x * 100) / 100;
}
async function rate() {
  try { const x = await mongoose.connection.db.collection('settings').findOne({ key:'usdtInrRate' }); if (Number(x?.value) > 0) return Number(x.value); } catch {}
  return 100;
}
async function userModel() { return mongoose.models.User; }

async function showLiveService(bot, q, sid) {
  const c = await cfg();
  const svc = (c?.services || []).find(x => norm(x.id ?? x.code ?? x.service) === norm(sid));
  const service = svc || { id:sid, name:sid };
  const countries = await liveCountries(service.id);
  const rr = await rate();
  const rows = countries.slice(0,50).map(x => {
    const price = sell(Number(x.p) * rr, c);
    return [Markup.button.callback(`🖥 Server 1 • 🌍 ${x.name} • ₹${price} • Stock: ${x.stock}`, `fbuy:tempo:${enc(x.id)}:${enc(service.id)}`)];
  });
  if (!rows.length) rows.push([Markup.button.callback('🔄 Refresh Live Stock', `acsvc:${enc(service.id)}`)]);
  rows.push([Markup.button.callback('⬅ Services','acroot')]);
  try { await q.answerCbQuery('🔄 Live price & stock fetched'); } catch {}
  return bot.telegram.editMessageText(q.message.chat.id, q.message.message_id, undefined,
    `📦 ${service.name}\n\n🖥 Server 1 • TemporaSMS\n\n🌍 Live countries: ${countries.length}\n💰 Price & Stock: LIVE`,
    Markup.inlineKeyboard(rows));
}

async function buyTempo(bot, q, countryId, serviceId) {
  const User = await userModel();
  const uid = String(q.from.id);
  if (!User) return bot.telegram.sendMessage(uid,'❌ User system is not ready.');
  const user = await User.findOne({ userId:uid });
  if (!user) return bot.telegram.sendMessage(uid,'❌ User not found.');
  if (user.banned) return bot.telegram.sendMessage(uid,'❌ You are banned.');
  if (user.activeOrder) return bot.telegram.sendMessage(uid,'⚠️ You already have an active order.\n\nPlease complete or cancel it first.');

  const live = await livePriceFor(serviceId, countryId);
  if (!live || live.stock <= 0 || live.p <= 0) return bot.telegram.sendMessage(uid,'❌ This number is no longer available.\n\nLive stock/price changed. Please refresh and try again.');
  const c = await cfg();
  const rr = await rate();
  const price = sell(Number(live.p) * rr, c);
  if (user.credits < price) return bot.telegram.sendMessage(uid,`❌ Not enough credits\n\n💎 Required: ${price}\n💰 Balance: ${user.credits}`);

  try { await bot.telegram.answerCbQuery(q.id, '📡 Buying from TemporaSMS live stock...'); } catch {}
  let response = null, lastError = null;
  for (const action of ['getNumberV2','getNumber']) {
    try {
      response = await tempo(action, { service:String(serviceId), country:String(countryId), operator:'auto', maxPrice:Number(live.p) });
      if (response) break;
    } catch (e) { lastError = e; }
  }
  console.log('TEMPO LIVE BUY RESPONSE:', response || lastError?.response?.data || lastError?.message);

  let id='', phone='', actualPrice=price;
  if (response && typeof response === 'object') {
    id = String(response.activationId ?? response.id ?? response.orderId ?? response.activation_id ?? '');
    phone = String(response.phoneNumber ?? response.phone ?? response.number ?? '');
    if (Number(response.activationCost) > 0) actualPrice = sell(Number(response.activationCost) * rr, c);
  } else if (typeof response === 'string' && response.startsWith('ACCESS_NUMBER:')) {
    const p = response.split(':'); id = String(p[1] || ''); phone = p.slice(2).join(':');
  }
  if (!id || !phone) {
    return bot.telegram.sendMessage(uid,`❌ TemporaSMS could not allocate a number.\n\n${typeof response === 'string' ? response : (lastError?.response?.data || 'NO_NUMBERS')}`);
  }
  if (user.credits < actualPrice) return bot.telegram.sendMessage(uid,`❌ Live provider price changed.\n\nRequired: ${actualPrice}\nBalance: ${user.credits}`);
  user.activeOrder = true;
  user.activeOrderId = `tempo:${id}`;
  await user.save();

  return bot.telegram.sendMessage(uid,
`╔══════════════════════╗\n 📱 NUMBER ALLOCATED\n╚══════════════════════╝\n\n🖥 Server : 1 • TemporaSMS\n🌍 Country : ${countryName(countryId,c)}\n✅ Service : ${String(serviceId).toUpperCase()}\n📱 Number : <code>+${phone.replace(/^\+/,'')}</code>\n🆔 Order ID : <code>${id}</code>\n\n💎 Price : ${actualPrice} credits\n📡 Stock/Price : Live`,
    { parse_mode:'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('❌ Cancel',`tempo_cancel_${enc(id)}`)],
      [Markup.button.callback('🔄 Check OTP',`tempo_otp_${enc(id)}:${enc(serviceId)}:${enc(actualPrice)}`)],
      [Markup.button.callback('🏠 Home','home')]
    ]) });
}

const previous = Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate = async function(update, ...args) {
  try {
    const q = update?.callback_query, cb = q?.data || '', uid = q?.from?.id;
    if (q && uid) {
      if (cb.startsWith('acsvc:')) return showLiveService(this, q, dec(cb.slice(6)));
      if (cb.startsWith('fbuy:tempo:')) {
        const z = cb.split(':');
        return buyTempo(this, q, dec(z[2]), dec(z.slice(3).join(':')));
      }
      if (cb.startsWith('tempo_otp:')) {
        const z = cb.split(':');
        const id = dec(z[1]), service = dec(z[2]), price = Number(dec(z[3]));
        const User = await userModel(); const user = await User.findOne({ userId:String(uid) });
        if (!user || !user.activeOrderId || user.activeOrderId !== `tempo:${id}`) return this.telegram.sendMessage(uid,'❌ Active order not found.');
        try { await this.telegram.answerCbQuery(q.id,'🔄 Checking OTP...'); } catch {}
        let d;
        try { d = await tempo('getStatus',{ id }); } catch(e) { return this.telegram.sendMessage(uid,`❌ TemporaSMS OTP error\n\n${e.response?.data || e.message}`); }
        console.log('TEMPO OTP RESPONSE:', d);
        if (typeof d === 'string' && d.startsWith('STATUS_OK:')) {
          const code = d.split(':').slice(1).join(':');
          user.totalOtp = Number(user.totalOtp || 0) + 1;
          user.credits = Math.max(0, Number(user.credits || 0) - price);
          user.activeOrder = false; user.activeOrderId = null; await user.save();
          return this.telegram.sendMessage(uid,`╔══════════════════════╗\n 📩 OTP RECEIVED\n╚══════════════════════╝\n\n🔐 OTP\n<code>${code}</code>\n\n💎 -${price} Credits\n💰 Balance : ${user.credits}`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.callback('🏠 Home','home')]])});
        }
        if (String(d) === 'STATUS_WAIT_CODE') return this.telegram.answerCbQuery(q.id,'⏳ Waiting for OTP...', {show_alert:true});
        if (['STATUS_CANCEL','NO_ACTIVATION'].includes(String(d))) { user.activeOrder=false; user.activeOrderId=null; await user.save(); return this.telegram.answerCbQuery(q.id,'⌛ Order expired or cancelled',{show_alert:true}); }
        return this.telegram.answerCbQuery(q.id,`❌ ${d || 'Unable to check OTP'}`,{show_alert:true});
      }
      if (cb.startsWith('tempo_cancel:')) {
        const id = dec(cb.slice(13)); const User = await userModel(); const user = await User.findOne({userId:String(uid)});
        if (!user || user.activeOrderId !== `tempo:${id}`) return this.telegram.answerCbQuery(q.id,'❌ Active order not found',{show_alert:true});
        try { await this.telegram.answerCbQuery(q.id,'Processing...'); } catch {}
        let d; try { d = await tempo('setStatus',{id,status:8}); } catch(e) { return this.telegram.sendMessage(uid,`❌ TemporaSMS cancel error\n\n${e.response?.data || e.message}`); }
        if (['ACCESS_CANCEL','STATUS_CANCEL','ACCESS_READY'].includes(String(d))) { user.activeOrder=false; user.activeOrderId=null; await user.save(); return this.telegram.sendMessage(uid,'❌ Order has been cancelled successfully.',Markup.inlineKeyboard([[Markup.button.callback('🏠 Home','home')]])); }
        return this.telegram.sendMessage(uid,`❌ ${d || 'Unable to cancel order.'}`);
      }
    }
  } catch (e) { console.log('TEMPO LIVE BUY ERROR:', e.message); }
  return previous.call(this, update, ...args);
};
