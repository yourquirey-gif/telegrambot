const mongoose = require("mongoose");
const { Telegraf, Markup } = require("telegraf");

const OWNER_ID = 5087094625;

const strictForceSchema = new mongoose.Schema({
  channel: String,
  chatId: String,
  joinLink: String,
  title: String
}, { collection: "forcechannels" });

const StrictForceChannel = mongoose.models.StrictForceChannel || mongoose.model("StrictForceChannel", strictForceSchema);
const StrictAdmin = mongoose.models.StrictAdmin || mongoose.model("StrictAdmin", new mongoose.Schema({ userId: String }, { collection: "admins" }));

async function isStrictAdmin(userId) {
  if (Number(userId) === OWNER_ID) return true;
  return !!(await StrictAdmin.findOne({ userId: String(userId) }));
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
  if (!ref) {
    return bot.telegram.sendMessage(userId,
`📢 ADD FORCE JOIN

/addforce @channelusername

For a PRIVATE channel:
1. Add this bot as ADMIN.
2. Enable "Invite Users via Link" permission.
3. Forward any message from that channel to this bot.
4. Reply to that forwarded message with /addforce`);
  }

  let chat;
  try {
    chat = await bot.telegram.getChat(ref);
  } catch (err) {
    return bot.telegram.sendMessage(userId, `❌ Channel not found or bot cannot access it.\n\n${err.description || err.message}`);
  }

  if (!['channel', 'supergroup'].includes(chat.type)) {
    return bot.telegram.sendMessage(userId, "❌ Only channels/supergroups can be added to force join.");
  }

  let me;
  try {
    me = await bot.telegram.getChatMember(chat.id, bot.botInfo.id);
  } catch {
    return bot.telegram.sendMessage(userId,
`❌ BOT IS NOT ADMIN

Bot is not an administrator on:
📢 ${chat.title || chat.username || chat.id}

Please add the bot as ADMIN and enable:
✅ Invite Users via Link`);
  }

  if (me.status !== "administrator" && me.status !== "creator") {
    return bot.telegram.sendMessage(userId,
`❌ BOT IS NOT ADMIN

Bot is not an administrator on:
📢 ${chat.title || chat.username || chat.id}

Please add the bot as ADMIN and enable:
✅ Invite Users via Link`);
  }

  if (me.status === "administrator" && me.can_invite_users !== true) {
    return bot.telegram.sendMessage(userId,
`❌ BOT PERMISSION MISSING

The bot is ADMIN, but it does not have:
✅ Invite Users via Link

Open:
Channel → Administrators → Bot → Invite Users via Link → ON`);
  }

  let invite;
  try {
    invite = await bot.telegram.createChatInviteLink(chat.id, {
      name: `ForceJoin-${Date.now().toString().slice(-8)}`,
      creates_join_request: false
    });
  } catch (err) {
    return bot.telegram.sendMessage(userId,
`❌ INVITE LINK ERROR

Bot cannot generate a unique invite link.

Required:
✅ Bot must be ADMIN
✅ Invite Users via Link permission

${err.description || err.message}`);
  }

  const publicRef = chat.username ? `@${chat.username}` : String(chat.id);
  await StrictForceChannel.findOneAndUpdate(
    { chatId: String(chat.id) },
    {
      channel: publicRef,
      chatId: String(chat.id),
      joinLink: invite.invite_link,
      title: chat.title || publicRef
    },
    { upsert: true, new: true }
  );

  return bot.telegram.sendMessage(userId,
`✅ FORCE JOIN ADDED

📢 ${chat.title || chat.username || chat.id}
🆔 Chat ID: ${chat.id}

🔗 Unique Invite Link:
${invite.invite_link}

🔒 Strict force join is now ACTIVE.`);
}

async function strictStatus(bot, userId) {
  const channels = await StrictForceChannel.find();
  if (!channels.length) return bot.telegram.sendMessage(userId, "❌ No force-join channels configured.");
  let out = "🔒 FORCE JOIN CHANNELS\n\n";
  for (const ch of channels) {
    let ok = false;
    try {
      const me = await bot.telegram.getChatMember(ch.chatId || ch.channel, bot.botInfo.id);
      ok = me.status === "creator" || (me.status === "administrator" && me.can_invite_users === true);
    } catch {}
    out += `📢 ${ch.title || ch.channel}\n${ok ? "✅ Bot ADMIN + invite permission OK" : "❌ Bot must be ADMIN + Invite Users via Link"}\n🔗 ${ch.joinLink || "No link"}\n\n`;
  }
  return bot.telegram.sendMessage(userId, out);
}

async function removeForce(bot, userId, update) {
  const parts = String(update.message?.text || "").trim().split(/\s+/);
  if (!parts[1]) return bot.telegram.sendMessage(userId, "❌ Example: /removeforce -1001234567890");
  const ref = parts[1];
  const query = ref.startsWith("-100")
    ? { chatId: ref }
    : { $or: [{ chatId: ref }, { channel: ref }, { channel: ref.replace(/^@/, "") }] };
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

  const buttons = pending.map(x => [
    Markup.button.url(`📢 Join ${x.title || "Channel"}`, x.joinLink)
  ]);
  buttons.push([Markup.button.callback("✅ Joined", "check_join")]);
  return bot.telegram.sendMessage(
    userId,
    "🔒 JOIN REQUIRED\n\nYou must join ALL required channels before using the bot.\n\nAfter joining every channel, press ✅ Joined.",
    Markup.inlineKeyboard(buttons)
  );
}

async function strictCheck(bot, userId) {
  const channels = await StrictForceChannel.find();
  const pending = [];
  for (const ch of channels) {
    const chatId = ch.chatId || ch.channel;
    try {
      const me = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
      const botOk = me.status === "creator" || (me.status === "administrator" && me.can_invite_users === true);
      if (!botOk) {
        pending.push({ ...ch.toObject(), botError: true });
        continue;
      }
      const member = await bot.telegram.getChatMember(chatId, userId);
      if (member.status === "left" || member.status === "kicked") pending.push(ch);
    } catch {
      pending.push({ ...ch.toObject(), botError: true });
    }
  }
  return pending;
}

const originalHandleUpdate = Telegraf.prototype.handleUpdate;
Telegraf.prototype.handleUpdate = async function(update, ...args) {
  try {
    const user = update?.message?.from || update?.callback_query?.from;
    const userId = user?.id;
    if (userId) {
      const text = update.message?.text || "";
      const callback = update.callback_query?.data || "";
      const isAdmin = await isStrictAdmin(userId);

      if (isAdmin && text.startsWith("/addforce")) {
        return addForce(this, userId, update);
      }
      if (isAdmin && text.startsWith("/forcechannels")) {
        return strictStatus(this, userId);
      }
      if (isAdmin && text.startsWith("/removeforce")) {
        return removeForce(this, userId, update);
      }

      if (!isAdmin && callback === "check_join") {
        return originalHandleUpdate.call(this, update, ...args);
      }

      if (!isAdmin && update.message && update.message.chat?.type === "private") {
        const pending = await strictCheck(this, userId);
        if (pending.length) {
          return strictJoinPrompt(this, userId, pending);
        }
      }
    }
  } catch (err) {
    console.log("Strict Force Join Error:", err.message);
  }
  return originalHandleUpdate.call(this, update, ...args);
};
