const mongoose=require('mongoose');
const axios=require('axios');
const {Telegraf,Markup}=require('telegraf');

const VAK_KEY=process.env.VAKSMS_API_KEY||'';
const VAK_BASE='https://vak-sms.com/stubs/handler_api.php';
const OWNER_ID=5087094625;
const states=new Map();
const schema=new mongoose.Schema({server:{type:String,unique:true},countries:{type:Array,default:[]},services:{type:Array,default:[]},operators:{type:Array,default:[]},markup:{type:Number,default:0}},{collection:'number_server_configs'});
const Config=mongoose.models.VakCatalogUIConfig||mongoose.model('VakCatalogUIConfig',schema);
async function cfg(){return Config.findOneAndUpdate({server:'vak'},{server:'vak'},{upsert:true,new:true,setDefaultsOnInsert:true});}
async function admin(id){if(Number(id)===OWNER_ID)return true;try{return !!(await mongoose.models.Admin?.findOne({userId:String(id)}));}catch{return false;}}
function enc(x){return encodeURIComponent(String(x));} function dec(x){try{return decodeURIComponent(x)}catch{return String(x)}}
async function vak(action,params={}){try{return (await axios.get(VAK_BASE,{params:{action,api_key:VAK_KEY,...params},timeout:15000})).data}catch{return null}}
function countryName(v,id){return String(v?.name||v?.eng||v?.name_en||v?.rus||v?.title||id)}
function serviceId(v,k){return String(v?.id||v?.code||v?.service||k)}
function serviceName(v,k){return String(v?.name||v?.title||v?.serviceName||v?.eng||serviceId(v,k))}
async function refreshCatalog(){
  if(!VAK_KEY)throw Error('VAKSMS_API_KEY is not configured');
  const c=await cfg();
  const oldPrice=new Map(c.services.map(s=>[String(s.id),Number(s.price||0)]));
  let co=await vak('getCountries');
  let countries=[];
  if(Array.isArray(co)) countries=co;
  else if(co&&typeof co==='object') countries=Object.entries(co).map(([id,v])=>({id:String(v?.id??id),name:countryName(v,id),code:v?.iso2||v?.iso||v?.code||''}));
  let sv=await vak('getServicesList');
  if(!sv) sv=await vak('getServices');
  let services=[];
  if(Array.isArray(sv)) services=sv;
  else if(Array.isArray(sv?.services)) services=sv.services;
  else if(sv&&typeof sv==='object') services=Object.entries(sv).map(([id,v])=>({...((v&&typeof v==='object')?v:{}),id:v?.id||v?.code||id}));
  if(!services.length){
    const d=await vak('getPrices');const ids=new Map();
    const walk=(o,depth=0)=>{if(!o||typeof o!=='object'||depth>5)return;Object.entries(o).forEach(([k,v])=>{if(v&&typeof v==='object'){if(!countries.some(x=>String(x.id)===String(k))){if(v.cost!==undefined||v.price!==undefined||v.count!==undefined)ids.set(k,k);else if(!ids.has(k)&&k.length<40)walk(v,depth+1)}walk(v,depth+1)}})};walk(d);services=[...ids.entries()].map(([id,name])=>({id,name}));
  }
  if(countries.length)c.countries=countries.map(x=>({id:String(x.id),name:String(x.name||x.eng||x.name_en||x.rus||x.title||x.id),code:x.code||x.iso2||x.iso||''}));
  if(services.length)c.services=services.map((x,i)=>{const id=serviceId(x,i);return {id,name:serviceName(x,i),price:oldPrice.get(id)||0};});
  await c.save();
  return {countries:c.countries.length,services:c.services.length};
}
function filter(arr,q){const s=String(q||'').toLowerCase();return arr.filter(x=>String(x.name||'').toLowerCase().includes(s)||String(x.id||'').toLowerCase().includes(s)||String(x.code||'').toLowerCase().includes(s));}
async function liveInfo(country,service){const d=await vak('getPrices',{country,service});let block=d?.[country]?.[service]||d?.[service]?.[country];if(!block){let found=null;const walk=(o,dep=0)=>{if(found||!o||typeof o!=='object'||dep>6)return;if(o[country]?.[service]){found=o[country][service];return;}if(o[service]?.[country]){found=o[service][country];return;}Object.values(o).forEach(v=>{if(v&&typeof v==='object')walk(v,dep+1)});};walk(d);block=found;}let price=null,stock=0;const scan=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(scan);return;}for(const k of ['cost','price','rate','sell_price','buy_price']){const n=Number(v[k]);if(Number.isFinite(n)&&n>0)price=price==null?n:Math.min(price,n);}for(const k of ['count','stock','qty','quantity','available','available_count']){const n=Number(v[k]);if(Number.isFinite(n)&&n>=0)stock+=n;}Object.values(v).forEach(x=>{if(x&&typeof x==='object')scan(x)});};scan(block);return {price,stock};}
async function rate(){try{const d=await mongoose.connection.db.collection('settings').findOne({key:'usdtInrRate'});const n=Number(d?.value);return Number.isFinite(n)&&n>0?n:100}catch{return 100}}
async function countries(bot,q,page=1,query=''){
 const c=await cfg(),arr=filter(c.countries,query),total=Math.max(1,Math.ceil(arr.length/5));page=Math.min(Math.max(1,page),total);const items=arr.slice((page-1)*5,page*5);const rows=items.map(x=>[Markup.button.callback(`🌍 ${x.name}`,`vku_country_${enc(x.id)}`)]);const nav=[];if(page>1)nav.push(Markup.button.callback('⬅',`vku_countries_${page-1}${query?'_'+enc(query):''}`));if(page<total)nav.push(Markup.button.callback('➡',`vku_countries_${page+1}${query?'_'+enc(query):''}`));if(nav.length)rows.push(nav);rows.push([Markup.button.callback('🔎 Search Country','vku_search_country'),Markup.button.callback('🔎 Search Service','vku_search_service')]);rows.push([Markup.button.callback('⬅ Servers','ns_user_menu')]);let text=`🌍 Select Country\n\n${query?`🔎 ${query}\n\n`:''}Page ${page}/${total}`;return bot.telegram.editMessageText(q.message.chat.id,q.message.message_id,undefined,text,Markup.inlineKeyboard(rows));}
async function services(bot,q,countryId,page=1,query=''){
 const c=await cfg(),co=c.countries.find(x=>String(x.id)===String(countryId));if(!co)return;const arr=filter(c.services,query),total=Math.max(1,Math.ceil(arr.length/5));page=Math.min(Math.max(1,page),total);const r=await rate();const rows=[];for(const s of arr.slice((page-1)*5,page*5)){const info=await liveInfo(co.id,s.id);let sell=Number(s.price||0);if(sell<=0&&info.price!=null)sell=Math.ceil(info.price*r*(1+Number(c.markup||0)/100));const live=info.price!=null?` • Live: ₹${Math.ceil(info.price*r)}`:'';rows.push([Markup.button.callback(`📦 ${s.name} • ₹${sell||0}${live} • Stock: ${info.stock}`,`ns_buy_vak_${enc(co.id)}_${enc(s.id)}`)]);}const nav=[];if(page>1)nav.push(Markup.button.callback('⬅',`vku_services_${enc(co.id)}_${page-1}${query?'_'+enc(query):''}`));if(page<total)nav.push(Markup.button.callback('➡',`vku_services_${enc(co.id)}_${page+1}${query?'_'+enc(query):''}`));if(nav.length)rows.push(nav);rows.push([Markup.button.callback('🔎 Search Country','vku_search_country'),Markup.button.callback('🔎 Search Service',`vku_search_service_${enc(co.id)}`)]);rows.push([Markup.button.callback('⬅ Countries','vku_countries_1')]);return bot.telegram.editMessageText(q.message.chat.id,q.message.message_id,undefined,`📦 Select Service\n\n🌍 ${co.name}\n\n${query?`🔎 ${query}\n\n`:''}Page ${page}/${total}`,Markup.inlineKeyboard(rows));}
const previous=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){try{const q=update?.callback_query,uid=q?.from?.id,cb=q?.data||'';if(uid&&cb==='ns_user_vak'){try{await this.telegram.answerCbQuery(q.id)}catch{};return countries(this,q,1,'');}if(uid&&cb==='vku_refresh'){try{await refreshCatalog()}catch{};return countries(this,q,1,'');}if(uid&&cb==='vku_search_country'){states.set(String(uid),{type:'country'});try{await this.telegram.answerCbQuery(q.id)}catch{};return this.telegram.sendMessage(uid,'🔎 Search Country\n\nSend country name, ID or code:');}if(uid&&cb.startsWith('vku_search_service')){const p=cb.split('_');states.set(String(uid),{type:'service',country:p[3]?dec(p[3]):null});try{await this.telegram.answerCbQuery(q.id)}catch{};return this.telegram.sendMessage(uid,'🔎 Search Service\n\nSend service name or ID:');}let m=cb.match(/^vku_countries_(\d+)(?:_(.*))?$/);if(uid&&m){try{await this.telegram.answerCbQuery(q.id)}catch{};return countries(this,q,Number(m[1]),m[2]?dec(m[2]):'');}m=cb.match(/^vku_country_(.*)$/);if(uid&&m){try{await this.telegram.answerCbQuery(q.id)}catch{};return services(this,q,dec(m[1]),1,'');}m=cb.match(/^vku_services_(.*)_(\d+)(?:_(.*))?$/);if(uid&&m){try{await this.telegram.answerCbQuery(q.id)}catch{};return services(this,q,dec(m[1]),Number(m[2]),m[3]?dec(m[3]):'');}if(uid&&update.message?.chat?.type==='private'&&update.message.text&&!update.message.text.startsWith('/')&&states.has(String(uid))){const st=states.get(String(uid));states.delete(String(uid));const c=await cfg();const qx=update.message.text.trim();if(st.type==='country'){return countries(this,{message:{chat:{id:uid},message_id:undefined}},1,qx);}if(st.type==='service'&&st.country){return services(this,{message:{chat:{id:uid},message_id:undefined}},st.country,1,qx);}}
}catch(e){console.log('VAK CATALOG UI:',e.message)}return previous.call(this,update,...args);};

const oldImport=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){try{const q=update?.callback_query,uid=q?.from?.id,cb=q?.data||'';if(uid&&await admin(uid)&&cb==='nsi_import_vak'){try{await this.telegram.answerCbQuery(q.id,'⏳ Syncing...')}catch{};const r=await refreshCatalog();return this.telegram.sendMessage(uid,`✅ VAK-SMS Import/Sync completed\n\n🌍 Countries: ${r.countries}\n📦 Services: ${r.services}`);}}catch(e){if(update?.callback_query?.from?.id) return this.telegram.sendMessage(update.callback_query.from.id,'❌ '+e.message)}return oldImport.call(this,update,...args);};
