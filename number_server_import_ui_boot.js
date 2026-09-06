const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const OWNER_ID = 5087094625;
const cfgSchema = new mongoose.Schema({server:{type:String,unique:true},countries:{type:Array,default:[]},services:{type:Array,default:[]},operators:{type:Array,default:[]},markup:{type:Number,default:0}},{collection:'number_server_configs'});
const Config = mongoose.models.NumberServerImportUIConfig || mongoose.model('NumberServerImportUIConfig',cfgSchema);
async function admin(id){if(Number(id)===OWNER_ID)return true;try{return !!(await mongoose.models.Admin?.findOne({userId:String(id)}));}catch{return false;}}
async function cfg(server){return Config.findOneAndUpdate({server},{server},{upsert:true,new:true,setDefaultsOnInsert:true});}
function menu(server,c){const title=server==='vak'?'VAK-SMS':'5SIM';return Markup.inlineKeyboard([
 [Markup.button.callback('📥 Import / Sync All',`nsi_import_${server}`)],
 [Markup.button.callback('🗑 Remove All',`nsi_remove_${server}`)],
 [Markup.button.callback('💰 Set Price',`nsi_price_${server}`),Markup.button.callback('📈 Set Profit %',`nsi_profit_${server}`)],
 [Markup.button.callback('🌍 Add Country',`vfix_${server}_add_country`),Markup.button.callback('🗑 Remove Country',`vfix_${server}_del_country`)],
 [Markup.button.callback('📦 Add Service',`vfix_${server}_add_service`),Markup.button.callback('🗑 Remove Service',`vfix_${server}_del_service`)],
 [Markup.button.callback('📋 Countries List',`nsl_${server}_countries_1`),Markup.button.callback('📋 Services List',`nsl_${server}_services_1`)],
 [Markup.button.callback('🔎 Search Countries',`nss_${server}_countries`),Markup.button.callback('🔎 Search Services',`nss_${server}_services`)],
 ...(server==='5sim' ? [[Markup.button.callback('📡 Operators List','nsl_5sim_operators_1')]] : []),
 [Markup.button.callback('⬅ Number Servers','admin_servers')]
]);}
const previous=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){try{const q=update?.callback_query,uid=q?.from?.id,cb=q?.data||'';if(uid&&await admin(uid)&&(cb==='ns_5sim'||cb==='ns_vak')){const server=cb==='ns_vak'?'vak':'5sim',c=await cfg(server);try{await this.telegram.answerCbQuery(q.id)}catch{};return this.telegram.sendMessage(uid,`⚙️ ${server==='vak'?'VAK-SMS':'5SIM'} SETTINGS\n\nCountries: ${c.countries.length}\nServices: ${c.services.length}${server==='5sim'?`\nOperators: ${c.operators.length}`:''}`,menu(server,c));}}catch(e){console.log('IMPORT UI BOOT:',e.message)}return previous.call(this,update,...args);};
