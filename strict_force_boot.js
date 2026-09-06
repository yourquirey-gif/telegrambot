const mongoose = require("mongoose");
const { Telegraf, Markup } = require("telegraf");

const OWNER_ID = 5087094625;
const strictForceSchema = new mongoose.Schema({ channel: String, chatId: String, joinLink: String, title: String }, { collection: "forcechannels" });
const StrictForceChannel = mongoose.models.StrictForceChannel || mongoose.model("StrictForceChannel", strictForceSchema);
const StrictAdmin = mongoose.models.StrictAdmin || mongoose.model("StrictAdmin", new mongoose.Schema({ userId: String }, { collection: "admins" }));
const checkCache = new Map();
const CACHE_MS = 8000;

async function isStrictAdmin(userId) {
  if (Number(userId) === OWNER_ID) return true;
  return !!(await StrictAdmin.findOne({ userId: String(userId) }));
}

async function autoRegisterAdminChannel(bot, update) {
  const change = update.my_chat_member;
  if (!change?.chat || !change.new_chat_member || !['channel', 'supergroup'].includes(change.chat.type)) return false;
  const member = change.new_chat_member;
  if (member.status !== "creator" && member.status !== "administrator") return false;
  const actorId = change.from?.id;
  const chat = change.chat;

  if (member.status === "administrator" && member.can_invite_users !== true) {
    if (actorId) try { await bot.telegram.sendMessage(actorId, `❌ BOT PERMISSION MISSING\n\nThe bot is ADMIN on:\n📢 ${chat.title || chat.username || chat.id}\n\nBut it does NOT have:\n✅ Invite Users via Link\n\nPlease enable:\nChannel → Administrators → Bot → Invite Users via Link → ON\n\n⚠️ This channel cannot be used for strict force join until the permission is enabled.`); } catch {}
    return true;
  }

  try {
    const invite = await bot.telegram.createChatInviteLink(chat.id, { name: `ForceJoin-${Date.now().toString().slice(-8)}`, creates_join_request: false });
    const publicRef = chat.username ? `@${chat.username}` : String(chat.id);
    await StrictForceChannel.findOneAndUpdate({ chatId: String(chat.id) }, { channel: publicRef, chatId: String(chat.id), joinLink: invite.invite_link, title: chat.title || publicRef }, { upsert: true, new: true });
    if (actorId) try { await bot.telegram.sendMessage(actorId, `✅ FORCE JOIN AUTO-ADDED\n\n📢 ${chat.title || chat.username || chat.id}\n🆔 Chat ID: ${chat.id}\n\n🔗 Unique Invite Link:\n${invite.invite_link}\n\n🔒 Strict force join is now ACTIVE for this channel.`); } catch {}
  } catch (err) {
    if (actorId) try { await bot.telegram.sendMessage(actorId, `❌ INVITE LINK ERROR\n\nBot is ADMIN on:\n📢 ${chat.title || chat.username || chat.id}\n\nTelegram did not allow the bot to generate its unique invite link.\n\nRequired:\n✅ Bot ADMIN\n✅ Invite Users via Link permission\n\n${err.description || err.message}`); } catch {}
  }
  return true;
}

async function resolveChat(update) {
  const msg = update.message;
  if (!msg) return null;
  const origin = msg.forward_origin || msg.reply_to_message?.forward_origin;
  if (origin?.type === "channel" && origin.chat) return origin.chat;
  const parts = String(msg.text || "").trim().split(/\s+/);
  return parts[1] || null;
}

async function addForce(bot, userId, update) {
  const ref = await resolveChat(update);
  if (!ref) return bot.telegram.sendMessage(userId, `📢 ADD FORCE JOIN\n\n/addforce @channelusername\n\nFor a PRIVATE channel:\n1. Add this bot as ADMIN.\n2. Enable "Invite Users via Link" permission.\n3. Forward any message from that channel to this bot.\n4. Reply to that forwarded message with /addforce`);
  let chat;
  try { chat = await bot.telegram.getChat(ref); } catch (err) { return bot.telegram.sendMessage(userId, `❌ Channel not found or bot cannot access it.\n\n${err.description || err.message}`); }
  if (!['channel', 'supergroup'].includes(chat.type)) return bot.telegram.sendMessage(userId, "❌ Only channels/supergroups can be added to force join.");
  let me;
  try { me = await bot.telegram.getChatMember(chat.id, bot.botInfo.id); } catch { return bot.telegram.sendMessage(userId, `❌ BOT IS NOT ADMIN\n\nBot is not an administrator on:\n📢 ${chat.title || chat.username || chat.id}\n\nPlease add the bot as ADMIN and enable:\n✅ Invite Users via Link`); }
  if (me.status !== "administrator" && me.status !== "creator") return bot.telegram.sendMessage(userId, `❌ BOT IS NOT ADMIN\n\nBot is not an administrator on:\n📢 ${chat.title || chat.username || chat.id}\n\nPlease add the bot as ADMIN and enable:\n✅ Invite Users via Link`);
  if (me.status === "administrator" && me.can_invite_users !== true) return bot.telegram.sendMessage(userId, `❌ BOT PERMISSION MISSING\n\nThe bot is ADMIN, but it does not have:\n✅ Invite Users via Link\n\nOpen:\nChannel → Administrators → Bot → Invite Users via Link → ON`);
  let invite;
  try { invite = await bot.telegram.createChatInviteLink(chat.id, { name: `ForceJoin-${Date.now().toString().slice(-8)}`, creates_join_request: false }); } catch (err) { return bot.telegram.sendMessage(userId, `❌ INVITE LINK ERROR\n\nBot cannot generate a unique invite link.\n\nRequired:\n✅ Bot must be ADMIN\n✅ Invite Users via Link permission\n\n${err.description || err.message}`); }
  const publicRef = chat.username ? `@${chat.username}` : String(chat.id);
  await StrictForceChannel.findOneAndUpdate({ chatId: String(chat.id) }, { channel: publicRef, chatId: String(chat.id), joinLink: invite.invite_link, title: chat.title || publicRef }, { upsert: true, new: true });
  return bot.telegram.sendMessage(userId, `✅ FORCE JOIN ADDED\n\n📢 ${chat.title || chat.username || chat.id}\n🆔 Chat ID: ${chat.id}\n\n🔗 Unique Invite Link:\n${invite.invite_link}\n\n🔒 Strict force join is now ACTIVE.`);
}

async function strictStatus(bot, userId) {
  const channels = await StrictForceChannel.find();
  if (!channels.length) return bot.telegram.sendMessage(userId, "❌ No force-join channels configured.");
  const results = await Promise.all(channels.map(async ch => {
    let ok = false;
    try { const me = await bot.telegram.getChatMember(ch.chatId || ch.channel, bot.botInfo.id); ok = me.status === "creator" || (me.status === "administrator" && me.can_invite_users === true); } catch {}
    return `📢 ${ch.title || ch.channel}\n${ok ? "✅ Bot ADMIN + invite permission OK" : "❌ Bot must be ADMIN + Invite Users via Link"}\n🔗 ${ch.joinLink || "No link"}\n\n`;
  }));
  return bot.telegram.sendMessage(userId, "🔒 FORCE JOIN CHANNELS\n\n" + results.join(""));
}

async function sendRemoveForceMenu(bot, userId) {
  const channels = await StrictForceChannel.find().sort({ _id: 1 });
  if (!channels.length) return bot.telegram.sendMessage(userId, "🗑 REMOVE FORCE JOIN\n\n❌ No force-join channels configured.");
  const rows = channels.map(ch => [Markup.button.callback(`🗑 ${ch.title || ch.channel || ch.chatId}`, `force_rm_${ch._id}`)]);
  rows.push([Markup.button.callback("⬅ Admin Panel", "admin_panel")]);
  return bot.telegram.sendMessage(userId, "🗑 REMOVE FORCE JOIN\n\nSelect the force-join channel you want to remove:", Markup.inlineKeyboard(rows));
}

async function removeForceById(bot, userId, id) {
  const removed = await StrictForceChannel.findByIdAndDelete(id);
  if (!removed) return bot.telegram.sendMessage(userId, "❌ Force channel not found or already removed.");
  await bot.telegram.sendMessage(userId, `✅ Force channel removed:\n\n📢 ${removed.title || removed.channel || removed.chatId}`);
  return sendRemoveForceMenu(bot, userId);
}

async function removeForce(bot, userId, update) {
  const parts = String(update.message?.text || "").trim().split(/\s+/);
  if (!parts[1]) return bot.telegram.sendMessage(userId, "❌ Example: /removeforce -1001234567890");
  const ref = parts[1];
  const query = ref.startsWith("-100") ? { chatId: ref } : { $or: [{ chatId: ref }, { channel: ref }, { channel: ref.replace(/^@/, "") }] };
  const removed = await StrictForceChannel.findOneAndDelete(query);
  if (!removed) return bot.telegram.sendMessage(userId, "❌ Force channel not found.");
  return bot.telegram.sendMessage(userId, `✅ Force channel removed:\n\n${removed.title || removed.channel}`);
}

async function strictJoinPrompt(bot, userId, pending) {
  const errors = pending.filter(x => x.botError);
  if (errors.length) {
    let text = "🚫 BOT ADMIN REQUIRED\n\nThe bot needs to be ADMIN on these force-join channels:\n\n";
    for (const x of errors) text += `📢 ${x.title || x.channel}\n`;
    text += "\nRequired permission:\n✅ Invite Users via Link\n\n❌ Bot access is blocked until this is fixed.";
    return bot.telegram.sendMessage(userId, text);
  }
  const buttons = pending.filter(x => x.joinLink).map(x => [Markup.button.url(`📢 Join ${x.title || "Channel"}`, x.joinLink)]);
  buttons.push([Markup.button.callback("✅ Joined", "check_join")]);
  return bot.telegram.sendMessage(userId, "🔒 JOIN REQUIRED\n\nYou must join ALL required channels before using the bot.\n\nAfter joining every channel, press ✅ Joined.", Markup.inlineKeyboard(buttons));
}

async function strictCheck(bot, userId) {
  const key = String(userId);
  const cached = checkCache.get(key);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.pending;

  const channels = await StrictForceChannel.find().lean();
  if (!channels.length) {
    checkCache.set(key, { time: Date.now(), pending: [] });
    return [];
  }

  const pending = (await Promise.all(channels.map(async ch => {
    const chatId = ch.chatId || ch.channel;
    try {
      const me = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
      const botOk = me.status === "creator" || (me.status === "administrator" && me.can_invite_users === true);
      if (!botOk) return { ...ch, botError: true };

      let joinLink = ch.joinLink;
      if (!joinLink) {
        try {
          const invite = await bot.telegram.createChatInviteLink(chatId, { name: `ForceJoin-${Date.now().toString().slice(-8)}`, creates_join_request: false });
          joinLink = invite.invite_link;
          await StrictForceChannel.updateOne({ _id: ch._id }, { $set: { joinLink } });
        } catch {}
      }

      const member = await bot.telegram.getChatMember(chatId, userId);
      if (member.status === "left" || member.status === "kicked") return { ...ch, joinLink };
      return null;
    } catch {
      return { ...ch, botError: true };
    }
  }))).filter(Boolean);

  checkCache.set(key, { time: Date.now(), pending });
  return pending;
}

// Inject a dedicated remove button into the existing admin panel.
try {
  const Telegram = require("telegraf").Telegram;
  const originalCallApi = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async function(method, payload, ...args) {
    try {
      if (method === "sendMessage" && payload && String(payload.text || "").includes("⚙️ ADMIN PANEL") && payload.reply_markup) {
        const kb = payload.reply_markup.inline_keyboard || [];
        if (!kb.some(row => row.some(btn => btn.callback_data === "force_remove_menu"))) {
          kb.push([{ text: "🗑 Remove Force Join", callback_data: "force_remove_menu" }]);
          payload.reply_markup.inline_keyboard = kb;
        }
      }
    } catch {}
    return originalCallApi.call(this, method, payload, ...args);
  };
} catch {}

const originalHandleUpdate = Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate = async function(update, ...args) {
  try {
    if (update?.my_chat_member) {
      const handled = await autoRegisterAdminChannel(this, update);
      if (handled) return true;
    }

    const user = update?.message?.from || update?.callback_query?.from;
    const userId = user?.id;
    if (userId) {
      const text = update.message?.text || "";
      const callback = update.callback_query?.data || "";
      const isAdmin = await isStrictAdmin(userId);
      if (isAdmin && text.startsWith("/addforce")) return addForce(this, userId, update);
      if (isAdmin && text.startsWith("/forcechannels")) return strictStatus(this, userId);
      if (isAdmin && text.startsWith("/removeforce")) return removeForce(this, userId, update);

      if (isAdmin && callback === "force_remove_menu") {
        try { await this.telegram.answerCbQuery(update.callback_query.id); } catch {}
        return sendRemoveForceMenu(this, userId);
      }

      if (isAdmin && callback.startsWith("force_rm_")) {
        const id = callback.slice("force_rm_".length);
        try { await this.telegram.answerCbQuery(update.callback_query.id, "Removing..."); } catch {}
        return removeForceById(this, userId, id);
      }

      if (!isAdmin && callback === "check_join") {
        const pending = await strictCheck(this, userId);
        if (pending.length) return strictJoinPrompt(this, userId, pending);
        return originalHandleUpdate.call(this, update, ...args);
      }

      if (!isAdmin && update.message && update.message.chat?.type === "private") {
        const pending = await strictCheck(this, userId);
        if (pending.length) return strictJoinPrompt(this, userId, pending);
      }
    }
  } catch (err) {
    console.log("Strict Force Join Error:", err.message);
  }
  return originalHandleUpdate.call(this, update, ...args);
};
