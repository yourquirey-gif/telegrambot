const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');

const OWNER_ID = 5087094625;
const settingSchema = new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed });
const PurchaseLogSetting = mongoose.models.PurchaseLogSetting || mongoose.model('PurchaseLogSetting', settingSchema, 'settings');
const DepositLog = mongoose.models.PurchaseDepositLog || mongoose.model('PurchaseDepositLog', new mongoose.Schema({ paymentId: {type:String, unique:true}, createdAt:{type:Date,default:Date.now} }, {collection:'purchase_deposit_logs'}));
const setupState = new Map();
const purchaseContext = new Map();
let purchaseLogChannel = '';
let depositLogChannel = '';

async function loadLogChannels(){
  try {
    const purchase = await PurchaseLogSetting.findOne({key:'purchaseLogChannel'});
    if(purchase) purchaseLogChannel = String(purchase.value || '').trim();
    const deposit = await PurchaseLogSetting.findOne({key:'depositLogChannel'});
    if(deposit) depositLogChannel = String(deposit.value || '').trim();
  } catch(e) { console.log('Log channel load error:', e.message); }
}
loadLogChannels();

async function isAdmin(userId){
  if(Number(userId) === OWNER_ID) return true;
  try { return !!(await mongoose.models.Admin?.findOne({userId:String(userId)})); } catch { return false; }
}

async function setPurchaseChannel(channel){
  purchaseLogChannel = String(channel || '').trim();
  await PurchaseLogSetting.findOneAndUpdate({key:'purchaseLogChannel'},{value:purchaseLogChannel},{upsert:true});
}

async function setDepositChannel(channel){
  depositLogChannel = String(channel || '').trim();
  await PurchaseLogSetting.findOneAndUpdate({key:'depositLogChannel'},{value:depositLogChannel},{upsert:true});
}

function normalizeNumber(v){ return String(v||'').replace(/^\+/, ''); }

function serverName(v){
  const s=String(v||'').toLowerCase();
  if(s.includes('tempo')) return 'Server 1';
  if(s.includes('vak')) return 'Server 2';
  if(s.includes('5sim') || s.includes('5 sim')) return 'Server 3';
  if(/^server\s*[123]$/i.test(String(v||''))) return String(v);
  return 'Server 1';
}

function cleanProviderNames(v){
  return String(v||'')
    .replace(/TempoSMS/gi,'Server 1')
    .replace(/VAK[- ]?SMS/gi,'Server 2')
    .replace(/5SIM/gi,'Server 3')
    .replace(/5 Sim/gi,'Server 3');
}

async function sendPurchaseLog(bot, text, userId){
  if(!purchaseLogChannel) return;
  const service = text.match(/(?:📦|✅)\s*Service\s*:\s*([^\n]+)/i)?.[1]?.trim() || purchaseContext.get(String(userId))?.service || 'Unknown';
  const countryRaw = text.match(/🌍\s*Country(?: ID)?\s*:\s*([^\n]+)/i)?.[1]?.trim() || purchaseContext.get(String(userId))?.country || 'Unknown';
  const phone = text.match(/📱\s*Number\s*:\s*<?(?:<code>)?([^\n>]+)>?/i)?.[1]?.trim() || '';
  const orderId = text.match(/🆔\s*Order ID\s*:\s*<?(?:<code>)?([^\n>]+)>?/i)?.[1]?.trim() || '';
  const rawServer = text.match(/🖥\s*Server\s*:\s*([^\n]+)/i)?.[1]?.trim() || purchaseContext.get(String(userId))?.server || '';
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
  const log = `📅 New Purchase Success\n\n🖥 Server: ${serverName(rawServer)}\nAmount: 1\nPrice: ₹${price}\nCountry: ${country}\nNumber: +${normalizeNumber(phone)}\nService: ${cleanProviderNames(service)}\nOrder ID: ${orderId}\n\nThanks for Purchase @tgfreeotp1bot 🔄`;
  try { await bot.telegram.sendMessage(purchaseLogChannel, log); }
  catch(e) { console.log('Purchase log send error:', e.message); }
  purchaseContext.delete(String(userId));
}

async function sendDepositLog(bot, payment){
  if(!depositLogChannel || !payment) return;
  const paymentId = String(payment.paymentId || '');
  if(!paymentId) return;
  try {
    const already = await DepositLog.findOne({paymentId});
    if(already) return;
    const amount = Number(payment.amount || 0);
    const method = String(payment.method || 'MANUAL');
    const log = `🚀 New Deposit Success\n\nAmount: ₹${amount.toFixed(2).replace(/\.00$/,'')}\nPayment Method: ${method} (Approved)\n\nThanks For Deposit`;
    await bot.telegram.sendMessage(depositLogChannel, log);
    await DepositLog.create({paymentId});
  } catch(e) { console.log('Deposit log send error:', e.message); }
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
        setupState.set(String(userId), 'purchase');
        try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}
        return this.telegram.sendMessage(userId, `📋 PURCHASE LOGS CHANNEL\n\nCurrent: ${purchaseLogChannel || 'Not Set'}\n\nSend the @username or -100 Chat ID of your purchase logs channel.\n\nExample: @mylogchannel`, Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel','admin_logs_cancel')]]));
      }
      if(callback === 'admin_deposit_logs'){
        setupState.set(String(userId), 'deposit');
        try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}
        return this.telegram.sendMessage(userId, `💰 DEPOSIT LOGS CHANNEL\n\nCurrent: ${depositLogChannel || 'Not Set'}\n\nSend the @username or -100 Chat ID of your deposit logs channel.\n\nExample: @mydepositlogs`, Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel','admin_logs_cancel')]]));
      }
      if(callback === 'admin_logs_cancel'){
        setupState.delete(String(userId));
        try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}
        return this.telegram.sendMessage(userId, '❌ Logs channel setup cancelled.');
      }
      const setupType = setupState.get(String(userId));
      if(setupType && update.message?.chat?.type === 'private' && text && !text.startsWith('/')){
        setupState.delete(String(userId));
        const channel = text.trim();
        if(!channel) return this.telegram.sendMessage(userId,'❌ Invalid channel.');
        if(setupType === 'deposit'){
          await setDepositChannel(channel);
          return this.telegram.sendMessage(userId, `✅ Deposit Logs Channel Saved\n\n💰 ${channel}\n\nEvery approved credit deposit will now be sent there.`);
        }
        await setPurchaseChannel(channel);
        return this.telegram.sendMessage(userId, `✅ Purchase Logs Channel Saved\n\n📋 ${channel}\n\nEvery successful number purchase will now be sent there.`);
      }
    }

    if(userId && callback.startsWith('approve_payment_')){
      const result = await originalHandleUpdate.call(this,update,...args);
      try {
        const paymentId = callback.slice('approve_payment_'.length);
        const Payment = mongoose.models.StrictPaymentFix;
        if(Payment){
          const payment = await Payment.findOne({paymentId});
          if(payment?.status === 'APPROVED') setImmediate(() => sendDepositLog(this,payment));
        }
      } catch(e) { console.log('Deposit approval hook error:', e.message); }
      return result;
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
              const rows = [
                [{text:'📋 Purchase Logs', callback_data:'admin_purchase_logs'}],
                [{text:'💰 Deposit Logs', callback_data:'admin_deposit_logs'}]
              ];
              if(idx >= 0) kb.splice(idx + 1, 0, ...rows); else kb.push(...rows);
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
