const mongoose=require('mongoose');
const axios=require('axios');
const {Telegraf}=require('telegraf');
const OWNER_ID=5087094625;
const BASE='https://api.temporasms.com/stubs/handler_api.php';
const KEY=process.env.TEMPORASMS_API_KEY||process.env.TEMPO_API_KEY||process.env.TEMPO_SMS_API_KEY||'';
const schema=new mongoose.Schema({server:{type:String,unique:true},countries:{type:Array,default:[]},services:{type:Array,default:[]},operators:{type:Array,default:[]},markup:{type:Number,default:0}},{collection:'number_server_configs'});
const Config=mongoose.models.TempoImportSyncConfig||mongoose.models.NumberServerConfig||mongoose.model('TempoImportSyncConfig',schema);
async function cfg(){return Config.findOneAndUpdate({server:'tempo'},{server:'tempo'},{upsert:true,new:true,setDefaultsOnInsert:true});}
async function api(action,params={}){if(!KEY)throw Error('TEMPORASMS_API_KEY is not configured');return (await axios.get(BASE,{params:{api_key:KEY,action,...params},timeout:30000,headers:{Accept:'application/json'}})).data;}
function arr(d){if(Array.isArray(d))return d;if(d&&Array.isArray(d.data))return d.data;if(d&&Array.isArray(d.result))return d.result;if(d&&Array.isArray(d.services))return d.services;if(d&&Array.isArray(d.countries))return d.countries;if(d&&typeof d==='object')return Object.entries(d).filter(([k])=>!['status','error','message','code','balance'].includes(k.toLowerCase())).map(([id,v])=>({id,name:typeof v==='string'?v:(v?.name||v?.title||v?.eng||v?.text||v?.name_en||v?.rus||id),code:v?.code||v?.iso2||id}));return[];}
async function operators(){try{const d=await api('getOperators');const a=arr(d).map((v,i)=>String(v?.id??v?.code??v?.operator??v?.value??v??i)).filter(Boolean);return [...new Set(['1',...a])];}catch{return ['1'];}}
function country(v,i){return{id:String(v?.id??v?.code??v?.iso2??i),name:String(v?.name||v?.name_en||v?.eng||v?.title||v?.text||v?.rus||v?.id||v?.code||i),code:String(v?.iso2||v?.iso||v?.code||v?.id||i)}}
function service(v,i){return{id:String(v?.code??v?.id??v?.service??i),name:String(v?.name||v?.title||v?.eng||v?.text||v?.name_en||v?.id||v?.code||i)}}
async function syncTempo(){const c=await cfg(),old=new Map((c.services||[]).map(x=>[String(x.id),Number(x.price||0)])),ops=await operators();let countries=[];let services=[];let err='';
for(const op of ops){try{const a=arr(await api('getCountries',{operator:op})).map(country).filter(x=>x.name&&x.name!=='undefined');if(a.length){countries=a;break;}}catch(e){err=e.response?.data?.message||e.message;}}
if(!countries.length)throw Error('TemporaSMS countries could not be loaded'+(err?' ('+err+')':''));
for(const op of ops){try{const a=arr(await api('getServices',{operator:op})).map(service).filter(x=>x.name&&x.name!=='undefined');if(a.length){const m=new Map();for(const x of a)if(!m.has(x.id))m.set(x.id,x);services=[...m.values()];break;}}catch(e){err=e.response?.data?.message||e.message;}}
if(!services.length)throw Error('TemporaSMS services could not be loaded'+(err?' ('+err+')':''));
c.countries=countries;c.services=services.map(x=>({...x,price:old.get(String(x.id))||0}));c.operators=ops.map(x=>({id:String(x),operator:String(x)}));await c.save();return{countries:c.countries.length,services:c.services.length,operators:c.operators.length};}
function admin(id){return Number(id)===OWNER_ID;}
const previous=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){const q=update?.callback_query,cb=q?.data||'',uid=q?.from?.id;if(q&&uid&&admin(uid)&&cb==='nsi_import_tempo'){try{await this.telegram.answerCbQuery(q.id,'⏳ Syncing TemporaSMS...')}catch{};try{const r=await syncTempo();return this.telegram.sendMessage(uid,`✅ Server 1 • TemporaSMS Import/Sync completed\n\n🌍 Countries: ${r.countries}\n📦 Services: ${r.services}\n📡 Operators: ${r.operators}`)}catch(e){console.log('TEMPO IMPORT SYNC ERROR:',e.response?.data||e.message);return this.telegram.sendMessage(uid,'❌ Server 1 sync failed.\n\n'+e.message);}}return previous.call(this,update,...args)};
