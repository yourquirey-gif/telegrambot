const mongoose = require('mongoose');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');

const OWNER_ID = 5087094625;
const FIVE_BASE = 'https://5sim.net/v1';
const FIVE_TOKEN = process.env.FIVESIM_API_KEY || process.env.FIVE_SIM_API_KEY || process.env['5SIM_API_KEY'] || '';
const VAK_KEY = process.env.VAKSMS_API_KEY || '';
const VAK_BASE = 'https://vak-sms.com/stubs/handler_api.php';

const cfgSchema = new mongoose.Schema({
  server: {type:String, unique:true},
  countries: {type:Array, default:[]},
  services: {type:Array, default:[]},
  operators: {type:Array, default:[]},
  markup: {type:Number, default:0}
}, {collection:'number_server_configs'});
const NumberServerConfig = mongoose.models.NumberServerConfig || mongoose.model('NumberServerConfig', cfgSchema);
const setupState = new Map();
const pendingFive = new Map();

async function isAdmin(id){
  if(Number(id)===OWNER_ID) return true;
  try{return !!(await mongoose.models.Admin?.findOne({userId:String(id)}));}catch{return false;}
}
async function getCfg(server){
  return NumberServerConfig.findOneAndUpdate({server},{server},{upsert:true,new:true,setDefaultsOnInsert:true});
}
function page(arr,p=1,n=5){return arr.slice((p-1)*n,p*n);}
function safe(s){return encodeURIComponent(String(s));}
function dec(s){try{return decodeURIComponent(s)}catch{return String(s)}}

async function five(method,path){
  if(!FIVE_TOKEN) throw new Error('5SIM API key is not configured');
  const r=await axios({method,url:FIVE_BASE+path,headers:{Authorization:`Bearer ${FIVE_TOKEN}`,Accept:'application/json'},timeout:15000});
  return r.data;
}
async function fiveGuest(path){
  const r=await axios.get(FIVE_BASE+path,{headers:{Accept:'application/json'},timeout:15000});
  return r.data;
}
async function vak(action,params={}){
  const r=await axios.get(VAK_BASE,{params:{action,api_key:VAK_KEY,...params},timeout:15000});
  return r.data;
}

async function sendServerMenu(bot,userId){
  return bot.telegram.sendMessage(userId,'🖥 NUMBER SERVERS\n\nServer 1 = 5SIM\nServer 2 = VAK-SMS',Markup.inlineKeyboard([
    [Markup.button.callback('🟢 Server 1 • 5SIM','ns_user_5sim')],
    [Markup.button.callback('🔵 Server 2 • VAK-SMS','ns_user_vak')],
    [Markup.button.callback('🏠 Home','home')]
  ]));
}
async function sendConfigMenu(bot,userId,server){
  const c=await getCfg(server);
  const title=server==='5sim'?'5SIM':'VAK-SMS';
  return bot.telegram.sendMessage(userId,`⚙️ ${title} SETTINGS\n\nCountries: ${c.countries.length}\nServices: ${c.services.length}\nOperators: ${c.operators.length}\nMarkup: ${c.markup}%`,Markup.inlineKeyboard([
    [Markup.button.callback('🌍 Add Country',`nsc_${server}_add_country`),Markup.button.callback('🗑 Remove Country',`nsc_${server}_del_country`)],
    [Markup.button.callback('📦 Add Service',`nsc_${server}_add_service`),Markup.button.callback('🗑 Remove Service',`nsc_${server}_del_service`)],
    ...(server==='5sim' ? [[Markup.button.callback('📡 Add Operator','nsc_5sim_add_operator'),Markup.button.callback('🗑 Remove Operator','nsc_5sim_del_operator')],[Markup.button.callback('📈 Set Markup %','nsc_5sim_markup')]] : []),
    [Markup.button.callback('📋 View Settings',`nsc_${server}_view`)],
    [Markup.button.callback('⬅ Number Servers','admin_servers')]
  ]));
}

async function handleAdminText(bot,userId,text){
  const st=setupState.get(String(userId)); if(!st) return false;
  setupState.delete(String(userId));
  const c=await getCfg(st.server);
  const parts=text.split('|').map(x=>x.trim());
  try{
    if(st.action==='add_country'){
      if(st.server==='5sim'){ if(parts.length<2) throw new Error('Format: country-api-name | Display Name'); c.countries.push({id:parts[0].toLowerCase(),name:parts[1]}); }
      else { if(parts.length<3) throw new Error('Format: countryId | Display Name | Country Code'); c.countries.push({id:parts[0],name:parts[1],code:parts[2]}); }
    } else if(st.action==='del_country') c.countries=c.countries.filter(x=>String(x.id).toLowerCase()!==parts[0].toLowerCase());
    else if(st.action==='add_service') { if(parts.length<2) throw new Error(st.server==='5sim'?'Format: service-api-code | Display Name':'Format: service-api-code | Display Name | Price'); c.services=c.services.filter(x=>String(x.id).toLowerCase()!==parts[0].toLowerCase()); c.services.push({id:parts[0].toLowerCase(),name:parts[1],price:st.server==='5sim'?0:Number(parts[2]||0)}); }
    else if(st.action==='del_service') c.services=c.services.filter(x=>String(x.id).toLowerCase()!==parts[0].toLowerCase());
    else if(st.action==='add_operator') { if(parts.length<3) throw new Error('Format: country | service | operator'); c.operators=c.operators.filter(x=>!(x.country===parts[0]&&x.service===parts[1])); c.operators.push({country:parts[0],service:parts[1],operator:parts[2]}); }
    else if(st.action==='del_operator') c.operators=c.operators.filter(x=>!(x.country===parts[0]&&x.service===parts[1]&&x.operator===parts[2]));
    else if(st.action==='markup') { const n=Number(text); if(!Number.isFinite(n)||n<0) throw new Error('Enter valid percentage'); c.markup=n; }
    else throw new Error('Unknown setting');
    await c.save();
    await bot.telegram.sendMessage(userId,'✅ Saved successfully.');
  }catch(e){await bot.telegram.sendMessage(userId,`❌ ${e.message}`);}
  await sendConfigMenu(bot,userId,st.server); return true;
}

async function showCountries(ctx,server,p=1){
  const c=await getCfg(server); const arr=page(c.countries,p); const total=Math.max(1,Math.ceil(c.countries.length/5));
  const rows=arr.map(x=>[Markup.button.callback(`🌍 ${x.name}`,`ns_country_${server}_${safe(x.id)}`)]);
  const nav=[]; if(p>1) nav.push(Markup.button.callback('⬅',`ns_countries_${server}_${p-1}`)); if(p<total) nav.push(Markup.button.callback('➡',`ns_countries_${server}_${p+1}`)); if(nav.length) rows.push(nav);
  rows.push([Markup.button.callback('⬅ Servers','ns_user_menu')]);
  return ctx.reply(`🌍 ${server==='5sim'?'5SIM':'VAK-SMS'} • Select Country\n\nPage ${p}/${total}`,Markup.inlineKeyboard(rows));
}
async function showServices(ctx,server,country,p=1){
  const c=await getCfg(server); const arr=page(c.services,p); const total=Math.max(1,Math.ceil(c.services.length/5));
  const rows=[];
  for(const s of arr) rows.push([Markup.button.callback(`📦 ${s.name}`,`ns_buy_${server}_${safe(country.id)}_${safe(s.id)}`)]);
  const nav=[]; if(p>1) nav.push(Markup.button.callback('⬅',`ns_services_${server}_${safe(country.id)}_${p-1}`)); if(p<total) nav.push(Markup.button.callback('➡',`ns_services_${server}_${safe(country.id)}_${p+1}`)); if(nav.length) rows.push(nav);
  rows.push([Markup.button.callback('⬅ Countries',`ns_countries_${server}_1`)]);
  return ctx.reply(`📦 Select Service\n\n🌍 ${country.name}\n\nPage ${p}/${total}`,Markup.inlineKeyboard(rows));
}

async function fivePrice(country,service,operator){
  const data=await fiveGuest(`/guest/prices?country=${encodeURIComponent(country)}&product=${encodeURIComponent(service)}`).catch(()=>null);
  if(!data) return null;
  const block=data[country]?.[service] || null; if(!block) return null;
  if(operator && operator!=='any' && block[operator]) return Number(block[operator].cost);
  const vals=Object.values(block).map(v=>Number(v.cost)).filter(Number.isFinite); return vals.length?Math.min(...vals):null;
}
async function fiveBuy(ctx,country,service,operator,price){
  const uid=String(ctx.from.id); const User=mongoose.models.User; const user=await User.findOne({userId:uid});
  if(!user) return ctx.reply('❌ User not found.');
  if(user.banned) return ctx.reply('❌ You are banned.');
  if(user.activeOrder) return ctx.reply('⚠️ You already have an active order.\n\nPlease complete or cancel it first.');
  if(user.credits < price) return ctx.answerCbQuery(`❌ Not enough credits\n\nRequired: ${price}\nBalance: ${user.credits}`,{show_alert:true});
  await ctx.answerCbQuery('📡 Searching 5SIM number...');
  let order;
  try{order=await five('GET',`/user/buy/activation/${encodeURIComponent(country)}/${encodeURIComponent(operator||'any')}/${encodeURIComponent(service)}`);}catch(e){return ctx.reply(`❌ 5SIM ERROR\n\n${e.response?.data?.message||e.response?.data?.error||e.message}`);}
  if(!order?.id||!order?.phone) return ctx.reply('❌ 5SIM did not return a number.');
  user.activeOrder=true; user.activeOrderId='5s:'+order.id; await user.save();
  return ctx.reply(`╔══════════════════════╗\n 📱 NUMBER ALLOCATED\n╚══════════════════════╝\n\n🖥 Server : 5SIM\n🌍 Country : ${country}\n✅ Service : ${service.toUpperCase()}\n📡 Operator : ${order.operator||operator||'any'}\n📱 Number : <code>${order.phone}</code>\n🆔 Order ID : <code>${order.id}</code>\n\n💎 Price : ${price} credits`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel',`ns_cancel_5s_${order.id}_${price}`)],[Markup.button.callback('🔄 Check OTP',`ns_otp_5s_${order.id}_${service}_${price}`)],[Markup.button.callback('🏠 Home','home')]])});
}
async function vakBuy(ctx,country,service,price){
  const uid=String(ctx.from.id); const User=mongoose.models.User; const user=await User.findOne({userId:uid});
  if(!user) return ctx.reply('❌ User not found.');
  if(user.banned) return ctx.reply('❌ You are banned.');
  if(user.activeOrder) return ctx.reply('⚠️ You already have an active order.\n\nPlease complete or cancel it first.');
  if(user.credits < price) return ctx.answerCbQuery(`❌ Not enough credits\n\nRequired: ${price}\nBalance: ${user.credits}`,{show_alert:true});
  await ctx.answerCbQuery('📡 Searching VAK-SMS number...');
  let response;
  try{response=await vak('getNumber',{service,country});}catch(e){return ctx.reply(`❌ VAK-SMS ERROR\n\n${e.response?.data?.message||e.response?.data||e.message}`);}
  if(typeof response==='string' && response.startsWith('ACCESS_NUMBER:')){
    const parts=response.split(':'); const id=parts[1]; const phone=parts.slice(2).join(':');
    user.activeOrder=true; user.activeOrderId='vk:'+id; await user.save();
    return ctx.reply(`╔══════════════════════╗\n 📱 NUMBER ALLOCATED\n╚══════════════════════╝\n\n🖥 Server : VAK-SMS\n🌍 Country : ${country}\n✅ Service : ${service.toUpperCase()}\n📱 Number : <code>+${phone.replace(/^\+/,'')}</code>\n🆔 Order ID : <code>${id}</code>\n\n💎 Price : ${price} credits`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel',`ns_cancel_vk_${id}_${price}`)],[Markup.button.callback('🔄 Check OTP',`ns_otp_vk_${id}_${service}_${price}`)],[Markup.button.callback('🏠 Home','home')]])});
  }
  return ctx.reply(`❌ VAK-SMS ERROR\n\n${String(response||'No number available')}`);
}

const originalHandle=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){
  try{
    const from=update?.message?.from||update?.callback_query?.from; const uid=from?.id; const cb=update?.callback_query?.data||''; const text=update?.message?.text||'';
    if(uid && await isAdmin(uid) && update.message?.chat?.type==='private' && text && !text.startsWith('/') && await handleAdminText(this,uid,text)) return;
    if(uid && await isAdmin(uid)){
      if(cb==='admin_servers'){try{await this.telegram.answerCbQuery(update.callback_query.id)}catch{};return this.telegram.sendMessage(uid,'🖥 NUMBER SERVERS ADMIN\n\nConfigure each server separately.',Markup.inlineKeyboard([[Markup.button.callback('🟢 5SIM Settings','ns_5sim')],[Markup.button.callback('🔵 VAK-SMS Settings','ns_vak')],[Markup.button.callback('⬅ Admin Panel','admin_panel')]]));}
      if(cb==='ns_5sim'||cb==='ns_vak'){try{await this.telegram.answerCbQuery(update.callback_query.id)}catch{};return sendConfigMenu(this,uid,cb==='ns_5sim'?'5sim':'vak');}
      const m=cb.match(/^nsc_(5sim|vak)_(add_country|del_country|add_service|del_service|add_operator|del_operator|markup)$/);
      if(m){setupState.set(String(uid),{server:m[1],action:m[2]});try{await this.telegram.answerCbQuery(update.callback_query.id)}catch{};const prompts={add_country:m[1]==='5sim'?'Send: country-api-name | Display Name':'Send: countryId | Display Name | Country Code',del_country:'Send country ID to remove',add_service:m[1]==='5sim'?'Send: service-api-code | Display Name':'Send: service-api-code | Display Name | Price',del_service:'Send service ID to remove',add_operator:'Send: country | service | operator',del_operator:'Send: country | service | operator',markup:'Send markup percentage, e.g. 20'};return this.telegram.sendMessage(uid,`✍️ ${prompts[m[2]]}`);}
      const vm=cb.match(/^nsc_(5sim|vak)_view$/);if(vm){const c=await getCfg(vm[1]);return this.telegram.sendMessage(uid,`📋 ${vm[1].toUpperCase()} CONFIG\n\nCountries:\n${c.countries.map(x=>`${x.id} = ${x.name}`).join('\n')||'None'}\n\nServices:\n${c.services.map(x=>`${x.id} = ${x.name}${vm[1]==='vak'&&x.price?' • '+x.price+' credits':''}`).join('\n')||'None'}\n\nOperators:\n${c.operators.map(x=>`${x.country} | ${x.service} | ${x.operator}`).join('\n')||'None'}\n\nMarkup: ${c.markup}%`);}
    }
    if(uid && cb==='devices_1'){try{await this.telegram.answerCbQuery(update.callback_query.id)}catch{};return sendServerMenu(this,uid);}
    if(uid && cb==='ns_user_5sim') return showCountries(update.callback_query,'5sim',1);
    if(uid && cb==='ns_user_vak') return showCountries(update.callback_query,'vak',1);
    if(uid && cb==='ns_user_menu') return sendServerMenu(this,uid);
    if(uid && cb.startsWith('ns_countries_')){const p=cb.split('_');return showCountries(update.callback_query,p[2],Number(p[3])||1);}
    if(uid && cb.startsWith('ns_country_')){const p=cb.split('_');const server=p[2],cid=dec(p[3]);const c=await getCfg(server);const country=c.countries.find(x=>String(x.id)===cid);if(!country)return this.telegram.sendMessage(uid,'❌ Country not found');return showServices(update.callback_query,server,country,1);}
    if(uid && cb.startsWith('ns_services_')){const p=cb.split('_');const server=p[2],cid=dec(p[3]),pg=Number(p[4])||1;const c=await getCfg(server);const country=c.countries.find(x=>String(x.id)===cid);if(!country)return this.telegram.sendMessage(uid,'❌ Country not found');return showServices(update.callback_query,server,country,pg);}
    if(uid && cb.startsWith('ns_buy_')){
      const p=cb.split('_');const server=p[2],country=dec(p[3]),service=dec(p[4]);const c=await getCfg(server);const co=c.countries.find(x=>String(x.id)===country);const se=c.services.find(x=>String(x.id)===service);if(!co||!se)return this.telegram.sendMessage(uid,'❌ Configuration missing');
      if(server==='5sim'){
        const configured=c.operators.find(o=>o.country===country&&o.service===service);const operator=configured?.operator||'any';const base=await fivePrice(country,service,operator);if(base==null)return this.telegram.sendMessage(uid,'❌ No 5SIM price/stock found.');const price=Math.ceil(base*(1+Number(c.markup||0)/100));
        if(!configured){pendingFive.set(String(uid),{country,service,price,base});return this.telegram.sendMessage(uid,`🟡 Confirm 5SIM Purchase\n\n🌍 Country: ${co.name}\n📦 Service: ${se.name}\n💎 Price: ${price} credits\n\nOperator is not set. Continue with any operator?`,Markup.inlineKeyboard([[Markup.button.callback('✅ Yes',`ns_confirm5_${safe(country)}_${safe(service)}_${price}`),Markup.button.callback('❌ No','ns_confirm5_no')]]));}
        return fiveBuy(update.callback_query,country,service,operator,price);
      }
      const price=Number(se.price||0);if(price<=0)return this.telegram.sendMessage(uid,'❌ VAK-SMS price is not set for this service.');return vakBuy(update.callback_query,country,service,price);
    }
    if(uid && cb==='ns_confirm5_no'){pendingFive.delete(String(uid));return this.telegram.editMessageText(uid,update.callback_query.message.message_id,undefined,'❌ Purchase cancelled.');}
    if(uid && cb.startsWith('ns_confirm5_')){const p=cb.split('_');const country=dec(p[2]),service=dec(p[3]),price=Number(p[4]);pendingFive.delete(String(uid));return fiveBuy(update.callback_query,country,service,'any',price);}
    if(uid && cb.startsWith('ns_otp_5s_')){const p=cb.split('_');const id=p[3],service=dec(p[4]),price=Number(p[5]);const User=mongoose.models.User;const user=await User.findOne({userId:String(uid)});if(!user)return;try{await this.telegram.answerCbQuery(update.callback_query.id,'🔄 Checking OTP...')}catch{};try{const o=await five('GET',`/user/check/${id}`);if(o?.sms?.length){const sms=o.sms[o.sms.length-1];user.credits=Math.max(0,user.credits-price);user.totalOtp=(user.totalOtp||0)+1;user.activeOrder=false;user.activeOrderId=null;await user.save();try{await five('GET',`/user/finish/${id}`)}catch{};return this.telegram.sendMessage(uid,`╔══════════════════════╗\n 📩 OTP RECEIVED\n╚══════════════════════╝\n\n🔐 OTP\n\n<code>${sms.code||sms.text}</code>\n\n💎 Charged: ${price} credits`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.callback('🏠 Home','home')]])});}return this.telegram.sendMessage(uid,`⏳ OTP not received yet.\n\nStatus: ${o?.status||'PENDING'}\n\nTap Check OTP again.`);}catch(e){return this.telegram.sendMessage(uid,'❌ 5SIM OTP error.');}}
    if(uid && cb.startsWith('ns_otp_vk_')){const p=cb.split('_');const id=p[3],service=dec(p[4]),price=Number(p[5]);const User=mongoose.models.User;const user=await User.findOne({userId:String(uid)});if(!user)return;try{await this.telegram.answerCbQuery(update.callback_query.id,'🔄 Checking OTP...')}catch{};try{const o=await vak('getStatus',{id});if(typeof o==='string'&&o.startsWith('STATUS_OK:')){const code=o.split(':').slice(1).join(':');user.credits=Math.max(0,user.credits-price);user.totalOtp=(user.totalOtp||0)+1;user.activeOrder=false;user.activeOrderId=null;await user.save();return this.telegram.sendMessage(uid,`╔══════════════════════╗\n 📩 OTP RECEIVED\n╚══════════════════════╝\n\n🔐 OTP\n\n<code>${code}</code>\n\n💎 Charged: ${price} credits`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.callback('🏠 Home','home')]])});}return this.telegram.sendMessage(uid,`⏳ OTP not received yet.\n\nStatus: ${o||'PENDING'}\n\nTap Check OTP again.`);}catch(e){return this.telegram.sendMessage(uid,'❌ VAK-SMS OTP error.');}}
    if(uid && cb.startsWith('ns_cancel_vk_')){const p=cb.split('_');const id=p[3];const User=mongoose.models.User;const user=await User.findOne({userId:String(uid)});try{await vak('setStatus',{id,status:'8'})}catch{};if(user){user.activeOrder=false;user.activeOrderId=null;await user.save();}return this.telegram.sendMessage(uid,'❌ VAK-SMS order cancelled.');}
    if(uid && cb.startsWith('ns_cancel_5s_')){const p=cb.split('_');const id=p[3];const User=mongoose.models.User;const user=await User.findOne({userId:String(uid)});try{await five('GET',`/user/cancel/${id}`)}catch{};if(user){user.activeOrder=false;user.activeOrderId=null;await user.save();}return this.telegram.sendMessage(uid,'❌ 5SIM order cancelled.');}
  }catch(e){console.log('Number server boot error:',e.message);}
  return originalHandle.call(this,update,...args);
};

try{
 const Telegram=require('telegraf').Telegram;const originalCallApi=Telegram.prototype.callApi;
 Telegram.prototype.callApi=async function(method,payload,...args){
  try{if(method==='sendMessage'&&payload&&String(payload.text||'').includes('⚙️ ADMIN PANEL')&&payload.reply_markup){const kb=payload.reply_markup.inline_keyboard||[];if(!kb.some(r=>r.some(b=>b.callback_data==='admin_servers'))){kb.push([{text:'🖥 Number Servers',callback_data:'admin_servers'}]);payload.reply_markup.inline_keyboard=kb;}}}catch{}
  return originalCallApi.call(this,method,payload,...args);
 };
}catch{}
