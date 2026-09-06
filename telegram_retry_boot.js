const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const crypto = require('crypto');

const originalLaunch = Telegraf.prototype.launch;
const LOCK_ID = 'telegram-polling-lock';
const OWNER_ID = `${process.env.RENDER_INSTANCE_ID || process.env.RENDER_INSTANCE_NAME || 'instance'}:${process.pid}:${crypto.randomUUID()}`;
const LEASE_MS = 60000;
const RENEW_MS = 20000;
let leaseTimer = null;
let leaseOwned = false;

async function waitForMongo() {
  if (mongoose.connection.readyState === 1) return true;
  if (mongoose.connection.readyState === 0) {
    try {
      await new Promise((resolve, reject) => {
        const onConnected = () => { cleanup(); resolve(); };
        const onError = err => { cleanup(); reject(err); };
        const cleanup = () => {
          mongoose.connection.off('connected', onConnected);
          mongoose.connection.off('error', onError);
        };
        mongoose.connection.once('connected', onConnected);
        mongoose.connection.once('error', onError);
        setTimeout(() => { cleanup(); reject(new Error('MongoDB connection timeout while acquiring Telegram polling lock')); }, 20000);
      });
    } catch (err) {
      console.error('Telegram polling lock: MongoDB is not ready:', err.message || err);
      return false;
    }
  }
  return mongoose.connection.readyState === 1;
}

async function acquirePollingLock() {
  if (!(await waitForMongo())) return false;

  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const collection = mongoose.connection.collection('telegram_bot_locks');

  try {
    const result = await collection.findOneAndUpdate(
      {
        _id: LOCK_ID,
        $or: [
          { leaseUntil: { $lte: now } },
          { owner: OWNER_ID }
        ]
      },
      {
        $set: { owner: OWNER_ID, leaseUntil, updatedAt: now },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const doc = result?.value || result;
    leaseOwned = !!doc && doc.owner === OWNER_ID;

    if (!leaseOwned) {
      console.log('Telegram polling lock is owned by another Render instance; skipping bot polling on this instance.');
      return false;
    }

    if (!leaseTimer) {
      leaseTimer = setInterval(async () => {
        if (!leaseOwned || mongoose.connection.readyState !== 1) return;
        try {
          const renewed = await collection.updateOne(
            { _id: LOCK_ID, owner: OWNER_ID },
            { $set: { leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date() } }
          );
          if (renewed.matchedCount !== 1) {
            leaseOwned = false;
            console.error('Telegram polling lock was lost; stopping polling to avoid a 409 conflict.');
          }
        } catch (err) {
          console.error('Telegram polling lock renewal failed:', err.message || err);
        }
      }, RENEW_MS);
      leaseTimer.unref?.();
    }

    console.log(`Telegram polling lock acquired by ${OWNER_ID}`);
    return true;
  } catch (err) {
    if (err?.code === 11000) {
      console.log('Telegram polling lock is already owned by another Render instance; skipping bot polling.');
      return false;
    }
    console.error('Telegram polling lock error:', err.message || err);
    return false;
  }
}

async function releasePollingLock() {
  if (!leaseOwned || mongoose.connection.readyState !== 1) return;
  leaseOwned = false;
  try {
    await mongoose.connection.collection('telegram_bot_locks').deleteOne({ _id: LOCK_ID, owner: OWNER_ID });
  } catch (_) {}
  if (leaseTimer) clearInterval(leaseTimer);
  leaseTimer = null;
}

process.once('SIGTERM', () => { releasePollingLock().finally(() => process.exit(0)); });
process.once('SIGINT', () => { releasePollingLock().finally(() => process.exit(0)); });

Telegraf.prototype.launch = async function (...args) {
  const hasLock = await acquirePollingLock();
  if (!hasLock) {
    // Keep the Render web process alive, but never start a second getUpdates worker.
    return;
  }

  const maxAttempts = 6;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await originalLaunch.call(this, ...args);
    } catch (err) {
      lastError = err;
      const message = err?.message || String(err);
      console.error(`Telegram launch attempt ${attempt}/${maxAttempts} failed: ${message}`);

      // A 409 means another worker already owns Telegram getUpdates. Do not
      // keep retrying because retries only make the conflict worse.
      if (/409\s*:\s*Conflict|terminated by other getUpdates request|another getUpdates worker/i.test(message)) {
        console.error('Telegram polling conflict detected; releasing the distributed lock and stopping polling on this instance.');
        await releasePollingLock();
        return;
      }

      if (attempt === maxAttempts) break;

      const waitMs = Math.min(15000, attempt * 3000);
      console.log(`Retrying Telegram connection in ${waitMs / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  await releasePollingLock();
  throw lastError;
};
