const mongoose=require('mongoose');
const axios=require('axios');
const {Telegraf,Markup,Telegram}=require('telegraf');
const OWNER_ID=5087094625;
const FIVE_BASE='https://5sim.net/v1';
const FIVE_TOKEN=process.env.FIVESIM_API_KEY||process.env.FIVE_SIM_API_KEY||process.env['5SIM_API_KEY']||'';
const VAK_KEY=process.env.VAKSMS_API_KEY||'';
const VAK_BASE='https://vak-sms.com/stubs/handler_api.php';
const DEFAULT_USDT_INR=100;
const states=new Map();
const schema=new mongoose.Schema({server:{type:String,unique:true},countries:{type:Array,default:[]},services:{type:Array,default:[]},operators:{type:Array,default:[]},markup:{type:Number,default:0}},{collection:'number_server_configs'});
const Config=mongoose.models.NumberServerImportConfig||mongoose.model('NumberServerImportConfig',schema);
async function cfg(server){return Config.findOneAndUpdate({server},{server},{upsert:true,new:true,setDefaultsOnInsert:true});}
async function admin(id){if(Number(id)===OWNER_ID)return true;try{return !!(await mongoose.models.Admin?.findOne({userId:String(id)}));}catch{return false;}}
function enc(x){return encodeURIComponent(String(x));} function dec(x){try{return decodeURIComponent(x)}catch{return String(x)}}
async function fiveGuest(path){try{return (await axios.get(FIVE_BASE+path,{timeout:20000,headers:{Accept:'application/json'}})).data}catch{return null}}
async function vak(action,params={}){try{return (await axios.get(VAK_BASE,{params:{action,api_key:VAK_KEY,...params},timeout:20000,headers:{Accept:'application/json'}})).data}catch{return null}}
async function rate(){try{const d=await mongoose.connection.db.collection('settings').findOne({key:'usdtInrRate'});const n=Number(d?.value);return Number.isFinite(n)&&n>0?n:DEFAULT_USDT_INR}catch{return DEFAULT_USDT_INR}}
function providerPrice(block){if(!block)return null;const out=[];const walk=(v,d=0)=>{if(!v||d>5)return;if(Array.isArray(v)){v.forEach(x=>walk(x,d+1));return}if(typeof v==='object'){for(const k of ['cost','price','rate','sell_price','buy_price']){const n=Number(v[k]);if(Number.isFinite(n)&&n>0)out.push(n)}Object.values(v).forEach(x=>{if(x&&typeof x==='object')walk(x,d+1)})}};walk(block);return out.length?Math.min(...out):null}
function findBlock(data,country,service){if(!data||typeof data!=='object')return null;if(data[country]?.[service])return data[country][service];if(data[service]?.[country])return data[service][country];let found=null;const walk=(o,d=0)=>{if(found||!o||typeof o!=='object'||d>6)return;if(o[country]?.[service]){found=o[country][service];return}if(o[service]?.[country]){found=o[service][country];return}Object.values(o).forEach(x=>{if(x&&typeof x==='object')walk(x,d+1)})};walk(data);return found}
function pretty5Name(id){const s=String(id||'').trim();if(!s)return '';const known={tg:'Telegram',wa:'WhatsApp',go:'Google',ig:'Instagram',fb:'Facebook',tw:'Twitter',vk:'VKontakte',vi:'Viber',wb:'WeChat',ds:'Discord',am:'Amazon',av:'Avito',ok:'Odnoklassniki',ub:'Uber',oi:'OpenAI',nf:'Netflix'};if(known[s.toLowerCase()])return known[s.toLowerCase()];return s.replace(/[_-]+/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
function normalizeCountry(id,v){const x=v&&typeof v==='object'?v:{};return {id:String(x.id??id),name:String(x.name||x.text_en||x.eng||x.title||x.rus||id),code:String(x.iso||x.iso2||x.code||'')};}
function normalizeService(id,v,server){const x=v&&typeof v==='object'?v:{};const code=String(x.id??x.code??x.service??id);return {id:code,name:String(x.name||x.title||x.text_en||x.eng||x.rus||(server==='5sim'?pretty5Name(code):code)),price:0};}
async function fiveInfo(country,service,operator){const d=await fiveGuest(`/guest/prices?country=${enc(country)}&product=${enc(service)}`);const b=d?.[country]?.[service];if(!b)return {stock:0,price:null};const vals=operator&&operator!=='any'&&b[operator]?[b[operator]]:Object.values(b);return {stock:vals.reduce((n,v)=>n+(Number(v?.count)||0),0),price:operator&&operator!=='any'&&b[operator]?Number(b[operator].cost):Math.min(...vals.map(v=>Number(v?.cost)).filter(Number.isFinite))};}
async function vakInfo(country,service){const d=await vak('getPrices',{country,service});const b=findBlock(d,country,service);let stock=0;if(b&&typeof b==='object'){const walk=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(walk);return}if('count' in v)stock+=Number(v.count)||0;Object.values(v).forEach(x=>{if(x&&typeof x==='object')walk(x)})};walk(b)}return {stock,price:providerPrice(b)};}
function calcPrice(s,info,r,markup){const manual=Number(s.price||0);if(manual>0)return Math.ceil(manual);if(info.price==null)return 0;return Math.ceil(info.price*r*(1+Number(markup||0)/100));}
async function render(bot,q,server,countryId,page=1){const c=await cfg(server),co=c.countries.find(x=>String(x.id)===String(countryId));if(!co)return;const arr=c.services.slice((page-1)*5,page*5),total=Math.max(1,Math.ceil(c.services.length/5)),r=await rate(),rows=[];for(const s of arr){let info=server==='5sim'?await fiveInfo(co.id,s.id,c.operators.find(o=>String(o.country)===String(co.id)&&String(o.service).toLowerCase()===String(s.id).toLowerCase())?.operator||'any'):await vakInfo(co.id,s.id);let p=calcPrice(s,info,r,c.markup);rows.push([Markup.button.callback(`📦 ${s.name} • ₹${p} • Stock: ${info.stock}`,`ns_buy_${server}_${enc(co.id)}_${enc(s.id)}`)])}const nav=[];if(page>1)nav.push(Markup.button.callback('⬅',`nsi_s_${server}_${enc(co.id)}_${page-1}`));if(page<total)nav.push(Markup.button.callback('➡',`nsi_s_${server}_${enc(co.id)}_${page+1}`));if(nav.length)rows.push(nav);rows.push([Markup.button.callback('⬅ Countries',`nsi_c_${server}_1`)]);return bot.telegram.editMessageText(q.message.chat.id,q.message.message_id,undefined,`📦 Select Service\n\n🌍 ${co.name}\n\nPage ${page}/${total}`,Markup.inlineKeyboard(rows));}
async function renderCountries(bot,q,server,page=1){const c=await cfg(server),arr=c.countries.slice((page-1)*5,page*5),total=Math.max(1,Math.ceil(c.countries.length/5));const rows=arr.map(x=>[Markup.button.callback(`🌍 ${x.name} • ${x.id}`,`nsi_country_${server}_${enc(x.id)}`)]);const nav=[];if(page>1)nav.push(Markup.button.callback('⬅',`nsi_c_${server}_${page-1}`));if(page<total)nav.push(Markup.button.callback('➡',`nsi_c_${server}_${page+1}`));nav.length&&rows.push(nav);rows.push([Markup.button.callback('⬅ Servers','ns_user_menu')]);return bot.telegram.editMessageText(q.message.chat.id,q.message.message_id,undefined,`🌍 Select Country\n\nPage ${page}/${total}`,Markup.inlineKeyboard(rows));}

async function importFive(){
  // Import/sync Server 3 from the bulk 5SIM guest endpoints. The old code made
  // 2 HTTP requests for EVERY country, so a full sync could take many minutes,
  // hit rate limits, and look like the button was broken.
  // 5SIM does not require the private buy token for these guest catalog calls.
  const c=await cfg('5sim');
  const oldPrice=new Map(c.services.map(s=>[String(s.id),Number(s.price||0)]));

  const d=await fiveGuest('/guest/countries');
  let countries=[];
  if(d&&typeof d==='object') countries=Object.entries(d).map(([id,v])=>normalizeCountry(id,v));
  if(!countries.length) throw Error('5SIM countries could not be loaded');

  // One bulk price call gives country -> service -> operator data.
  let prices=await fiveGuest('/guest/prices');
  const services=new Map();
  if(prices&&typeof prices==='object'){
    for(const countryBlock of Object.values(prices)){
      if(!countryBlock||typeof countryBlock!=='object') continue;
      for(const [id,v] of Object.entries(countryBlock)){
        if(!services.has(id)) services.set(id,{id,name:pretty5Name(id),price:oldPrice.get(String(id))||0});
      }
    }
  }

  // Fallback only if the bulk endpoint is unavailable. Limit concurrency so a
  // temporary 5SIM API issue cannot create hundreds of simultaneous requests.
  if(!services.size){
    const queue=[...countries];
    const worker=async()=>{
      while(queue.length){
        const co=queue.shift();
        const p=await fiveGuest(`/guest/products/${enc(co.id)}/any`);
        if(p&&typeof p==='object') Object.keys(p).forEach(id=>{
          if(!services.has(id)) services.set(id,{id,name:pretty5Name(id),price:oldPrice.get(String(id))||0});
        });
      }
    };
    await Promise.all(Array.from({length:Math.min(6,countries.length)},worker));
  }

  if(!services.size) throw Error('5SIM services could not be loaded');
  c.countries=countries;
  c.services=[...services.values()];
  c.services.forEach(s=>{if(oldPrice.has(String(s.id)))s.price=oldPrice.get(String(s.id));});
  await c.save();
  return {countries:c.countries.length,services:c.services.length};
}

async function importVak(){if(!VAK_KEY)throw Error('VAKSMS_API_KEY is not configured');const c=await cfg('vak');const oldPrice=new Map(c.services.map(s=>[String(s.id),Number(s.price||0)]));let co=await vak('getCountries');let countries=[];if(Array.isArray(co))countries=co.map((v,i)=>normalizeCountry(v?.id??i,v));else if(co&&typeof co==='object')countries=Object.entries(co).map(([id,v])=>normalizeCountry(id,v));if(!countries.length){const d=await vak('getPrices');if(d&&typeof d==='object')countries=Object.keys(d).map(id=>normalizeCountry(id,{id,name:id}));}if(!countries.length)throw Error('VAK-SMS countries could not be loaded');let sv=await vak('getServices');let services=[];if(Array.isArray(sv))services=sv.map((v,i)=>normalizeService(v?.id??v?.code??i,v,'vak'));else if(sv?.services&&Array.isArray(sv.services))services=sv.services.map(v=>normalizeService(v?.id??v?.code,v,'vak'));else if(sv&&typeof sv==='object')services=Object.entries(sv).map(([id,v])=>normalizeService(id,v,'vak'));if(!services.length){const d=await vak('getPrices');const ids=new Set();const walk=o=>{if(!o||typeof o!=='object')return;Object.entries(o).forEach(([k,v])=>{if(v&&typeof v==='object'){ids.add(k);walk(v)}})};walk(d);services=[...ids].filter(id=>!countries.some(x=>String(x.id)===String(id))).map(id=>normalizeService(id,{id},'vak'));}c.countries=c.countries||[];c.countries=countries.map(v=>normalizeCountry(v.id,v));c.services=services.map(v=>{const x=normalizeService(v.id,v,'vak');x.price=oldPrice.get(String(x.id))||0;return x;});await c.save();return {countries:c.countries.length,services:c.services.length};}
async function sync(server,bot,uid){const r=server==='5sim'?await importFive():await importVak();await bot.telegram.sendMessage(uid,`✅ Import/Sync completed\n\n🌍 Countries: ${r.countries}\n📦 Services: ${r.services}`);}
function adminMenu(server){return Markup.inlineKeyboard([[Markup.button.callback('📥 Import / Sync','nsi_import_'+server)],[Markup.button.callback('🗑 Remove All','nsi_remove_'+server)],[Markup.button.callback('💰 Set Price','nsi_price_'+server)],[Markup.button.callback('📈 Set Profit %','nsi_profit_'+server)],[Markup.button.callback('📋 View Settings',`nsi_view_${server}`)],[Markup.button.callback('🔎 Search Countries',`nss_${server}_countries`)],[Markup.button.callback('🔎 Search Services',`nss_${server}_services`)],[Markup.button.callback('⬅ Number Servers','admin_servers')]])}
const previous=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){try{const q=update?.callback_query,cb=q?.data||'',uid=q?.from?.id;if(uid&&await admin(uid)){if(cb==='ns_5sim'||cb==='ns_vak'){try{await this.telegram.answerCbQuery(q.id)}catch{};return this.telegram.sendMessage(uid,`⚙️ ${cb==='ns_5sim'?'5SIM':'VAK-SMS'} SETTINGS`,adminMenu(cb==='ns_5sim'?'5sim':'vak'));}if(cb.startsWith('nsi_import_')){const s=cb.slice(11);try{await this.telegram.answerCbQuery(q.id,'⏳ Importing...')}catch{};try{return await sync(s,this,uid)}catch(e){return this.telegram.sendMessage(uid,'❌ '+e.message)}}if(cb.startsWith('nsi_remove_')){const s=cb.slice(11),c=await cfg(s);c.countries=[];c.services=[];c.operators=[];await c.save();try{await this.telegram.answerCbQuery(q.id)}catch{};return this.telegram.sendMessage(uid,'✅ All imported countries & services removed.')}if(cb.startsWith('nsi_price_')||cb.startsWith('nsi_profit_')){const s=cb.split('_').pop(),type=cb.startsWith('nsi_price_')?'price':'profit';states.set(String(uid),{server:s,type});try{await this.telegram.answerCbQuery(q.id)}catch{};return this.telegram.sendMessage(uid,type==='price'?'💰 Send default service price in ₹. Example: 50':'📈 Send default profit percentage. Example: 20')}if(update.message?.chat?.type==='private'&&update.message?.text&&!update.message.text.startsWith('/')&&states.has(String(uid))){const st=states.get(String(uid));states.delete(String(uid));const c=await cfg(st.server);const n=Number(update.message.text.trim());if(!Number.isFinite(n)||n<0)return this.telegram.sendMessage(uid,'❌ Invalid number');if(st.type==='price')c.services.forEach(x=>x.price=n);else c.markup=n;await c.save();return this.telegram.sendMessage(uid,`✅ ${st.type==='price'?'Price':'Profit %'} saved: ${n}${st.type==='profit'?'%':'₹'}`);}if(q&&uid){if(cb.startsWith('nsi_country_')){try{await this.telegram.answerCbQuery(q.id)}catch{};const p=cb.split('_');return render(this,q,p[2],dec(p[3]),1)}if(cb.startsWith('nsi_c_')){const p=cb.split('_');try{await this.telegram.answerCbQuery(q.id)}catch{};return renderCountries(this,q,p[2],Number(p[3])||1)}if(cb.startsWith('nsi_s_')){const p=cb.split('_');try{await this.telegram.answerCbQuery(q.id)}catch{};return render(this,q,p[2],dec(p[3]),Number(p[4])||1)}}} }catch(e){console.log('IMPORT PRICING BOOT:',e.message)}return previous.call(this,update,...args)};
