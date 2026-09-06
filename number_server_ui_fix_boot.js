const mongoose = require('mongoose');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');

const FIVE_BASE='https://5sim.net/v1';
const FIVE_TOKEN=process.env.FIVESIM_API_KEY||process.env.FIVE_SIM_API_KEY||process.env['5SIM_API_KEY']||'';
const VAK_KEY=process.env.VAKSMS_API_KEY||'';
const VAK_BASE='https://vak-sms.com/stubs/handler_api.php';
const cfgSchema=new mongoose.Schema({server:{type:String,unique:true},countries:{type:Array,default:[]},services:{type:Array,default:[]},operators:{type:Array,default:[]},markup:{type:Number,default:0}},{collection:'number_server_configs'});
const Config=mongoose.models.NumberServerUiFixConfig||mongoose.model('NumberServerUiFixConfig',cfgSchema);

async function cfg(server){return Config.findOneAndUpdate({server},{server},{upsert:true,new:true,setDefaultsOnInsert:true});}
function enc(x){return encodeURIComponent(String(x));}
function dec(x){try{return decodeURIComponent(x)}catch{return String(x)}}
function page(a,p=1,n=5){return a.slice((p-1)*n,p*n)}
async function fiveGuest(path){try{return (await axios.get(FIVE_BASE+path,{timeout:12000,headers:{Accept:'application/json'}})).data}catch{return null}}
async function vak(action,params={}){try{return (await axios.get(VAK_BASE,{params:{action,api_key:VAK_KEY,...params},timeout:12000})).data}catch{return null}}

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
      const base=await fivePrice(country.id,s.id,op?.operator||'any'); if(base!=null)price=Math.ceil(base*(1+Number(c.markup||0)/100));
    }else stock=await vakStock(country.id,s.id);
    rows.push([Markup.button.callback(`📦 ${s.name} • ₹${price} • Stock: ${stock}`,`ns_buy_${server}_${enc(country.id)}_${enc(s.id)}`)]);
  }
  const nav=[];if(p>1)nav.push(Markup.button.callback('⬅',`ns_services_${server}_${enc(country.id)}_${p-1}`));if(p<total)nav.push(Markup.button.callback('➡',`ns_services_${server}_${enc(country.id)}_${p+1}`));if(nav.length)rows.push(nav);
  rows.push([Markup.button.callback('⬅ Countries',`ns_countries_${server}_1`)]);
  return bot.telegram.editMessageText(q.message.chat.id,q.message.message_id,undefined,`📦 Select Service\n\n🌍 ${country.name}\n\nPage ${p}/${total}`,Markup.inlineKeyboard(rows));
}

const previous=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){
  try{
    const q=update?.callback_query, cb=q?.data||'', uid=q?.from?.id;
    if(q&&uid){
      // Navigation is edited in-place so every click does not create another message.
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
        const User=mongoose.models.User;const user=await User?.findOne({userId:String(uid)});if(user)await clearFinishedOrder(user);
      }
    }
  }catch(e){console.log('NUMBER SERVER UI FIX:',e.message)}
  return previous.call(this,update,...args);
};
