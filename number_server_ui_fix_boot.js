const mongoose = require('mongoose');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');

const FIVE_BASE='https://5sim.net/v1';
const FIVE_TOKEN=process.env.FIVESIM_API_KEY||process.env.FIVE_SIM_API_KEY||process.env['5SIM_API_KEY']||'';
const VAK_KEY=process.env.VAKSMS_API_KEY||'';
const VAK_BASE='https://vak-sms.com/stubs/handler_api.php';
const FX_URL='https://api.2328.io/api/v1/exchange-rates';
let usdtInrCache=0;
let usdtInrAt=0;

const cfgSchema=new mongoose.Schema({server:{type:String,unique:true},countries:{type:Array,default:[]},services:{type:Array,default:[]},operators:{type:Array,default:[]},markup:{type:Number,default:0}},{collection:'number_server_configs'});
const Config=mongoose.models.NumberServerUiFixConfig||mongoose.model('NumberServerUiFixConfig',cfgSchema);

async function cfg(server){return Config.findOneAndUpdate({server},{server},{upsert:true,new:true,setDefaultsOnInsert:true});}
function enc(x){return encodeURIComponent(String(x));}
function dec(x){try{return decodeURIComponent(x)}catch{return String(x)}}
function page(a,p=1,n=5){return a.slice((p-1)*n,p*n)}
async function fiveGuest(path){try{return (await axios.get(FIVE_BASE+path,{timeout:12000,headers:{Accept:'application/json'}})).data}catch{return null}}
async function vak(action,params={}){try{return (await axios.get(VAK_BASE,{params:{action,api_key:VAK_KEY,...params},timeout:12000})).data}catch{return null}}

async function getUsdtInr(){
  if(usdtInrCache>0 && Date.now()-usdtInrAt<10*60*1000)return usdtInrCache;
  try{
    const r=await axios.get(FX_URL,{timeout:10000});
    const rate=Number(r.data?.result?.USDT?.INR||r.data?.result?.USD?.INR);
    if(Number.isFinite(rate)&&rate>0){usdtInrCache=rate;usdtInrAt=Date.now();return rate;}
  }catch{}
  return usdtInrCache||null;
}

function findPriceInBlock(block){
  if(!block)return null;
  const vals=[];
  const scan=(v,depth=0)=>{
    if(depth>4||v==null)return;
    if(Array.isArray(v)){for(const x of v)scan(x,depth+1);return;}
    if(typeof v==='object'){
      for(const k of ['cost','price','rate','sell_price','buy_price']){
        const n=Number(v[k]);if(Number.isFinite(n)&&n>0)vals.push(n);
      }
      for(const x of Object.values(v))if(typeof x==='object')scan(x,depth+1);
    }
  };
  scan(block);
  return vals.length?Math.min(...vals):null;
}

async function fiveStock(country,service,operator){
  const data=await fiveGuest(`/guest/prices?country=${enc(country)}&product=${enc(service)}`);
  const block=data?.[country]?.[service]; if(!block)return 0;
  const vals=operator&&operator!=='any'&&block[operator]?[block[operator]]:Object.values(block);
  return vals.reduce((n,v)=>n+(Number(v?.count)||0),0);
}
async function fivePrice(country,service,operator){
  const data=await fiveGuest(`/guest/prices?country=${enc(country)}&product=${enc(service)}`); const block=data?.[country]?.[service]; if(!block)return null;
  if(operator&&operator!=='any'&&block[operator])return Number(block[operator].cost);
  const vals=Object.values(block).map(v=>Number(v?.cost)).filter(Number.isFinite); return vals.length?Math.min(...vals):null;
}
async function vakStock(country,service){
  const data=await vak('getPrices',{country,service});
  const block=data?.[country]?.[service] || (data?.[service]?.[country]);
  if(!block)return 0;
  return Object.values(block).reduce((n,v)=>n+(Number(v?.count)||0),0);
}
function findVakBlock(data,country,service){
  if(!data||typeof data!=='object')return null;
  if(data?.[country]?.[service])return data[country][service];
  if(data?.[service]?.[country])return data[service][country];
  let found=null;
  const walk=(obj,depth=0)=>{
    if(found||depth>5||!obj||typeof obj!=='object')return;
    if(obj[country]&&typeof obj[country]==='object'&&obj[country][service]){found=obj[country][service];return;}
    if(obj[service]&&typeof obj[service]==='object'&&obj[service][country]){found=obj[service][country];return;}
    for(const v of Object.values(obj))if(v&&typeof v==='object')walk(v,depth+1);
  };
  walk(data);return found;
}
async function vakPrice(country,service){
  const data=await vak('getPrices',{country,service});
  return findPriceInBlock(findVakBlock(data,country,service));
}

async function clearFinishedOrder(user){
  if(!user?.activeOrder||!user.activeOrderId)return false;
  const id=String(user.activeOrderId);
  try{
    if(id.startsWith('5s:')){
      if(!FIVE_TOKEN)return false;
      const oid=id.slice(3);
      const r=await axios.get(`${FIVE_BASE}/user/check/${enc(oid)}`,{headers:{Authorization:`Bearer ${FIVE_TOKEN}`,Accept:'application/json'},timeout:10000});
      const st=String(r.data?.status||'').toUpperCase();
      if(['CANCELED','CANCELLED','TIMEOUT','BANNED','FINISHED'].includes(st)){user.activeOrder=false;user.activeOrderId=null;await user.save();return true;}
    }else if(id.startsWith('vk:')){
      const oid=id.slice(3); const r=await vak('getStatus',{id:oid}); const st=String(r||'').toUpperCase();
      if(['STATUS_CANCEL','STATUS_CANCELED','STATUS_CANCELLED','STATUS_TIMEOUT','STATUS_FINISHED'].includes(st)){user.activeOrder=false;user.activeOrderId=null;await user.save();return true;}
    }
  }catch{}
  return false;
}

async function renderCountries(bot,q,server,p=1){
  const c=await cfg(server), arr=page(c.countries,p), total=Math.max(1,Math.ceil(c.countries.length/5));
  const rows=arr.map(x=>[Markup.button.callback(`🌍 ${x.name}`,`ns_country_${server}_${enc(x.id)}`)]);
  const nav=[];if(p>1)nav.push(Markup.button.callback('⬅',`ns_countries_${server}_${p-1}`));if(p<total)nav.push(Markup.button.callback('➡',`ns_countries_${server}_${p+1}`));if(nav.length)rows.push(nav);
  rows.push([Markup.button.callback('⬅ Servers','ns_user_menu')]);
  return bot.telegram.editMessageText(q.message.chat.id,q.message.message_id,undefined,`🌍 Select Country\n\nPage ${p}/${total}`,Markup.inlineKeyboard(rows));
}
async function renderServices(bot,q,server,countryId,p=1){
  const c=await cfg(server), country=c.countries.find(x=>String(x.id)===String(countryId)); if(!country)return;
  const arr=page(c.services,p), total=Math.max(1,Math.ceil(c.services.length/5)), rows=[];
  for(const s of arr){
    let stock=0, price=Number(s.price||0);
    if(server==='5sim'){
      const op=c.operators.find(o=>String(o.country)===String(country.id)&&String(o.service).toLowerCase()===String(s.id).toLowerCase());
      stock=await fiveStock(country.id,s.id,op?.operator||'any');
      if(price<=0){
        const base=await fivePrice(country.id,s.id,op?.operator||'any');
        if(base!=null){const rate=await getUsdtInr();if(rate)price=Math.ceil(base*rate*(1+Number(c.markup||0)/100));}
      }else price=Math.ceil(price);
    }else{
      stock=await vakStock(country.id,s.id);
      if(price<=0){const pUsd=await vakPrice(country.id,s.id);const rate=await getUsdtInr();if(pUsd!=null&&rate)price=Math.ceil(pUsd*rate);}else price=Math.ceil(price);
    }
    rows.push([Markup.button.callback(`📦 ${s.name} • ₹${price} • Stock: ${stock}`,`ns_buy_${server}_${enc(country.id)}_${enc(s.id)}`)]);
  }
  const nav=[];if(p>1)nav.push(Markup.button.callback('⬅',`ns_services_${server}_${enc(country.id)}_${p-1}`));if(p<total)nav.push(Markup.button.callback('➡',`ns_services_${server}_${enc(country.id)}_${p+1}`));if(nav.length)rows.push(nav);
  rows.push([Markup.button.callback('⬅ Countries',`ns_countries_${server}_1`)]);
  return bot.telegram.editMessageText(q.message.chat.id,q.message.message_id,undefined,`📦 Select Service\n\n🌍 ${country.name}\n\nPage ${p}/${total}`,Markup.inlineKeyboard(rows));
}

async function directBuy(bot,q,server,country,service){
  const User=mongoose.models.User;const user=await User?.findOne({userId:String(q.from.id)});
  if(!user)return bot.telegram.sendMessage(q.from.id,'❌ User not found.');
  if(user.banned)return bot.telegram.sendMessage(q.from.id,'❌ You are banned.');
  await clearFinishedOrder(user);
  if(user.activeOrder)return bot.telegram.sendMessage(q.from.id,'⚠️ You already have an active order.\n\nPlease complete or cancel it first.');
  const c=await cfg(server);const co=c.countries.find(x=>String(x.id)===String(country));const se=c.services.find(x=>String(x.id)===String(service));
  if(!co||!se)return bot.telegram.sendMessage(q.from.id,'❌ Configuration missing.');
  let price=Number(se.price||0), operator='any';
  if(server==='5sim'){
    const op=c.operators.find(o=>String(o.country)===String(country)&&String(o.service).toLowerCase()===String(service).toLowerCase());operator=op?.operator||'any';
    if(price<=0){const usd=await fivePrice(country,service,operator);const rate=await getUsdtInr();if(usd==null||!rate)return bot.telegram.sendMessage(q.from.id,'❌ Provider price unavailable right now.');price=Math.ceil(usd*rate*(1+Number(c.markup||0)/100));}else price=Math.ceil(price);
    if(user.credits<price)return bot.telegram.answerCbQuery(q.id,`❌ Not enough balance\n\nRequired: ₹${price}\nBalance: ₹${user.credits}`,{show_alert:true});
    try{await bot.telegram.answerCbQuery(q.id,'📡 Searching Number...')}catch{}
    let order;try{if(!FIVE_TOKEN)throw new Error('5SIM API key is not configured');const r=await axios.get(`${FIVE_BASE}/user/buy/activation/${enc(country)}/${enc(operator)}/${enc(service)}`,{headers:{Authorization:`Bearer ${FIVE_TOKEN}`,Accept:'application/json'},timeout:15000});order=r.data;}catch(e){return bot.telegram.sendMessage(q.from.id,`❌ Server 1 ERROR\n\n${e.response?.data?.message||e.response?.data?.error||e.message}`);}
    if(!order?.id||!order?.phone)return bot.telegram.sendMessage(q.from.id,'❌ Server 1 did not return a number.');
    user.activeOrder=true;user.activeOrderId='5s:'+order.id;await user.save();
    return bot.telegram.sendMessage(q.from.id,`╔══════════════════════╗\n 📱 NUMBER ALLOCATED\n╚══════════════════════╝\n\n🖥 Server : Server 1\n🌍 Country : ${co.name}\n✅ Service : ${service.toUpperCase()}\n📡 Operator : ${order.operator||operator}\n📱 Number : <code>${order.phone}</code>\n🆔 Order ID : <code>${order.id}</code>\n\n💰 Price : ₹${price}`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel',`ns_cancel_5s_${order.id}_${price}`)],[Markup.button.callback('🔄 Check OTP',`ns_otp_5s_${order.id}_${service}_${price}`)],[Markup.button.callback('🏠 Home','home')]])});
  }
  if(price<=0){const usd=await vakPrice(country,service);const rate=await getUsdtInr();if(usd==null||!rate)return bot.telegram.sendMessage(q.from.id,'❌ Provider price unavailable right now.');price=Math.ceil(usd*rate);}else price=Math.ceil(price);
  if(user.credits<price)return bot.telegram.answerCbQuery(q.id,`❌ Not enough balance\n\nRequired: ₹${price}\nBalance: ₹${user.credits}`,{show_alert:true});
  try{await bot.telegram.answerCbQuery(q.id,'📡 Searching Number...')}catch{}
  let response;try{response=await vak('getNumber',{service,country});}catch(e){return bot.telegram.sendMessage(q.from.id,`❌ Server 2 ERROR\n\n${e.response?.data?.message||e.response?.data||e.message}`);}
  if(typeof response==='string'&&response.startsWith('ACCESS_NUMBER:')){const parts=response.split(':');const id=parts[1];const phone=parts.slice(2).join(':');user.activeOrder=true;user.activeOrderId='vk:'+id;await user.save();return bot.telegram.sendMessage(q.from.id,`╔══════════════════════╗\n 📱 NUMBER ALLOCATED\n╚══════════════════════╝\n\n🖥 Server : Server 2\n🌍 Country : ${co.name}\n✅ Service : ${service.toUpperCase()}\n📱 Number : <code>+${phone.replace(/^\+/,'')}</code>\n🆔 Order ID : <code>${id}</code>\n\n💰 Price : ₹${price}`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel',`ns_cancel_vk_${id}_${price}`)],[Markup.button.callback('🔄 Check OTP',`ns_otp_vk_${id}_${service}_${price}`)],[Markup.button.callback('🏠 Home','home')]])});}
  return bot.telegram.sendMessage(q.from.id,`❌ Server 2 ERROR\n\n${String(response||'No number available')}`);
}

const previous=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){
  try{
    const q=update?.callback_query, cb=q?.data||'', uid=q?.from?.id;
    if(q&&uid){
      if(cb==='ns_user_5sim'||cb==='ns_user_vak'){
        try{await this.telegram.answerCbQuery(q.id)}catch{}
        return renderCountries(this,q,cb.endsWith('5sim')?'5sim':'vak',1);
      }
      if(cb.startsWith('ns_countries_')){
        const p=cb.split('_');try{await this.telegram.answerCbQuery(q.id)}catch{};return renderCountries(this,q,p[2],Number(p[3])||1);
      }
      if(cb.startsWith('ns_country_')){
        const p=cb.split('_'),server=p[2],cid=dec(p[3]);try{await this.telegram.answerCbQuery(q.id)}catch{};return renderServices(this,q,server,cid,1);
      }
      if(cb.startsWith('ns_services_')){
        const p=cb.split('_'),server=p[2],cid=dec(p[3]);try{await this.telegram.answerCbQuery(q.id)}catch{};return renderServices(this,q,server,cid,Number(p[4])||1);
      }
      if(cb.startsWith('ns_buy_')){
        const p=cb.split('_');const server=p[2],country=dec(p[3]),service=dec(p[4]);
        try{await this.telegram.answerCbQuery(q.id)}catch{}
        return directBuy(this,q,server,country,service);
      }
    }
  }catch(e){console.log('NUMBER SERVER UI FIX:',e.message)}
  return previous.call(this,update,...args);
};
