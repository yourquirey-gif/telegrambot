const { Telegraf } = require('telegraf');

const originalLaunch = Telegraf.prototype.launch;

Telegraf.prototype.launch = async function (...args) {
  const maxAttempts = 6;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await originalLaunch.call(this, ...args);
    } catch (err) {
      lastError = err;
      const message = err?.message || String(err);
      console.error(`Telegram launch attempt ${attempt}/${maxAttempts} failed: ${message}`);

      if (attempt === maxAttempts) break;

      const waitMs = Math.min(15000, attempt * 3000);
      console.log(`Retrying Telegram connection in ${waitMs / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
};
