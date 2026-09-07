const { Telegraf } = require('telegraf');

const originalLaunch = Telegraf.prototype.launch;
let launching = false;

Telegraf.prototype.launch = async function(...args) {
  if (launching) return;
  launching = true;

  const launchArgs = (args.length && args[0] && typeof args[0] === 'object')
    ? [{ ...args[0], dropPendingUpdates: false }, ...args.slice(1)]
    : [{ dropPendingUpdates: false }];

  // Make sure Telegram is in polling mode before starting getUpdates.
  try {
    await this.telegram.deleteWebhook({ drop_pending_updates: false });
  } catch (e) {
    console.log('Telegram webhook cleanup skipped:', e.message || e);
  }

  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Starting Telegram polling attempt ${attempt}/${maxAttempts}...`);
      await originalLaunch.call(this, ...launchArgs);
      console.log('Telegram polling started successfully.');
      return;
    } catch (err) {
      const message = err?.message || String(err);
      console.error(`Telegram polling attempt ${attempt} failed: ${message}`);
      const conflict = /409\s*:\s*Conflict|terminated by other getUpdates request|another getUpdates worker/i.test(message);
      if (conflict) {
        try { await this.telegram.deleteWebhook({ drop_pending_updates: false }); } catch {}
      }
      if (attempt === maxAttempts) {
        launching = false;
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(10000, 2000 + attempt * 500)));
    }
  }
};
