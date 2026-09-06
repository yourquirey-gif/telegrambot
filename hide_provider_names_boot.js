const { Telegraf } = require('telegraf');

// Keep provider/site names completely hidden from Telegram UI.
function cleanString(s){
  return String(s)
    .replace(/🟣\s*Server\s*1\s*[•·-]\s*TempoSMS/gi,'🟣 Server 1')
    .replace(/🟣\s*Server\s*1\s*[•·-]\s*TEMPOSMS/gi,'🟣 Server 1')
    .replace(/Server\s*1\s*[•·-]\s*TempoSMS/gi,'Server 1')
    .replace(/Server\s*1\s*[•·-]\s*TEMPOSMS/gi,'Server 1')
    .replace(/TempoSMS/gi,'Server 1')
    .replace(/VAK-SMS/gi,'Server 2')
    .replace(/5SIM/gi,'Server 3')
    .replace(/TEMPO\s*SMS/gi,'Server 1');
}
function clean(v,key){
  if(typeof v==='string') return key==='callback_data'||key==='url' ? v : cleanString(v);
  if(Array.isArray(v)) return v.map(x=>clean(x));
  if(v&&typeof v==='object'){
    const o={};
    for(const [k,val] of Object.entries(v)) o[k]=clean(val,k);
    return o;
  }
  return v;
}

const prev=Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate=async function(update,...args){
  const tg=this.telegram;
  if(tg&&!tg.__providerNamesHidden){
    const methods=['sendMessage','editMessageText','editMessageCaption','sendPhoto','sendVideo','sendDocument','sendAudio','sendAnimation','sendMediaGroup'];
    for(const method of methods){
      if(typeof tg[method]!=='function') continue;
      const original=tg[method].bind(tg);
      tg[method]=(...a)=>original(...a.map((v,i)=>clean(v,i===1?'text':undefined)));
    }
    tg.__providerNamesHidden=true;
  }
  return prev.call(this,update,...args);
};
