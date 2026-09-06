const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');

const OWNER_ID = 5087094625;
const state = new Map();

const cfgSchema = new mongoose.Schema({
  server:{type:String,unique:true}, countries:{type:Array,default:[]}, services:{type:Array,default:[]}, operators:{type:Array,default:[]}, markup:{type:Number,default:0}
},{collection:'number_server_configs'});
const Config = mongoose.models.VakSettingsFixConfig || mongoose.model('VakSettingsFixConfig',cfgSchema);

async function admin(id){
  if(Number(id)===OWNER_ID) return true;
  try{return !!(await mongoose.models.Admin?.findOne({userId:String(id)}));}catch{return false;}
}
async function cfg(server){
  return Config.findOneAndUpdate({server},{server},{upsert:true,new:true,setDefaultsOnInsert:true});
}
function menu(bot,uid,server){
  const title=server==='vak'?'VAK-SMS':'5SIM';
  const buttons = server==='vak' ? [
    [Markup.button.callback('🌍 Add Country',`vfix_${server}_add_country`),Markup.button.callback('🗑 Remove Country',`vfix_${server}_del_country`)],
    [Markup.button.callback('📦 Add Service',`vfix_${server}_add_service`),Markup.button.callback('🗑 Remove Service',`vfix_${server}_del_service`)],
    [Markup.button.callback('⬅ Number Servers','admin_servers')]
  ] : [
    [Markup.button.callback('🌍 Add Country',`vfix_${server}_add_country`),Markup.button.callback('🗑 Remove Country',`vfix_${server}_del_country`)],
    [Markup.button.callback('📦 Add Service',`vfix_${server}_add_service`),Markup.button.callback('🗑 Remove Service',`vfix_${server}_del_service`)],
    [Markup.button.callback('📡 Add Operator',`vfix_${server}_add_operator`),Markup.button.callback('🗑 Remove Operator',`vfix_${server}_del_operator`)],
    [Markup.button.callback('📈 Set Markup %',`vfix_${server}_markup`)],
    [Markup.button.callback('⬅ Number Servers','admin_servers')]
  ];
  return bot.telegram.sendMessage(uid,`⚙️ ${title} SETTINGS\n\nManage only the settings required for this server.`,Markup.inlineKeyboard(buttons));
}

const original = Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate = async function(update,...args){
  try{
    const from=update?.message?.from||update?.callback_query?.from; const uid=from?.id; const cb=update?.callback_query?.data||''; const text=String(update?.message?.text||'').trim();
    if(uid && await admin(uid) && update.message?.chat?.type==='private' && text && !text.startsWith('/')){
      const st=state.get(String(uid));
      if(st){
        state.delete(String(uid));
        const c=await cfg(st.server); const p=text.split('|').map(x=>x.trim());
        try{
          if(st.action==='add_country'){
            if(st.server==='vak'){if(p.length<3) throw new Error('Format: countryId | Display Name | Country Code'); c.countries=c.countries.filter(x=>String(x.id)!==p[0]); c.countries.push({id:p[0],name:p[1],code:p[2]});}
            else {if(p.length<2) throw new Error('Format: country-api-name | Display Name'); c.countries=c.countries.filter(x=>String(x.id).toLowerCase()!==p[0].toLowerCase()); c.countries.push({id:p[0].toLowerCase(),name:p[1]});}
          } else if(st.action==='del_country') {if(!p[0]) throw new Error('Send country ID'); c.countries=c.countries.filter(x=>String(x.id).toLowerCase()!==p[0].toLowerCase());}
          else if(st.action==='add_service') {if(st.server==='vak'){if(p.length<3) throw new Error('Format: service-api-code | Display Name | Price'); const price=Number(p[2]); if(!Number.isFinite(price)||price<0) throw new Error('Price must be a valid number'); c.services=c.services.filter(x=>String(x.id).toLowerCase()!==p[0].toLowerCase()); c.services.push({id:p[0].toLowerCase(),name:p[1],price});} else {if(p.length<2) throw new Error('Format: service-api-code | Display Name'); c.services=c.services.filter(x=>String(x.id).toLowerCase()!==p[0].toLowerCase()); c.services.push({id:p[0].toLowerCase(),name:p[1],price:0});}}
          else if(st.action==='del_service') {if(!p[0]) throw new Error('Send service ID'); c.services=c.services.filter(x=>String(x.id).toLowerCase()!==p[0].toLowerCase());}
          else if(st.action==='add_operator') {if(p.length<3) throw new Error('Format: country | service | operator'); c.operators=c.operators.filter(x=>!(x.country===p[0]&&x.service===p[1])); c.operators.push({country:p[0],service:p[1],operator:p[2]});}
          else if(st.action==='del_operator') c.operators=c.operators.filter(x=>!(x.country===p[0]&&x.service===p[1]&&x.operator===p[2]));
          else if(st.action==='markup') {const n=Number(text);if(!Number.isFinite(n)||n<0)throw new Error('Enter valid percentage');c.markup=n;}
          await c.save(); await this.telegram.sendMessage(uid,'✅ Saved successfully.');
        }catch(e){await this.telegram.sendMessage(uid,`❌ ${e.message}`);}
        return menu(this,uid,st.server);
      }
    }
    if(uid && await admin(uid)){
      if(cb==='ns_vak'||cb==='ns_5sim'){
        try{await this.telegram.answerCbQuery(update.callback_query.id)}catch{}
        return menu(this,uid,cb==='ns_vak'?'vak':'5sim');
      }
      const m=cb.match(/^vfix_(5sim|vak)_(add_country|del_country|add_service|del_service|add_operator|del_operator|markup)$/);
      if(m){
        const server=m[1],action=m[2];
        if(server==='vak' && ['add_operator','del_operator','markup'].includes(action)) return this.telegram.answerCbQuery(update.callback_query.id,'Not used for VAK-SMS',{show_alert:true});
        state.set(String(uid),{server,action}); try{await this.telegram.answerCbQuery(update.callback_query.id)}catch{}
        const prompts={add_country:server==='vak'?'✍️ Send: countryId | Display Name | Country Code':'✍️ Send: country-api-name | Display Name',del_country:'✍️ Send country ID to remove',add_service:server==='vak'?'✍️ Send: service-api-code | Display Name | Price':'✍️ Send: service-api-code | Display Name',del_service:'✍️ Send service ID to remove',add_operator:'✍️ Send: country | service | operator',del_operator:'✍️ Send: country | service | operator',markup:'✍️ Send markup percentage, e.g. 20'};
        return this.telegram.sendMessage(uid,prompts[action]);
      }
    }
  }catch(e){console.log('VAK SETTINGS FIX ERROR:',e.message);}
  return original.call(this,update,...args);
};
