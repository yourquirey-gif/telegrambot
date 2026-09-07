const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const previousHandleUpdate = Telegraf.prototype.handleUpdate;

Telegraf.prototype.handleUpdate = async function(update, ...args) {
  try {
    const cb = update?.callback_query?.data || '';
    const uid = String(update?.callback_query?.from?.id || update?.message?.from?.id || '');

    // Replace the old buy entrypoint without defining a duplicate Setting model.
    if (uid && cb === 'buy') {
      let rate = 5;
      try {
        if (mongoose.connection?.readyState === 1) {
          const s = await mongoose.connection.collection('settings').findOne({ key: 'pricePerCredit' });
          if (s) rate = Number(s.value) || 5;
        }
      } catch {}

      try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}

      return this.telegram.sendMessage(
        uid,
        `💎 ADD BALANCE\n\n💰 Price : ₹${rate}/credit\n\nChoose your payment method:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⚡ Automatic Payment', 'automatic_payment')],
          [Markup.button.callback('🤖 Pay By Bot', 'bot_payment')],
          [Markup.button.callback('🏠 Home', 'home')]
        ])
      );
    }
  } catch (e) {
    console.log('PAYMENT BUY MENU FIX ERROR:', e.message);
  }

  return previousHandleUpdate.call(this, update, ...args);
};
