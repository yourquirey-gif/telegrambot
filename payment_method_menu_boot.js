const { Telegraf, Markup } = require('telegraf');

// Add Balance -> choose Automatic Payment or the existing bot/manual payment flow.
const previousHandleUpdate = Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate = async function(update, ...args) {
  try {
    const from = update?.callback_query?.from || update?.message?.from;
    const uid = from?.id;
    const cb = update?.callback_query?.data || '';

    if (uid && cb === 'manual_payment') {
      try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}
      return this.telegram.sendMessage(
        uid,
        '💰 ADD BALANCE\n\nChoose your payment method:',
        Markup.inlineKeyboard([
          [Markup.button.callback('⚡ Automatic Payment', 'automatic_payment')],
          [Markup.button.callback('🤖 Pay By Bot', 'bot_payment')],
          [Markup.button.callback('❌ Cancel', 'buy')]
        ])
      );
    }

    // Send automatic-payment selection onward. omniupi_payment_boot.js handles this.
    if (uid && cb === 'automatic_payment') {
      try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}
      const forwarded = {
        ...update,
        callback_query: { ...update.callback_query, data: 'omni_start_payment' }
      };
      return previousHandleUpdate.call(this, forwarded, ...args);
    }

    // Existing payment-by-bot flow: delegate to the old payment system unchanged.
    if (uid && cb === 'bot_payment') {
      try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}
      const forwarded = {
        ...update,
        callback_query: { ...update.callback_query, data: 'manual_payment' }
      };
      return previousHandleUpdate.call(this, forwarded, ...args);
    }
  } catch (e) {
    console.log('PAYMENT METHOD MENU ERROR:', e.message);
  }

  return previousHandleUpdate.call(this, update, ...args);
};
