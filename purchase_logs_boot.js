const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');

const OWNER_ID = 5087094625;
const settingSchema = new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed });
const PurchaseLogSetting = mongoose.models.PurchaseLogSetting || mongoose.model('PurchaseLogSetting', settingSchema, 'settings');
const setupState = new Map();
const purchaseContext = new Map();
let purchaseLogChannel = '';

async function loadPurchaseLogChannel(){
  try {
    const s = await PurchaseLogSetting.findOne({key:'purchaseLogChannel'});
    if(s) purchaseLogChannel = String(s.value || '').trim();
  } catch(e) { console.log('Purchase log load error:', e.message); }
}
loadPurchaseLogChannel();

async function isAdmin(userId){
  if(Number(userId) === OWNER_ID) return true;
  try { return !!(await mongoose.models.Admin?.findOne({userId:String(userId)})); } catch { return false; }
}

async function setChannel(channel){
  purchaseLogChannel = String(channel || '').trim();
  await PurchaseLogSetting.findOneAndUpdate({key:'purchaseLogChannel'},{value:purchaseLogChannel},{upsert:true});
}

function normalizeNumber(v){ return String(v||'').replace(/^\+/, ''); }

async function sendPurchaseLog(bot, text, userId){
  if(!purchaseLogChannel) return;
  const service = text.match(/(?:📦|✅)\s*Service\s*:\s*([^\n]+)/i)?.[1]?.trim() || purchaseContext.get(String(userId))?.service || 'Unknown';
  const countryRaw = text.match(/🌍\s*Country(?: ID)?\s*:\s*([^\n]+)/i)?.[1]?.trim() || purchaseContext.get(String(userId))?.country || 'Unknown';
  const phone = text.match(/📱\s*Number\s*:\s*<?(?:<code>)?([^\n>]+)>?/i)?.[1]?.trim() || '';
  const orderId = text.match(/🆔\s*Order ID\s*:\s*<?(?:<code>)?([^\n>]+)>?/i)?.[1]?.trim() || '';
  if(!phone || !orderId) return;

  const context = purchaseContext.get(String(userId)) || {};
  let country = countryRaw;
  try {
    const Country = mongoose.models.Country;
    if(Country){
      const c = await Country.findOne({countryId:String(countryRaw)});
      if(c?.name) country = c.name;
    }
  } catch {}

  const price = context.price || text.match(/(?:price|💎)\s*[:/]?\s*₹?([0-9]+(?:\.[0-9]+)?)/i)?.[1] || '0';
  const log = `📅 New Purchase Success\n\nAmount: 1\nPrice: ₹${price}\nCountry: ${country}\nNumber: +${normalizeNumber(phone)}\nService: ${service}\nOrder ID: ${orderId}\n\nThanks for Purchase @tgfreeotp1bot 🔄`;
  try { await bot.telegram.sendMessage(purchaseLogChannel, log); }
  catch(e) { console.log('Purchase log send error:', e.message); }
  purchaseContext.delete(String(userId));
}

const originalHandleUpdate = Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate = async function(update,...args){
  try {
    const from = update?.message?.from || update?.callback_query?.from;
    const userId = from?.id;
    const callback = update?.callback_query?.data || '';
    const text = update?.message?.text || '';

    if(userId && callback.startsWith('select_country_')){
      const parts = callback.split('_');
      if(parts.length >= 6){
        purchaseContext.set(String(userId), { service: parts[2], country: parts[3], price: Number(parts[5]) || 0 });
      }
    }

    if(userId && await isAdmin(userId)){
      if(callback === 'admin_purchase_logs'){
        setupState.set(String(userId), true);
        try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}
        return this.telegram.sendMessage(userId, `📋 PURCHASE LOGS CHANNEL\n\nCurrent: ${purchaseLogChannel || 'Not Set'}\n\nSend the @username or -100 Chat ID of your new logs channel.\n\nExample: @mylogchannel`, Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel','admin_purchase_logs_cancel')]]));
      }
      if(callback === 'admin_purchase_logs_cancel'){
        setupState.delete(String(userId));
        try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}
        return this.telegram.sendMessage(userId, '❌ Purchase logs channel setup cancelled.');
      }
      if(setupState.get(String(userId)) && update.message?.chat?.type === 'private' && text && !text.startsWith('/')){
        setupState.delete(String(userId));
        const channel = text.trim();
        if(!channel) return this.telegram.sendMessage(userId,'❌ Invalid channel.');
        await setChannel(channel);
        return this.telegram.sendMessage(userId, `✅ Purchase Logs Channel Saved\n\n📋 ${channel}\n\nEvery successful number purchase will now be sent there.`);
      }
    }
  } catch(e) { console.log('Purchase log update error:', e.message); }
  return originalHandleUpdate.call(this,update,...args);
};

try {
  const Telegram = require('telegraf').Telegram;
  if(Telegram?.prototype?.callApi){
    const originalCallApi = Telegram.prototype.callApi;
    Telegram.prototype.callApi = async function(method, payload, ...args){
      try {
        if(method === 'sendMessage' && payload){
          let text = String(payload.text || '');
          if(text.includes('tgfreeotpbot')){
            payload.text = text.replace(/https:\/\/t\.me\/tgfreeotpbot/g, 'https://t.me/tgfreeotp1bot');
            text = String(payload.text || '');
          }
          if(text.includes('⚙️ ADMIN PANEL') && payload.reply_markup){
            let kb = payload.reply_markup.inline_keyboard || [];
            if(!kb.some(row => row.some(btn => btn.callback_data === 'admin_purchase_logs'))){
              const idx = kb.findIndex(row => row.some(btn => btn.callback_data === 'admin_payment_settings'));
              const row = [{text:'📋 Purchase Logs', callback_data:'admin_purchase_logs'}];
              if(idx >= 0) kb.splice(idx + 1, 0, row); else kb.push(row);
              payload.reply_markup.inline_keyboard = kb;
            }
          }
          if(text.includes('📱 NUMBER ALLOCATED')){
            const chatId = payload.chat_id;
            setImmediate(() => sendPurchaseLog(this, text, chatId));
          }
        }
      } catch(e) { console.log('Purchase log API hook error:', e.message); }
      return originalCallApi.call(this,method,payload,...args);
    };
  }
} catch(e) { console.log('Purchase log Telegram hook error:', e.message); }
