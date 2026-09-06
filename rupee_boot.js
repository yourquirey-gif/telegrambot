const mongoose=require('mongoose');
const QRCode=require('qrcode');
const crypto=require('crypto');
const {Telegraf,Markup}=require('telegraf');
const paymentInput=new Map();
let upiId='',merchantName='NexoSMM';
const Payment=mongoose.models.RupeePayment||mongoose.model('RupeePayment',new mongoose.Schema({paymentId:{type:String,unique:true},userId:String,amount:Number,credits:Number,method:{type:String,default:'MANUAL'},paymentNote:String,utr:{type:String,default:null},status:{type:String,default:'PENDING'},screenshotFileId:{type:String,default:null},adminId:{type:String,default:null},rejectReason:{type:String,default:null},createdAt:{type:Date,default:Date.now},expiresAt:Date},{collection:'payments'}));
const Setting=mongoose.models.RupeePaymentSetting||mongoose.model('RupeePaymentSetting',new mongoose.Schema({key:String,value:mongoose.Schema.Types.Mixed},{collection:'settings'}));
async function load(){try{const [u,m]=await Promise.all([Setting.findOne({key:'paymentUpiId'}),Setting.findOne({key:'paymentMerchantName'})]);if(u)upiId=String(u.value||'');if(m)merchantName=String(m.value||'NexoSMM')}catch{}}
load();
function pid(){return `NEXO-${Date.now().toString().slice(-6)}${Math.floor(Math.random()*90+10)}`}
function note(){return `NEXO-${crypto.randomBytes(3).toString('hex').toUpperCase()}`}
function uri(amount,n){return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${encodeURIComponent(Number(amount).toFixed(2))}&cu=INR&tn=${encodeURIComponent(n)}`}
const oldHandle=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){
 try{
  const from=update?.message?.from||update?.callback_query?.from;const uid=from?String(from.id):null;const cb=update?.callback_query?.data||'';const text=update?.message?.text;
  if(uid&&cb==='manual_payment'){
   await load();paymentInput.set(uid,'AMOUNT');try{await this.telegram.answerCbQuery(update.callback_query.id)}catch{}
   return this.telegram.sendMessage(uid,'💳 RUPEE BALANCE\n\nEnter the amount you want to add in INR.\n\nExample: 10\n\n💰 1 Rupee = ₹1 Balance',Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel','buy')]]));
  }
  if(uid&&update.message&&update.message.chat?.type==='private'&&text&&!text.startsWith('/')){
   const mode=paymentInput.get(uid);
   if(mode==='AMOUNT'){
    const amount=Number(String(text).trim());if(!Number.isFinite(amount)||amount<=0)return this.telegram.sendMessage(uid,'❌ Enter a valid amount. Example: 10');
    await load();if(!upiId)return this.telegram.sendMessage(uid,'❌ Payment UPI is not configured yet.\n\nPlease contact admin.');
    const paymentId=pid(),n=note(),expiresAt=new Date(Date.now()+10*60*1000);
    await Payment.create({paymentId,userId:uid,amount,credits:amount,method:'MANUAL',paymentNote:n,status:'PENDING',expiresAt});
    const qr=await QRCode.toBuffer(uri(amount,n),{width:700,margin:2});paymentInput.set(uid,`UTR:${paymentId}`);
    return this.telegram.sendPhoto(uid,{source:qr},{caption:`💳 RUPEE PAYMENT\n\n💰 Amount To Pay\n₹${amount.toFixed(2)}\n\n🆔 Payment ID\n${paymentId}\n\n📝 Payment Note\n${n}\n\n👤 Merchant\n${merchantName}\n\n🏦 UPI ID\n${upiId}\n\n⚠️ IMPORTANT\n\n✅ Pay exactly ₹${amount.toFixed(2)}\n✅ Don't change the payment note\n✅ QR expires in 10 minutes\n✅ After payment click I Have Paid\n\n⏳ ₹ balance will be added only after admin verification.`,reply_markup:{inline_keyboard:[[{text:'✅ I Have Paid',callback_data:`manual_paid_${paymentId}`}],[{text:'❌ Cancel',callback_data:`payment_cancel_${paymentId}`}]]}});
   }
   if(mode&&String(mode).startsWith('UTR:')){
    const paymentId=String(mode).slice(4),utr=String(text).trim();if(utr.length<6)return this.telegram.sendMessage(uid,'❌ UTR number looks invalid. Please enter the correct UTR.');const p=await Payment.findOne({paymentId,userId:uid});if(!p||p.status!=='PENDING')return this.telegram.sendMessage(uid,'❌ Payment request is no longer active.');if(new Date()>=p.expiresAt){p.status='EXPIRED';await p.save();paymentInput.delete(uid);return this.telegram.sendMessage(uid,'⌛ Payment expired.');}p.utr=utr;p.status='SUBMITTED';await p.save();paymentInput.delete(uid);return this.telegram.sendMessage(uid,`📸 SEND PAYMENT SCREENSHOT\n\n🆔 Payment ID: ${paymentId}\n\n💰 Amount: ₹${p.amount}\n\n🔢 UTR:\n${utr}\n\nPlease send the payment screenshot here.`);
   }
  }
 }catch(e){console.log('RUPEE BOOT ERROR:',e.message)}
 return oldHandle.call(this,update,...args);
};
try{
 const Telegram=require('telegraf').Telegram;const oldApi=Telegram.prototype.callApi;
 Telegram.prototype.callApi=async function(method,payload,...args){
  try{
   if(method==='sendMessage'&&payload){
    if(typeof payload.text==='string')payload.text=payload.text.replace(/(\d+(?:\.\d+)?)\s+credits\b/gi,'₹$1').replace(/credits/gi,'Balance').replace(/💎 BALANCE\s*:/g,'💰 BALANCE :');
    if(payload.reply_markup?.inline_keyboard)for(const row of payload.reply_markup.inline_keyboard)for(const b of row)if(typeof b.text==='string')b.text=b.text.replace(/💎 My Credits/g,'💰 My Balance').replace(/🛒 Buy Credits/g,'🛒 Add Balance').replace(/Credits/g,'Balance');
   }
  }catch{}
  return oldApi.call(this,method,payload,...args);
 };
}catch{}
