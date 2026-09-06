const mongoose=require('mongoose');
const {Telegraf,Markup}=require('telegraf');
const OWNER_ID=5087094625;
const collection=()=>mongoose.connection.db.collection('number_server_configs');
async function getCfg(){return collection().findOne({server:'tempo'})}
async function admin(id){if(Number(id)===OWNER_ID)return true;try{return !!(await mongoose.models.Admin?.findOne({userId:String(id)}));}catch{return false;}}
function menu(){return Markup.inlineKeyboard([[Markup.button.callback('🔄 Sync Countries','tempo_admin_countries'),Markup.button.callback('🔄 Sync Services','tempo_admin_services')],[Markup.button.callback('📋 Countries List','tempo_admin_cl'),Markup.button.callback('📦 Services List','tempo_admin_sl')],[Markup.button.callback('⬅ Number Servers','admin_servers')]])}
const prev=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){try{const q=update?.callback_query,uid=q?.from?.id,cb=q?.data||'';if(q&&uid&&await admin(uid)){
if(cb==='tempo_settings'){const c=await getCfg();try{await this.telegram.answerCbQuery(q.id)}catch{};return this.telegram.sendMessage(uid,`⚙️ SERVER 1 • TEMPOSMS SETTINGS\n\n🌍 Countries: ${c?.countries?.length||0}\n📦 Services: ${c?.services?.length||0}\n📈 Markup: ${c?.markup||0}%`,menu())}
if(cb==='tempo_admin_cl'||cb==='tempo_admin_sl'){const c=await getCfg();const a=cb==='tempo_admin_cl'?(c?.countries||[]):(c?.services||[]);const title=cb==='tempo_admin_cl'?'🌍 Server 1 • TemporaSMS Countries':'📦 Server 1 • TemporaSMS Services';const text=a.map(x=>`${x.id??x.code??''} = ${x.name||x.title||x.id||x.code||''}`).join('\n')||'None';try{await this.telegram.answerCbQuery(q.id)}catch{};return this.telegram.sendMessage(uid,title+'\n\n'+text.slice(0,3900),Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh',cb),Markup.button.callback('⬅ Settings','tempo_settings')]]))}
}}catch(e){console.log('TEMPO SYNC UI FIX:',e.message)}return prev.call(this,update,...args)};