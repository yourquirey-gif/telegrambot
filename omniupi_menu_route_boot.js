const { Telegraf } = require('telegraf');

// Route the Automatic Payment button into OmniUPI's existing manual_payment entrypoint.
const previousHandleUpdate = Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate = async function(update, ...args) {
  try {
    const cb = update?.callback_query?.data || '';
    if (cb === 'automatic_payment') {
      const forwarded = {
        ...update,
        callback_query: { ...update.callback_query, data: 'manual_payment' }
      };
      return previousHandleUpdate.call(this, forwarded, ...args);
    }
  } catch (e) {
    console.log('OMNIUPI MENU ROUTE ERROR:', e.message);
  }
  return previousHandleUpdate.call(this, update, ...args);
};
