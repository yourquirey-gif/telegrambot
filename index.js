const express = require("express");
const app = express();

const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const mongoose = require("mongoose");

mongoose.connect(process.env.MONGO_URI)
.then(() => {
   console.log("MongoDB Connected");
})
.catch((err) => {
   console.log(err);
});

const bot = new Telegraf("8380776869:AAHVdovNrrAMjsPwU2DRDAmkTqEQauCsdKI");

const userSchema = new mongoose.Schema({

   userId: String,

   username: String,

   credits: {
      type: Number,
      default: 3
   },

   joined: String,

   banned: {
      type: Boolean,
      default: false
   },

   referralBy: {
      type: String,
      default: null
   },

   referrals: {
      type: Number,
      default: 0
   },

   completedTasks: {
      type: Array,
      default: []
   }

});

const User = mongoose.model(
   "User",
   userSchema
);

const forceSchema = new mongoose.Schema({

   channel: String

});

const ForceChannel = mongoose.model(
   "ForceChannel",
   forceSchema
);

const adminSchema = new mongoose.Schema({

   userId: String

});

const Admin = mongoose.model(
   "Admin",
   adminSchema
);

async function loadDefaultForce(){

   const exists =
   await ForceChannel.findOne({
      channel: "@updatechannelforotp"
   });

   if(!exists){

      await ForceChannel.create({
         channel: "@updatechannelforotp"
      });

   }

}

 loadDefaultForce();

// ================= API CONFIG =================

const API_KEY = "eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE4MTAwNDkxNzksImlhdCI6MTc3ODUxMzE3OSwicmF5IjoiMjJiYjcyYTFiZWNkMjc0NTg1ZTk0MmY3MzBiZTQ3YTYiLCJzdWIiOjQwNTMwMzB9.NST5q_dk1f10pCodBRSMpp86TSSOyacUiCjceTrEC1pfTKv6MFI5e7FDoIM0ePh9As1Cbppa7rhSaEYz8gRVrW5S4UR6YIf6626OH-P7ttfJJ9doySkK4dW9zYYqvqgfHwPJmD-Thp1tssGctAznOjthywgR8dqRxxIp7xSuJ7aumBPgDr9CcfPFjQyEinZTyi98f6GMiFK4qoEoxh0j5zsBcM0HXXahHHAJ3bL88brZngso1tN7aGXBU5DDwEucNuAnEgLoiFiE76V0bdxeRNxJpml-z50dStdyq6_v2YfLxWm8_-PAUYLWXhsMtKqHT5P9We-uo_yo7ie-xFQdYw";
const API_URL = "https://5sim.net/v1/user";

// ================= SERVICES =================

const SERVICES = {
    "Telegram": "telegram",
    "WhatsApp": "whatsapp",
    "Instagram": "instagram",
    "Google/Gmail": "go",
    "Facebook": "facebook"
};

// ================= OWNER =================

const OWNER_ID = 5087094625;
const LOG_CHANNEL = "@otpadminlogchannel";

// ================= ADMINS =================



// ================= FORCE CHANNELS =================



// ================= CREDIT SETTINGS =================

let creditSettings = {
    pricePerCredit: 5,
    minimumCredits: 10,
    contact: "@YOUR_USERNAME"
       };

   const BONUS_SETTINGS = {

   referralBonus: 1,

   newUserBonus: 3

};

// ================= USERS =================



// ================= TASKS =================

let tasks = [];

// ================= CHECK ADMIN =================

async function isAdmin(userId){

   if(Number(userId) === OWNER_ID){
      return true;
   }

   const admin =
   await Admin.findOne({
      userId: String(userId)
   });

   return !!admin;

}

async function sendLog(message){

   try{

      await bot.telegram.sendMessage(
         LOG_CHANNEL,
         message,
         {
            parse_mode: "HTML"
         }
      );

   }catch(err){

      console.log("Log Error:", err.message);

   }

}

// ================= API HELPER =================

async function callApi(endpoint){
    try{
        const res = await axios.get(
            `${API_URL}${endpoint}`,
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json'
                },
                timeout: 10000 // 10 seconds timeout
            }
        );
        return res.data;
    }catch(err){
        console.log("API Error:", err.response?.data || err.message);
        return null;
    }
}

// ================= FORCE JOIN CHECK =================

async function checkForceJoin(ctx){

    const channels = await ForceChannel.find();

    let notJoined = [];

    for(const ch of channels){

        try{

            const member =
            await ctx.telegram.getChatMember(
                ch.channel,
                ctx.from.id
            );

            if(
                member.status === "left" ||
                member.status === "kicked"
            ){
                notJoined.push(ch.channel);
            }

        }catch{

            notJoined.push(ch.channel);

        }

    }

    return notJoined;

}
// ================= HOME =================

async function sendHome(ctx){
    const userId = ctx.from.id;
    const username = ctx.from.username ? "@" + ctx.from.username : ctx.from.first_name;

let user = await User.findOne({
   userId: String(userId)
});

if(!user){

   user = await User.create({

      userId: String(userId),

      username: username,

      joined:
      new Date().toLocaleString()

   });

}
   if(user.banned){

   return ctx.reply(
      "❌ You are banned from using this bot."
   );

}
    const credits = user.credits;
    let bar = "▰".repeat(Math.min(credits, 10)) + "▱".repeat(Math.max(0, 10 - credits));

    ctx.reply(
`╔══════════════════════╗
 🔥 OTP MONITOR BOT 🔥
╚══════════════════════╝

👤 USER : ${username}
🆔 USER ID : <code>${userId}</code>

💎 BALANCE : ${credits} credits
[${bar}]

⚡ COST / OTP : 1 credit
✅ Charged only if NEW OTP arrives

━━━━━━━━━━━━━━━━━━`,
{
    parse_mode:"HTML",
    ...Markup.inlineKeyboard([
        [Markup.button.callback("🟢 Online Devices", "devices")],
        [Markup.button.callback("💎 My Credits", "credits"), Markup.button.callback("🎁 Tasks", "tasks")],
        [Markup.button.callback("👥 Referral", "referral"), Markup.button.callback("🛒 Buy Credits", "buy")]
    ])
});
}

// ================= START =================

bot.start(async(ctx)=>{

    const userId = String(ctx.from.id);

    const username =
    ctx.from.username
    ? "@" + ctx.from.username
    : ctx.from.first_name;

    const referrerId =
    ctx.startPayload;

    let user =
    await User.findOne({
        userId
    });

    // ================= NEW USER =================

    if(!user){

        user = await User.create({

            userId,

            username,

            joined:
            new Date().toLocaleString(),

            credits:
            BONUS_SETTINGS.newUserBonus

        });

        // ================= REFERRAL =================

        if(
            referrerId &&
            referrerId !== userId
        ){

            const refUser =
            await User.findOne({
                userId: referrerId
            });

            if(refUser){

                refUser.credits +=
                BONUS_SETTINGS.referralBonus;

                refUser.referrals += 1;

                await refUser.save();

                user.referralBy =
                referrerId;

                await user.save();

                try{

                    await bot.telegram.sendMessage(
    referrerId,

`🎉 New referral joined!

💎 +${BONUS_SETTINGS.referralBonus} credits added`
);

                }catch{}

            }

        }

    }

    // ================= FORCE JOIN =================

    const notJoined =
    await checkForceJoin(ctx);

    if(notJoined.length > 0){

        let buttons =
        notJoined.map(c => [
            Markup.button.url(
    `📢 Join ${c}`,
                `https://t.me/${c.replace("@","")}`
            )
        ]);

        buttons.push([
            Markup.button.callback(
                "✅ Joined",
                "check_join"
            )
        ]);

        return ctx.reply(
            `🔒 Please join all channels first\n\nThen click ✅ Joined`,
            Markup.inlineKeyboard(buttons)
        );

    }
   try{

   await bot.telegram.sendMessage(

      LOG_CHANNEL,

`🆕 NEW USER JOINED

👤 Name:
${username}

🆔 User ID:
${userId}`

   );

}catch{}

    await sendHome(ctx);

});

bot.action("check_join", async(ctx)=>{
    const notJoined = await checkForceJoin(ctx);
    if(notJoined.length > 0) return ctx.answerCbQuery("❌ Still not joined all channels", { show_alert:true });
    ctx.answerCbQuery("✅ Verified");
    await sendHome(ctx);
});

// ================= DEVICES (Category Fetch) =================

bot.action("devices", async(ctx)=>{
    const user = await User.findOne({
   userId: String(ctx.from.id)
});

const credits = user.credits;
    let buttons = [];
    Object.keys(SERVICES).forEach((name)=>{
        buttons.push([Markup.button.callback(`📂 ${name}`, `buy_srv_${SERVICES[name]}`)]);
    });

    buttons.push([
        Markup.button.callback("🔄 Refresh", "devices"),
        Markup.button.callback("🏠 Home", "home")
    ]);
    


    ctx.reply(
`╔══════════════════════╗
 🟢 ONLINE CATEGORIES
╚══════════════════════╝

Select a category to get a number

💎 Credits : ${credits}

━━━━━━━━━━━━━━━━━━`,
Markup.inlineKeyboard(buttons));
});

// ================= BUY NUMBER (Number Fetch) =================

bot.action(/buy_srv_(.+)/, async(ctx)=>{
    const service = ctx.match[1];
    const userId = ctx.from.id;

    const user = await User.findOne({
   userId: String(userId)
});

if(user.credits <= 0){
   return ctx.answerCbQuery(
      "❌ No credits left",
      { show_alert:true }
   );
}

    ctx.answerCbQuery("Allocating Number...");

    // Fetching number from API (India as default)
    const order = await callApi(`/buy/activation/india/any/${service}`);

    if(!order){
        return ctx.reply("❌ No numbers available for this service right now. Please try again later.");
    }

    ctx.reply(
`╔══════════════════════╗
 📱 NUMBER ALLOCATED
╚══════════════════════╝

✅ Service : ${service.toUpperCase()}
📱 Number : <code>+${order.phone}</code>
🆔 Order ID : ${order.id}

━━━━━━━━━━━━━━━━━━
Copy number and use it. 
Then tap refresh to get OTP.`,
{
    parse_mode:"HTML",
    ...Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Check OTP / Refresh", `api_otp_${order.id}`)],
        [Markup.button.callback("❌ Cancel Order", `cancel_${order.id}`)]
    ])
});
});

// ================= CHECK OTP (OTP Fetch) =================

bot.action(/api_otp_(.+)/, async(ctx)=>{
    const orderId = ctx.match[1];
    const userId = ctx.from.id;

    ctx.answerCbQuery("Checking SMS...");
    const data = await callApi(`/check/${orderId}`);

    if(!data) return ctx.reply("❌ Order not found or expired.");

    if(data.sms && data.sms.length > 0){
        const otp = data.sms[data.sms.length - 1].code;
        const user = await User.findOne({
   userId: String(userId)
});

user.credits -= 1;

await user.save(); // Deduct only on success

        ctx.reply(
`╔══════════════════════╗
 📩 NEW OTP RECEIVED
╚══════════════════════╝

📱 Number : +${data.phone}
🔐 OTP : <code>${otp}</code>

💎 -1 Credit Deducted
💰 Remaining : ${user.credits} credits`,
{ parse_mode:"HTML" });
    } else {
        ctx.reply(
`╔══════════════════════╗
 ⚠️ NO NEW OTP
╚══════════════════════╝

Status: ${data.status}
Try again after few seconds`,
Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh Again", `api_otp_${orderId}`)]]));
    }
});

// ================= CANCEL ORDER =================

bot.action(/cancel_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    const res = await callApi(`/cancel/${orderId}`);
    ctx.answerCbQuery("Order Cancelled ✅");
    ctx.reply("❌ Order has been cancelled.");
    await sendHome(ctx);
});

// ================= CREDITS, REFERRAL, TASKS (Rest of your code) =================

bot.action("credits", async(ctx)=>{
    const userId = ctx.from.id;
    const user = await User.findOne({
   userId: String(userId)
});

const credits = user.credits;
    const totalPrice = creditSettings.minimumCredits * creditSettings.pricePerCredit;
    ctx.reply(`╔══════════════════════╗\n 💎 MY CREDIT WALLET\n╚══════════════════════╝\n\n💰 Balance : ${credits} credits\n━━━━━━━━━━━━━━━━━━\n₹${creditSettings.pricePerCredit}/credit\nMinimum : ${creditSettings.minimumCredits}\n━━━━━━━━━━━━━━━━━━\nAmount : ₹${totalPrice}\n━━━━━━━━━━━━━━━━━━\n👤 Contact : ${creditSettings.contact}`, Markup.inlineKeyboard([[Markup.button.callback("🛒 Buy Credits", "buy")]]));
});

bot.action("buy",(ctx)=>{
    ctx.reply(`💎 Buy Credits\n\n👤 Contact : ${creditSettings.contact}\n⚡ Price : ₹${creditSettings.pricePerCredit}/credit`, Markup.inlineKeyboard([[Markup.button.url("👤 Contact Admin", `https://t.me/${creditSettings.contact.replace("@","")}`)]]));
});

bot.action("referral", async(ctx)=>{

    const user =
    await User.findOne({
        userId: String(ctx.from.id)
    });

    ctx.reply(

`👥 REFERRAL SYSTEM

🔗 Your Referral Link:

https://t.me/tgfreeotpbot?start=${ctx.from.id}

━━━━━━━━━━━━━━━━━━

👥 Total Referrals:
${user.referrals}

🎁 Per Referral:
${BONUS_SETTINGS.referralBonus} credits

━━━━━━━━━━━━━━━━━━

💎 Earn unlimited credits by inviting friends.`

    );

});

bot.action("tasks", async(ctx)=>{
    if(tasks.length === 0) return ctx.reply("❌ No tasks available");
    let buttons = tasks.map(t => [Markup.button.url(`🎁 Earn ${t.credits}💎`, t.channel), Markup.button.callback("✅ Claim", `claim_${t.id}`)]);
    ctx.reply(`🎁 TASKS\n\nComplete tasks and earn credits`, Markup.inlineKeyboard(buttons));
});

bot.action(/claim_(.+)/, async(ctx)=>{
    const userId = ctx.from.id;
    const taskId = Number(ctx.match[1]);
    const task = tasks.find((t)=> t.id === taskId);
    if(!task) return ctx.reply("❌ Task not found");
    const user = await User.findOne({
   userId: String(userId)
});

if(user.completedTasks.includes(taskId)) return ctx.answerCbQuery("❌ Already claimed");
    user.credits += task.credits;

user.completedTasks.push(taskId);

await user.save();
    ctx.reply(`✅ Task completed\n💎 +${task.credits} credits added`);
});

bot.action("home", async(ctx)=>{
   await sendHome(ctx);
});

// ================= ADMIN COMMANDS =================

bot.command("setprice",(ctx)=>{
    if(!isAdmin(ctx.from.id)) return ctx.reply("❌ Admin only");
    const amount = Number(ctx.message.text.split(" ")[1]);
    if(!amount) return ctx.reply("❌ Example: /setprice 5");
    creditSettings.pricePerCredit = amount;
    ctx.reply(`✅ Price Updated: ₹${amount}`);
});

bot.command("addcredit", async (ctx) => {
    if(!isAdmin(ctx.from.id)) return ctx.reply("❌ Admin only");
    const args = ctx.message.text.split(" ");
    const userId = String(args[1]);
    const amount = Number(args[2]);
    if(!userId || !amount) return ctx.reply("❌ Example: /addcredit userid 5");
    let user = await User.findOne({
   userId: String(userId)
});

if(!user){

   user = await User.create({
      userId: String(userId),
      joined: new Date().toLocaleString()
   });

}

user.credits += amount;

await user.save();
    ctx.reply(`✅ Credits Added to ${userId}. Total: ${user.credits}`);
    try { await bot.telegram.sendMessage(userId, `🎉 ${amount} credits added! Balance: ${user.credits}`); } catch(e){}
});

bot.command("addforce", async(ctx)=>{

    if(!isAdmin(ctx.from.id))
    return;

    const channel =
    ctx.message.text.split(" ")[1];

    if(!channel){
        return ctx.reply(
            "❌ Example: /addforce @channel"
        );
    }

    const already =
    await ForceChannel.findOne({
        channel
    });

    if(already){
        return ctx.reply(
            "❌ Already added"
        );
    }

    await ForceChannel.create({
        channel
    });

    ctx.reply(
        `✅ Force channel added: ${channel}`
    );

});

bot.command("addtask", async(ctx)=>{
    if(!isAdmin(ctx.from.id)) return;
    const args = ctx.message.text.split(" ");
    if(!args[1] || !args[2]) return ctx.reply("❌ Example: /addtask link 5");
    tasks.push({ id: tasks.length + 1, channel: args[1], credits: Number(args[2]) });
    ctx.reply(`✅ Task Added`);
});
bot.command("ban", async(ctx)=>{

    if(!isAdmin(ctx.from.id))
    return ctx.reply("❌ Admin only");

    const userId =
    ctx.message.text.split(" ")[1];

    if(!userId){
        return ctx.reply(
            "❌ Example: /ban userid"
        );
    }

    const user =
    await User.findOne({
        userId: String(userId)
    });

    if(!user){
        return ctx.reply(
            "❌ User not found"
        );
    }

    user.banned = true;

    await user.save();

    ctx.reply(
        `✅ User banned:\n${userId}`
    );

    try{

        await bot.telegram.sendMessage(
            userId,
            "❌ You have been banned from the bot."
        );

    }catch{}

});

bot.command("unban", async(ctx)=>{

    if(!isAdmin(ctx.from.id))
    return ctx.reply("❌ Admin only");

    const userId =
    ctx.message.text.split(" ")[1];

    if(!userId){
        return ctx.reply(
            "❌ Example: /unban userid"
        );
    }

    const user =
    await User.findOne({
        userId: String(userId)
    });

    if(!user){
        return ctx.reply(
            "❌ User not found"
        );
    }

    user.banned = false;

    await user.save();

    ctx.reply(
        `✅ User unbanned:\n${userId}`
    );

    try{

        await bot.telegram.sendMessage(
            userId,
            "✅ You have been unbanned."
        );

    }catch{}

});

bot.command("stats", async(ctx)=>{

    if(!isAdmin(ctx.from.id))
    return;

    const totalUsers =
    await User.countDocuments();

    const users =
    await User.find();

    let totalCredits = 0;

    users.forEach((u)=>{
        totalCredits += u.credits;
    });

    ctx.reply(

`📊 BOT STATISTICS

👥 Total Users:
${totalUsers}

💎 Total Credits:
${totalCredits}

━━━━━━━━━━━━━━━━━━`

    );

});

bot.command("checkuser",(ctx)=> ctx.reply(`🆔 Your User ID: ${ctx.from.id}`));

bot.command("testlog", async(ctx)=>{

   if(ctx.from.id !== OWNER_ID)
   return;

   await sendLog(
      "✅ Test Log Working"
   );

   ctx.reply("✅ Log sent");

});

// ================= ADD ADMIN =================

bot.command("addadmin", async(ctx)=>{

    if(ctx.from.id !== OWNER_ID)
    return ctx.reply("❌ Only owner can add admins");

    const userId =
    ctx.message.text.split(" ")[1];

    if(!userId){
        return ctx.reply(
            "❌ Example: /addadmin userid"
        );
    }

    if(Number(userId) === OWNER_ID){
        return ctx.reply(
            "❌ Owner is already admin"
        );
    }

    if(ADMINS.includes(Number(userId))){
        return ctx.reply(
            "❌ User already admin"
        );
    }

    ADMINS.push(Number(userId));

    ctx.reply(
`✅ New admin added

👤 User ID:
${userId}`
    );

    try{

        await bot.telegram.sendMessage(

            userId,

`🎉 Congratulations!

You are now an admin of the bot.

✅ You now have access to:

• Ban / Unban users
• Add credits
• Broadcast
• Manage tasks
• View stats

⚠️ Note:
You cannot remove the owner.`

        );

    }catch{}

});


// ================= REMOVE ADMIN =================

bot.command("removeadmin", async(ctx)=>{

    if(ctx.from.id !== OWNER_ID)
    return ctx.reply("❌ Only owner can remove admins");

    const userId =
    ctx.message.text.split(" ")[1];

    if(!userId){
        return ctx.reply(
            "❌ Example: /removeadmin userid"
        );
    }

    if(Number(userId) === OWNER_ID){
        return ctx.reply(
            "❌ Owner cannot be removed"
        );
    }

    if(!ADMINS.includes(Number(userId))){
        return ctx.reply(
            "❌ User is not admin"
        );
    }

    ADMINS =
    ADMINS.filter(
        id => id !== Number(userId)
    );

    ctx.reply(
`✅ Admin removed

👤 User ID:
${userId}`
    );

    try{

        await bot.telegram.sendMessage(

            userId,

`❌ Your admin access has been removed.`

        );

    }catch{}

});

// ================= BROADCAST =================

bot.command("broadcast", async (ctx) => {

    if(!isAdmin(ctx.from.id))
    return ctx.reply("❌ Admin only");

    const message =
    ctx.message.text.split(" ").slice(1).join(" ");

    if(!message){
        return ctx.reply(
            "❌ Example:\n/broadcast Hello users"
        );
    }

    const users =
    await User.find();

    let success = 0;
    let failed = 0;

    ctx.reply(
        `📢 Broadcasting to ${users.length} users...`
    );

    for(const user of users){

        try{

            await bot.telegram.sendMessage(
                user.userId,
                message,
                {
                    parse_mode: "HTML"
                }
            );

            success++;

        }catch{

            failed++;

        }

    }

    ctx.reply(

`✅ Broadcast Completed

👥 Total Users:
${users.length}

✅ Success:
${success}

❌ Failed:
${failed}`

    );

});

// ================= START BOT =================

bot.launch();
console.log("BOT RUNNING WITH REAL API...");

setInterval(() => {}, 1000);
app.get("/", (req, res) => res.send("Bot running"));
app.listen(process.env.PORT || 3000);

