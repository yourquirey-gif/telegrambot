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

async function waitForMongo(){
  if(mongoose.connection.readyState===1)return true;
  if(mongoose.connection.readyState===0){
    try{await new Promise((resolve,reject)=>{const ok=()=>{cleanup();resolve()};const fail=e=>{cleanup();reject(e)};const cleanup=()=>{mongoose.connection.off('connected',ok);mongoose.connection.off('error',fail)};mongoose.connection.once('connected',ok);mongoose.connection.once('error',fail);setTimeout(()=>{cleanup();reject(new Error('MongoDB connection timeout while acquiring Telegram polling lock'))},20000)})}
    catch(e){console.error('Telegram polling lock: MongoDB is not ready:',e.message||e);return false}
  }
  return mongoose.connection.readyState===1;
}

async function acquirePollingLock(){
  if(!(await waitForMongo()))return false;
  const now=new Date(),leaseUntil=new Date(now.getTime()+LEASE_MS),collection=mongoose.connection.collection('telegram_bot_locks');
  try{
    const result=await collection.findOneAndUpdate({_id:LOCK_ID,$or:[{leaseUntil:{$lte:now}},{owner:OWNER_ID}]},{$set:{owner:OWNER_ID,leaseUntil,updatedAt:now},$setOnInsert:{createdAt:now}},{upsert:true,returnDocument:'after'});
    const doc=result?.value||result;leaseOwned=!!doc&&doc.owner===OWNER_ID;
    if(!leaseOwned){console.log('Telegram polling lock is owned by another Render instance; skipping bot polling on this instance.');return false}
    if(!leaseTimer){leaseTimer=setInterval(async()=>{if(!leaseOwned||mongoose.connection.readyState!==1)return;try{const r=await collection.updateOne({_id:LOCK_ID,owner:OWNER_ID},{$set:{leaseUntil:new Date(Date.now()+LEASE_MS),updatedAt:new Date()}});if(r.matchedCount!==1){leaseOwned=false;console.error('Telegram polling lock was lost; stopping polling to avoid a 409 conflict.')}}catch(e){console.error('Telegram polling lock renewal failed:',e.message||e)}},RENEW_MS);leaseTimer.unref?.()}
    console.log(`Telegram polling lock acquired by ${OWNER_ID}`);return true;
  }catch(e){if(e?.code===11000){console.log('Telegram polling lock is already owned by another Render instance; skipping bot polling.');return false}console.error('Telegram polling lock error:',e.message||e);return false}
}

async function releasePollingLock(){if(!leaseOwned||mongoose.connection.readyState!==1)return;leaseOwned=false;try{await mongoose.connection.collection('telegram_bot_locks').deleteOne({_id:LOCK_ID,owner:OWNER_ID})}catch{}if(leaseTimer)clearInterval(leaseTimer);leaseTimer=null}
process.once('SIGTERM',()=>{releasePollingLock().finally(()=>process.exit(0))});
process.once('SIGINT',()=>{releasePollingLock().finally(()=>process.exit(0))});

Telegraf.prototype.launch=async function(...args){
  const hasLock=await acquirePollingLock();
  if(!hasLock)return;
  const maxAttempts=6;let lastError;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    try{return await originalLaunch.call(this,...args)}catch(err){
      lastError=err;const message=err?.message||String(err);console.error(`Telegram launch attempt ${attempt}/${maxAttempts} failed: ${message}`);
      const conflict=/409\s*:\s*Conflict|terminated by other getUpdates request|another getUpdates worker/i.test(message);
      if(conflict){
        if(attempt<maxAttempts){
          const waitMs=Math.min(12000,4000*attempt);
          console.error(`Stale Telegram worker conflict detected; keeping polling lock and retrying in ${waitMs/1000}s...`);
          await new Promise(r=>setTimeout(r,waitMs));
          continue;
        }
        console.error('Telegram polling conflict persisted; releasing lock and stopping this instance.');
        await releasePollingLock();
        return;
      }
      if(attempt===maxAttempts)break;
      const waitMs=Math.min(15000,attempt*3000);console.log(`Retrying Telegram connection in ${waitMs/1000}s...`);await new Promise(r=>setTimeout(r,waitMs));
    }
  }
  await releasePollingLock();throw lastError;
};
