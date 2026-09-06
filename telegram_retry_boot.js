const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const crypto = require('crypto');

const originalLaunch = Telegraf.prototype.launch;
const LOCK_ID = 'telegram-polling-lock';
const OWNER_ID = `${process.env.RENDER_INSTANCE_ID || process.env.RENDER_INSTANCE_NAME || 'instance'}:${process.pid}:${crypto.randomUUID()}`;
const LEASE_MS = 20000;
const RENEW_MS = 5000;
let leaseTimer = null;
let leaseOwned = false;

async function waitForMongo(){
  if(mongoose.connection.readyState === 1) return true;
  if(mongoose.connection.readyState === 0){
    try{
      await new Promise((resolve,reject)=>{
        const ok=()=>{cleanup();resolve()};
        const fail=e=>{cleanup();reject(e)};
        const cleanup=()=>{mongoose.connection.off('connected',ok);mongoose.connection.off('error',fail)};
        mongoose.connection.once('connected',ok);
        mongoose.connection.once('error',fail);
        setTimeout(()=>{cleanup();reject(new Error('MongoDB connection timeout'))},15000);
      });
    }catch(e){console.error('Telegram lock: MongoDB not ready:',e.message||e);return false}
  }
  return mongoose.connection.readyState === 1;
}

async function acquirePollingLock(){
  if(!(await waitForMongo())) return false;
  const collection = mongoose.connection.collection('telegram_bot_locks');
  const now = new Date();
  try{
    const result = await collection.findOneAndUpdate(
      {_id:LOCK_ID,$or:[{leaseUntil:{$lte:now}},{owner:OWNER_ID}]},
      {$set:{owner:OWNER_ID,leaseUntil:new Date(Date.now()+LEASE_MS),updatedAt:now},$setOnInsert:{createdAt:now}},
      {upsert:true,returnDocument:'after'}
    );
    const doc = result?.value || result;
    leaseOwned = !!doc && doc.owner === OWNER_ID;
    if(!leaseOwned) return false;
    if(!leaseTimer){
      leaseTimer=setInterval(async()=>{
        if(!leaseOwned || mongoose.connection.readyState!==1) return;
        try{
          const r=await collection.updateOne(
            {_id:LOCK_ID,owner:OWNER_ID},
            {$set:{leaseUntil:new Date(Date.now()+LEASE_MS),updatedAt:new Date()}}
          );
          if(r.matchedCount!==1){leaseOwned=false;console.error('Telegram polling lock lost; stopping polling.');}
        }catch(e){console.error('Telegram lock renewal failed:',e.message||e)}
      },RENEW_MS);
      leaseTimer.unref?.();
    }
    console.log(`Telegram polling lock acquired by ${OWNER_ID}`);
    return true;
  }catch(e){
    if(e?.code===11000) return false;
    console.error('Telegram polling lock error:',e.message||e);
    return false;
  }
}

async function releasePollingLock(){
  if(!leaseOwned || mongoose.connection.readyState!==1) return;
  leaseOwned=false;
  try{await mongoose.connection.collection('telegram_bot_locks').deleteOne({_id:LOCK_ID,owner:OWNER_ID})}catch{}
  if(leaseTimer) clearInterval(leaseTimer);
  leaseTimer=null;
}

process.once('SIGTERM',()=>{releasePollingLock().finally(()=>process.exit(0))});
process.once('SIGINT',()=>{releasePollingLock().finally(()=>process.exit(0))});

Telegraf.prototype.launch=async function(...args){
  // Keep waiting for the single polling owner instead of silently returning.
  for(;;){
    const hasLock=await acquirePollingLock();
    if(hasLock) break;
    console.log('Telegram polling lock is owned by another instance; waiting 3s...');
    await new Promise(r=>setTimeout(r,3000));
  }

  const maxAttempts=20;
  let attempt=0;
  while(attempt<maxAttempts){
    attempt++;
    try{
      // Do not discard messages that arrive during a Render restart.
      const launchArgs = (args.length && args[0] && typeof args[0]==='object')
        ? [{...args[0], dropPendingUpdates:false}, ...args.slice(1)]
        : args;
      console.log(`Starting Telegram polling attempt ${attempt}/${maxAttempts}...`);
      return await originalLaunch.call(this,...launchArgs);
    }catch(err){
      const message=err?.message||String(err);
      console.error(`Telegram launch attempt ${attempt}/${maxAttempts} failed: ${message}`);
      const conflict=/409\s*:\s*Conflict|terminated by other getUpdates request|another getUpdates worker/i.test(message);
      if(conflict){
        // A stale Render process may still own Telegram getUpdates. Release our
        // DB lease so another healthy instance can take over, then retry cleanly.
        await releasePollingLock();
        try{await this.telegram.deleteWebhook({drop_pending_updates:false})}catch{}
        const waitMs=Math.min(10000,2000+attempt*500);
        console.log(`Telegram 409 recovery: waiting ${waitMs/1000}s before reacquiring lock...`);
        await new Promise(r=>setTimeout(r,waitMs));
        for(;;){
          const ok=await acquirePollingLock();
          if(ok) break;
          await new Promise(r=>setTimeout(r,3000));
        }
        continue;
      }
      await releasePollingLock();
      if(attempt>=maxAttempts) throw err;
      await new Promise(r=>setTimeout(r,Math.min(10000,attempt*1000)));
      for(;;){
        const ok=await acquirePollingLock();
        if(ok) break;
        await new Promise(r=>setTimeout(r,3000));
      }
    }
  }
};
