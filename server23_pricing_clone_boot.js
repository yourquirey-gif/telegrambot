const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');

// Server 2 + Server 3 pricing controls intentionally mirror Server 1's
// simple "Set Price" / "Set Profit %" flow, but use an isolated state map
// so the two input modes can never collide with older handlers.
const OWNER_ID = 5087094625;
const state = new Map();
const COL = 'number_server_configs';

async function isAdmin(id){
  if(Number(id) === OWNER_ID) return true;
  try { return !!(await mongoose.models.Admin?.findOne({userId:String(id)})); }
  catch { return false; }
}

async function cfg(server){
  return mongoose.connection.db.collection(COL).findOne({server});
}

async function save(server, changes){
  return mongoose.connection.db.collection(COL).updateOne(
    {server},
    {$set:changes},
    {upsert:true}
  );
}

function menu(server,c){
  const title = server === 'vak' ? 'VAK-SMS' : '5SIM';
  return Markup.inlineKeyboard([
    [Markup.button.callback('📥 Import / Sync All',`nsi_import_${server}`)],
    [Markup.button.callback('🗑 Remove All',`nsi_remove_${server}`)],
    [
      Markup.button.callback('💰 Set Price',`sp23_price_${server}`),
      Markup.button.callback('📈 Set Profit %',`sp23_profit_${server}`)
    ],
    [Markup.button.callback('🌍 Add Country',`vfix_${server}_add_country`),Markup.button.callback('🗑 Remove Country',`vfix_${server}_del_country`)],
    [Markup.button.callback('📦 Add Service',`vfix_${server}_add_service`),Markup.button.callback('🗑 Remove Service',`vfix_${server}_del_service`)],
    [Markup.button.callback('📋 Countries List',`nsl_${server}_countries_1`),Markup.button.callback('📋 Services List',`nsl_${server}_services_1`)],
    [Markup.button.callback('🔎 Search Countries',`nss_${server}_countries`),Markup.button.callback('🔎 Search Services',`nss_${server}_services`)],
    ...(server === '5sim' ? [[Markup.button.callback('📡 Operators List','nsl_5sim_operators_1')]] : []),
    [Markup.button.callback('⬅ Number Servers','admin_servers')]
  ]);
}

async function showMenu(bot,uid,server,message){
  const c = await cfg(server) || {countries:[],services:[],operators:[],markup:0};
  await bot.telegram.sendMessage(uid,message || `⚙️ ${server==='vak'?'VAK-SMS':'5SIM'} SETTINGS\n\nCountries: ${(c.countries||[]).length}\nServices: ${(c.services||[]).length}${server==='5sim'?`\nOperators: ${(c.operators||[]).length}`:''}\nProfit: ${Number(c.markup||0)}%`,menu(server,c));
}

const previous = Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate = async function(update,...args){
  try{
    const q = update?.callback_query;
    const uid = q?.from?.id || update?.message?.from?.id;
    const cb = q?.data || '';

    if(uid && await isAdmin(uid)){
      // Handle the user's number only for the state created by this boot.
      // This is deliberately before older handlers so they cannot consume it.
      if(update.message?.chat?.type === 'private' && update.message?.text && !String(update.message.text).startsWith('/') && state.has(String(uid))){
        const st = state.get(String(uid));
        state.delete(String(uid));
        const n = Number(String(update.message.text).trim());
        if(!Number.isFinite(n) || n < 0){
          await this.telegram.sendMessage(uid,'❌ Invalid number. Please enter 0 or greater.');
          return showMenu(this,uid,st.server);
        }

        const c = await cfg(st.server) || {services:[]};
        if(st.type === 'profit'){
          await save(st.server,{markup:n});
          return showMenu(this,uid,st.server,`✅ Profit % saved: ${n}%`);
        }

        const services = (c.services || []).map(x => ({...x,price:n}));
        await save(st.server,{services});
        return showMenu(this,uid,st.server,`✅ Price saved: ₹${n}`);
      }

      // Same two modes as Server 1, but isolated callbacks for Server 2/3.
      const m = cb.match(/^sp23_(price|profit)_(vak|5sim)$/);
      if(m){
        const type = m[1];
        const server = m[2];
        state.set(String(uid),{server,type});
        try { await this.telegram.answerCbQuery(q.id); } catch {}
        return this.telegram.sendMessage(
          uid,
          type === 'profit'
            ? '📈 Send default profit percentage.\nExample: 20'
            : '💰 Send default service price in ₹.\nExample: 50'
        );
      }
    }
  }catch(e){
    console.log('SERVER23 PRICING CLONE ERROR:',e.message);
  }
  return previous.call(this,update,...args);
};
