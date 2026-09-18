const { Telegraf, Markup } = require('telegraf');

// Server selection must ALWAYS be determined by the callback that was
// actually clicked. Never keep a per-user remembered server here: that can
// make a later Server 1/3 click inherit Server 2.
const previous = Telegraf.prototype.handleUpdate;

Telegraf.prototype.handleUpdate = async function(update, ...args) {
  try {
    const q = update?.callback_query;
    const uid = q?.from?.id;
    const cb = q?.data || '';

    if (q && uid) {
      // Normalize the server menu to the real mapping:
      // Server 1 = TemporaSMS, Server 2 = VAK-SMS, Server 3 = 5SIM.
      if (cb === 'ns_user_menu') {
        try { await this.telegram.answerCbQuery(q.id); } catch {}
        return this.telegram.sendMessage(uid, '🖥 NUMBER SERVERS\n\nChoose a number server:', Markup.inlineKeyboard([
          [Markup.button.callback('🟢 Server 1', 'tempo_user')],
          [Markup.button.callback('🔵 Server 2', 'ns_user_vak')],
          [Markup.button.callback('🟣 Server 3', 'ns_user_5sim')],
          [Markup.button.callback('🏠 Home', 'home')]
        ]));
      }

      // These callbacks are explicit and independent. Do not rewrite one
      // server into another server based on previous user activity.
      if (cb === 'server_select_1' || cb === 'server_select_2' || cb === 'server_select_3') {
        const target = cb.endsWith('_1') ? 'tempo_user' : cb.endsWith('_2') ? 'ns_user_vak' : 'ns_user_5sim';
        update = { ...update, callback_query: { ...q, data: target } };
      }
    }
  } catch (e) {
    console.log('SERVER SELECTION FIX:', e.message);
  }

  return previous.call(this, update, ...args);
};
