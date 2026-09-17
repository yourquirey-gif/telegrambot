const mongoose=require('mongoose');
const axios=require('axios');
const {Telegraf,Markup}=require('telegraf');
const FIVE='https://5sim.net/v1', VAK='https://vak-sms.com/stubs/handler_api.php';
const FIVE_KEY=process.env.FIVESIM_API_KEY||process.env.FIVE_SIM_API_KEY||process.env['5SIM_API_KEY']||'';
const VAK_KEY=process.env.VAKSMS_API_KEY||'';
const enc=x=>encodeURIComponent(String(x));
async function cfg(server){return mongoose.connection.db.collection('number_server_configs').findOne({server});}
async function rate(){try{const d=await mongoose.connection.db.collection('settings').findOne({key:'usdtInrRate'});const n=Number(d?.value);return n>0?n:100}catch{return 100}}
function sell(base,c){const p=Number(base||0),m=Number(c?.markup??c?.profitPercent??c?.profit_percentage??0);return Math.ceil(p*(1+(Number.isFinite(m)&&m>0?m:0)/100));}
async function fivePrice(country,service,operator){const r=await axios.get(`${FIVE}/guest/prices`,{params:{country,product:service},timeout:15000});const b=r.data?.[country]?.[service];if(!b)return null;const v=operator&&operator!=='any'&&b[operator]?b[operator]:Object.values(b).sort((a,z)=>Number(a?.cost)-Number(z?.cost))[0];return Number(v?.cost)||null}
async function vakPrice(country,service){const r=await axios.get(VAK,{params:{action:'getPrices',api_key:VAK_KEY,country,service},timeout:15000});const vals=[];const walk=o=>{if(!o||typeof o!=='object')return;if(Array.isArray(o)){o.forEach(walk);return}for(const k of ['cost','price','rate','sell_price','buy_price']){const n=Number(o[k]);if(n>0)vals.push(n)}Object.values(o).forEach(walk)};walk(r.data);return vals.length?Math.min(...vals):null}
async function buy(update,bot,server,country,service){
  const uid=String(update.callback_query.from.id),User=mongoose.models.User,user=await User?.findOne({userId:uid});
  if(!user)return bot.telegram.sendMessage(uid,'❌ User not found.');
  if(user.banned)return bot.telegram.sendMessage(uid,'❌ You are banned.');
  if(user.activeOrder)return bot.telegram.sendMessage(uid,'⚠️ You already have an active order.\n\nPlease complete or cancel it first.');
  const c=await cfg(server);if(!c)return bot.telegram.sendMessage(uid,'❌ Server configuration not found.');
  const co=(c.countries||[]).find(x=>String(x.id)===String(country));const se=(c.services||[]).find(x=>String(x.id)===String(service));
  if(!co||!se)return bot.telegram.sendMessage(uid,'❌ Country/service configuration missing.');
  const rr=await rate();let operator='any',base=Number(se.price||0);
  if(server==='5sim'){
    const op=(c.operators||[]).find(x=>String(x.country)===String(country)&&String(x.service).toLowerCase()===String(service).toLowerCase());operator=op?.operator||'any';
    if(base<=0){const usd=await fivePrice(country,service,operator);if(usd==null)return bot.telegram.sendMessage(uid,'❌ Live provider price unavailable.');base=usd*rr;}
    const price=sell(base,c);if(Number(user.credits||0)<price)return bot.telegram.answerCbQuery(update.callback_query.id,`❌ Not enough balance\n\nRequired: ${price}\nBalance: ${Number(user.credits||0)}`,{show_alert:true});
    try{await bot.telegram.answerCbQuery(update.callback_query.id,'📡 Searching Number...')}catch{}
    let order;try{if(!FIVE_KEY)throw Error('5SIM API key is not configured');order=(await axios.get(`${FIVE}/user/buy/activation/${enc(country)}/${enc(operator)}/${enc(service)}`,{headers:{Authorization:`Bearer ${FIVE_KEY}`,Accept:'application/json'},timeout:15000})).data}catch(e){return bot.telegram.sendMessage(uid,`❌ Server 3 ERROR\n\n${e.response?.data?.message||e.response?.data?.error||e.message}`)}
    if(!order?.id||!order?.phone)return bot.telegram.sendMessage(uid,'❌ Server 3 did not return a number.');
    user.credits=Number(user.credits||0)-price;user.activeOrder=true;user.activeOrderId='5s:'+order.id;await user.save();
    return bot.telegram.sendMessage(uid,`╔══════════════════════╗\n 📱 NUMBER ALLOCATED\n╚══════════════════════╝\n\n🖥 Server : Server 3\n🌍 Country : ${co.name}\n✅ Service : ${service.toUpperCase()}\n📡 Operator : ${order.operator||operator}\n📱 Number : <code>${order.phone}</code>\n🆔 Order ID : <code>${order.id}</code>\n\n💰 Price : ${price} credits\n📈 Profit : ${Number(c.markup||0)}%`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel',`ns_cancel_5s_${order.id}_${price}`)],[Markup.button.callback('🔄 Check OTP',`ns_otp_5s_${order.id}_${service}_${price}`)],[Markup.button.callback('🏠 Home','home')]])});
  }
  if(base<=0){const usd=await vakPrice(country,service);if(usd==null)return bot.telegram.sendMessage(uid,'❌ Live provider price unavailable.');base=usd*rr;}
  const price=sell(base,c);if(Number(user.credits||0)<price)return bot.telegram.answerCbQuery(update.callback_query.id,`❌ Not enough balance\n\nRequired: ${price}\nBalance: ${Number(user.credits||0)}`,{show_alert:true});
  try{await bot.telegram.answerCbQuery(update.callback_query.id,'📡 Searching Number...')}catch{}
  let response;try{response=(await axios.get(VAK,{params:{action:'getNumber',api_key:VAK_KEY,service,country},timeout:15000})).data}catch(e){return bot.telegram.sendMessage(uid,`❌ Server 2 ERROR\n\n${e.response?.data||e.message}`)}
  if(typeof response==='string'&&response.startsWith('ACCESS_NUMBER:')){const parts=response.split(':'),id=parts[1],phone=parts.slice(2).join(':');user.credits=Number(user.credits||0)-price;user.activeOrder=true;user.activeOrderId='vk:'+id;await user.save();return bot.telegram.sendMessage(uid,`╔══════════════════════╗\n 📱 NUMBER ALLOCATED\n╚══════════════════════╝\n\n🖥 Server : Server 2\n🌍 Country : ${co.name}\n✅ Service : ${service.toUpperCase()}\n📱 Number : <code>+${phone.replace(/^\+/,'')}</code>\n🆔 Order ID : <code>${id}</code>\n\n💰 Price : ${price} credits\n📈 Profit : ${Number(c.markup||0)}%`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel',`ns_cancel_vk_${id}_${price}`)],[Markup.button.callback('🔄 Check OTP',`ns_otp_vk_${id}_${service}_${price}`)],[Markup.button.callback('🏠 Home','home')]])})}
  return bot.telegram.sendMessage(uid,'❌ Server 2 did not return a number.');
}
const previous=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){try{const cb=update?.callback_query?.data||'',m=cb.match(/^ns_buy_(5sim|vak)_(.+?)_(.+)$/);if(m)return buy(update,this,m[1],decodeURIComponent(m[2]),decodeURIComponent(m[3]));}catch(e){console.log('PROFIT PERCENT FINAL:',e.message)}return previous.call(this,update,...args)};
