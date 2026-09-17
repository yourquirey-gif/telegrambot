const { Telegraf } = require('telegraf');

// Keep the provider selected by the user all the way through purchase.
// The live catalog uses fbuy:<server>:..., while the legacy purchase flow
// uses ns_buy_<server>_.... Server 2/3 must never fall through to Server 1.
const previous = Telegraf.prototype.handleUpdate;

Telegraf.prototype.handleUpdate = async function(update, ...args) {
  try {
    const q = update?.callback_query;
    const cb = q?.data || '';

    if (q && (cb.startsWith('fbuy:vak:') || cb.startsWith('fbuy:5sim:'))) {
      const p = cb.split(':');
      const server = p[1];
      const country = p[2];
      const service = p.slice(3).join(':');

      // Convert only Server 2/3 live-catalog purchase callbacks into the
      // existing server-aware purchase callback. This preserves the exact
      // selected server instead of allowing a generic handler to fall back
      // to Server 1.
      update = {
        ...update,
        callback_query: {
          ...q,
          data: `ns_buy_${server}_${country}_${service}`
        }
      };
    }
  } catch (e) {
    console.log('SERVER SELECTION FIX:', e.message);
  }

  return previous.call(this, update, ...args);
};
