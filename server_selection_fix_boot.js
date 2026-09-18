const { Telegraf } = require('telegraf');

// Bind every live-catalog service click to the server the user most recently
// selected. This prevents a stale/wrong fsvc:<server>:... callback from
// jumping to Server 1 after a Server 2/3 service search.
const selectedServer = new Map();
const previous = Telegraf.prototype.handleUpdate;

Telegraf.prototype.handleUpdate = async function(update, ...args) {
  try {
    const q = update?.callback_query;
    const uid = q?.from?.id;
    const cb = q?.data || '';

    if (uid && q) {
      let server = null;
      if (cb === 'ns_user_vak') server = 'vak';
      else if (cb === 'ns_user_5sim') server = '5sim';
      else if (cb === 'tempo_user') server = 'tempo';
      else if (cb.startsWith('fsearch2:')) server = cb.slice('fsearch2:'.length);

      if (server === 'vak' || server === '5sim' || server === 'tempo') {
        selectedServer.set(String(uid), server);
      }

      if (cb.startsWith('fsvc:')) {
        const parts = cb.split(':');
        const callbackServer = parts[1];
        const rememberedServer = selectedServer.get(String(uid));

        if (rememberedServer && rememberedServer !== callbackServer) {
          update = {
            ...update,
            callback_query: {
              ...q,
              data: 'fsvc:' + rememberedServer + ':' + parts.slice(2).join(':')
            }
          };
        }
      }
    }
  } catch (e) {
    console.log('SERVER SEARCH BINDING FIX:', e.message);
  }

  return previous.call(this, update, ...args);
};
