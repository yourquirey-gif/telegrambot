const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');

const OWNER_ID = 5087094625;
const cfgSchema = new mongoose.Schema({
  server:{type:String,unique:true}, countries:{type:Array,default:[]}, services:{type:Array,default:[]}, operators:{type:Array,default:[]}, markup:{type:Number,default:0}
},{collection:'number_server_configs'});
const Config = mongoose.models.NumberServerListsConfig || mongoose.model('NumberServerListsConfig',cfgSchema);

async function admin(id){
  if(Number(id)===OWNER_ID) return true;
  try{return !!(await mongoose.models.Admin?.findOne({userId:String(id)}));}catch{return false;}
}
async function cfg(server){
  return Config.findOneAndUpdate({server},{server},{upsert:true,new:true,setDefaultsOnInsert:true});
}
function page(arr,p=1,n=10){return arr.slice((p-1)*n,p*n);}
function enc(s){return encodeURIComponent(String(s));}

async function settingsMenu(bot,uid,server){
  const c=await cfg(server);
  const title=server==='vak'?'VAK-SMS':'5SIM';
  const rows=[
    [Markup.button.callback('🌍 Add Country',`vfix_${server}_add_country`),Markup.button.callback('🗑 Remove Country',`vfix_${server}_del_country`)],
    [Markup.button.callback('📦 Add Service',`vfix_${server}_add_service`),Markup.button.callback('🗑 Remove Service',`vfix_${server}_del_service`)],
    [Markup.button.callback('📋 Countries List',`nsl_${server}_countries_1`),Markup.button.callback('📋 Services List',`nsl_${server}_services_1`)]
  ];
  if(server==='5sim') rows.push([Markup.button.callback('📡 Operators List','nsl_5sim_operators_1')]);
  rows.push([Markup.button.callback('⬅ Number Servers','admin_servers')]);
  return bot.telegram.sendMessage(uid,`⚙️ ${title} SETTINGS\n\nCountries: ${c.countries.length}\nServices: ${c.services.length}${server==='5sim'?`\nOperators: ${c.operators.length}`:''}`,Markup.inlineKeyboard(rows));
}

async function listPage(bot,uid,server,type,p=1){
  const c=await cfg(server);
  const arr=type==='countries'?c.countries:type==='services'?c.services:c.operators;
  const items=page(arr,p,10);
  const total=Math.max(1,Math.ceil(arr.length/10));
  let text=`📋 ${server.toUpperCase()} ${type.toUpperCase()}\n\n`;
  if(!items.length) text+='No items added yet.';
  else if(type==='countries') items.forEach((x,i)=>text+=`${(p-1)*10+i+1}. ${x.name}\n   ID: ${x.id}${x.code?`\n   Code: ${x.code}`:''}\n\n`);
  else if(type==='services') items.forEach((x,i)=>text+=`${(p-1)*10+i+1}. ${x.name}\n   API: ${x.id}${server==='vak'?`\n   Price: ₹${x.price??0}`:''}\n\n`);
  else items.forEach((x,i)=>text+=`${(p-1)*10+i+1}. ${x.country} | ${x.service} | ${x.operator}\n\n`);
  const rows=[]; const nav=[];
  if(p>1) nav.push(Markup.button.callback('⬅ Previous',`nsl_${server}_${type}_${p-1}`));
  if(p<total) nav.push(Markup.button.callback('Next ➡',`nsl_${server}_${type}_${p+1}`));
  if(nav.length) rows.push(nav);
  rows.push([Markup.button.callback('⚙️ Settings',`ns_${server}`)]);
  return bot.telegram.sendMessage(uid,text+`Page ${p}/${total}`,Markup.inlineKeyboard(rows));
}

const original=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){
  try{
    const from=update?.message?.from||update?.callback_query?.from;
    const uid=from?.id;
    const cb=update?.callback_query?.data||'';
    if(uid && await admin(uid)){
      if(cb==='admin_servers'){
        try{await this.telegram.answerCbQuery(update.callback_query.id)}catch{}
        return this.telegram.sendMessage(uid,'🖥 NUMBER SERVERS ADMIN\n\nChoose server:',Markup.inlineKeyboard([
          [Markup.button.callback('🟢 5SIM Settings','ns_5sim')],
          [Markup.button.callback('🔵 VAK-SMS Settings','ns_vak')],
          [Markup.button.callback('⬅ Admin Panel','admin_panel')]
        ]));
      }
      if(cb==='ns_5sim'||cb==='ns_vak'){
        try{await this.telegram.answerCbQuery(update.callback_query.id)}catch{}
        return settingsMenu(this,uid,cb==='ns_vak'?'vak':'5sim');
      }
      const m=cb.match(/^nsl_(5sim|vak)_(countries|services|operators)_(\d+)$/);
      if(m){
        const server=m[1],type=m[2],p=Number(m[3])||1;
        if(server==='vak'&&type==='operators') return this.telegram.answerCbQuery(update.callback_query.id,'VAK-SMS has no operators setting',{show_alert:true});
        try{await this.telegram.answerCbQuery(update.callback_query.id)}catch{}
        return listPage(this,uid,server,type,p);
      }
    }
  }catch(e){console.log('NUMBER SERVER LISTS ERROR:',e.message);}
  return original.call(this,update,...args);
};
