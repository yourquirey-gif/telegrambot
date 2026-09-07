const { Telegraf, Markup } = require('telegraf');

const previousHandleUpdate = Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate = async function(update, ...args) {
  try {
    const from = update?.callback_query?.from || update?.message?.from;
    const uid = from?.id;
    const cb = update?.callback_query?.data || '';

    // The main bot's Add Balance button uses callback `buy`.
    // Replace only that entrypoint with the new payment-method menu.
    if (uid && cb === 'buy') {
      try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}
      return this.telegram.sendMessage(
        uid,
        '💰 ADD BALANCE\n\nChoose your payment method:',
        Markup.inlineKeyboard([
          [Markup.button.callback('⚡ Automatic Payment', 'automatic_payment')],
          [Markup.button.callback('🤖 Pay By Bot', 'bot_payment')],
          [Markup.button.callback('❌ Cancel', 'home')]
        ])
      );
    }

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

  // automatic_payment is passed through to the OmniUPI boot loaded after this file.
  return previousHandleUpdate.call(this, update, ...args);
};
