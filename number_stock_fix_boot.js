const mongoose = require('mongoose');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');

const FIVE_BASE='https://5sim.net/v1';
const FIVE_TOKEN=process.env.FIVESIM_API_KEY||process.env.FIVE_SIM_API_KEY||process.env['5SIM_API_KEY']||'';
const VAK_KEY=process.env.VAKSMS_API_KEY||'';
const VAK_BASE='https://vak-sms.com/stubs/handler_api.php';
const DEFAULT_USDT_INR=100;

const cfgSchema=new mongoose.Schema({server:{type:String,unique:true},countries:{type:Array,default:[]},services:{type:Array,default:[]},operators:{type:Array,default:[]},markup:{type:Number,default:0}},{collection:'number_server_configs'});
const Config=mongoose.models.NumberServerStockFixConfig||mongoose.model('NumberServerStockFixConfig',cfgSchema);

async function cfg(server){return Config.findOneAndUpdate({server},{server},{upsert:true,new:true,setDefaultsOnInsert:true});}
function enc(x){return encodeURIComponent(String(x));}
function page(a,p=1,n=5){return a.slice((p-1)*n,p*n)}
async function fiveGuest(path){try{return (await axios.get(FIVE_BASE+path,{timeout:12000,headers:{Accept:'application/json'}})).data}catch{return null}}
async function vak(action,params={}){try{return (await axios.get(VAK_BASE,{params:{action,api_key:VAK_KEY,...params},timeout:12000})).data}catch{return null}}

function findUsdtRate(){return mongoose.connection?.db?.collection('settings').findOne({key:'usdtInrRate'}).then(d=>{const n=Number(d?.value);return Number.isFinite(n)&&n>0?n:DEFAULT_USDT_INR}).catch(()=>DEFAULT_USDT_INR)}

function recursiveCount(value,depth=0){
  if(value==null||depth>6)return 0;
  if(Array.isArray(value))return value.reduce((n,x)=>n+recursiveCount(x,depth+1),0);
  if(typeof value!=='object')return 0;
  let total=0;
  for(const k of ['count','stock','qty','quantity','available','available_count']){
    const n=Number(value[k]); if(Number.isFinite(n)&&n>=0) total+=n;
  }
  for(const [k,v] of Object.entries(value)){
    if(['count','stock','qty','quantity','available','available_count'].includes(k))continue;
    if(v&&typeof v==='object')total+=recursiveCount(v,depth+1);
  }
  return total;
}

async function fiveData(country,service){return fiveGuest(`/guest/prices?country=${enc(country)}&product=${enc(service)}`)}
async function fiveStock(country,service,operator){
  const data=await fiveData(country,service);const block=data?.[country]?.[service];if(!block)return 0;
  if(operator&&operator!=='any'&&block[operator])return recursiveCount(block[operator]);
  return recursiveCount(block);
}
async function vakData(country,service){return vak('getPrices',{country,service})}
function findBlock(data,country,service){
  if(!data||typeof data!=='object')return null;
  if(data?.[country]?.[service])return data[country][service];
  if(data?.[service]?.[country])return data[service][country];
  let found=null;
  const walk=(o,d=0)=>{
    if(found||!o||typeof o!=='object'||d>7)return;
    if(o[country]&&typeof o[country]==='object'&&o[country][service]){found=o[country][service];return;}
    if(o[service]&&typeof o[service]==='object'&&o[service][country]){found=o[service][country];return;}
    for(const v of Object.values(o))if(v&&typeof v==='object')walk(v,d+1);
  };
  walk(data);return found;
}
async function vakStock(country,service){const data=await vakData(country,service);const block=findBlock(data,country,service);return block?recursiveCount(block):0;}

async function priceFor(server,country,s,c){
  let price=Number(s.price||0);
  if(price>0)return Math.ceil(price);
  const rate=await findUsdtRate();
  if(server==='5sim'){
    const op=c.operators.find(o=>String(o.country)===String(country.id)&&String(o.service).toLowerCase()===String(s.id).toLowerCase());
    const data=await fiveData(country.id,s.id);const block=data?.[country.id]?.[s.id];if(!block)return 0;
    const vals=op?.operator&&op.operator!=='any'&&block[op.operator]?[block[op.operator]]:Object.values(block);
    const nums=vals.map(v=>Number(v?.cost)).filter(Number.isFinite);if(!nums.length)return 0;
    return Math.ceil(Math.min(...nums)*rate*(1+Number(c.markup||0)/100));
  }
  const data=await vakData(country.id,s.id);const block=findBlock(data,country.id,s.id);if(!block)return 0;
  const vals=[];const scan=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(scan);return}for(const k of ['cost','price','rate','sell_price','buy_price']){const n=Number(v[k]);if(Number.isFinite(n)&&n>0)vals.push(n)}Object.values(v).forEach(x=>{if(x&&typeof x==='object')scan(x)})};scan(block);
  return vals.length?Math.ceil(Math.min(...vals)*rate):0;
}

async function renderServices(bot,q,server,countryId,p=1){
  const c=await cfg(server),country=c.countries.find(x=>String(x.id)===String(countryId));if(!country)return;
  const arr=page(c.services,p),total=Math.max(1,Math.ceil(c.services.length/5)),rows=[];
  for(const s of arr){
    let stock=server==='5sim'?await fiveStock(country.id,s.id,(c.operators.find(o=>String(o.country)===String(country.id)&&String(o.service).toLowerCase()===String(s.id).toLowerCase())||{}).operator||'any'):await vakStock(country.id,s.id);
    const price=await priceFor(server,country,s,c);
    rows.push([Markup.button.callback(`📦 ${s.name} • ₹${price} • Stock: ${stock}`,`ns_buy_${server}_${enc(country.id)}_${enc(s.id)}`)]);
  }
  const nav=[];if(p>1)nav.push(Markup.button.callback('⬅',`ns_services_${server}_${enc(country.id)}_${p-1}`));if(p<total)nav.push(Markup.button.callback('➡',`ns_services_${server}_${enc(country.id)}_${p+1}`));if(nav.length)rows.push(nav);
  rows.push([Markup.button.callback('⬅ Countries',`ns_countries_${server}_1`)]);
  return bot.telegram.editMessageText(q.message.chat.id,q.message.message_id,undefined,`📦 Select Service\n\n🌍 ${country.name}\n\nPage ${p}/${total}`,Markup.inlineKeyboard(rows));
}

const previous=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){
  try{
    const q=update?.callback_query,cb=q?.data||'';
    if(q&&q.from?.id){
      if(cb.startsWith('ns_country_')){const p=cb.split('_');try{await this.telegram.answerCbQuery(q.id)}catch{};return renderServices(this,q,p[2],decodeURIComponent(p[3]),1)}
      if(cb.startsWith('ns_services_')){const p=cb.split('_');try{await this.telegram.answerCbQuery(q.id)}catch{};return renderServices(this,q,p[2],decodeURIComponent(p[3]),Number(p[4])||1)}
    }
  }catch(e){console.log('NUMBER STOCK FIX:',e.message)}
  return previous.call(this,update,...args);
};
