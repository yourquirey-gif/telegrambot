const express = require("express");
const app = express();

const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const bot = new Telegraf("8380776869:AAHVdovNrrAMjsPwU2DRDAmkTqEQauCsdKI");

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

// ================= ADMINS =================

let ADMINS = [
    OWNER_ID
];

// ================= FORCE CHANNELS =================

let FORCE_CHANNELS = [
    "@updatechannelforotp"
];

// ================= CREDIT SETTINGS =================

let creditSettings = {
    pricePerCredit: 5,
    minimumCredits: 10,
    contact: "@YOUR_USERNAME"
};

// ================= USERS =================

let users = {};

// ================= TASKS =================

let tasks = [];

// ================= CHECK ADMIN =================

function isAdmin(userId){
    return ADMINS.includes(userId);
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
    let notJoined = [];
    for(const channel of FORCE_CHANNELS){
        try{
            const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
            if(member.status === "left" || member.status === "kicked"){
                notJoined.push(channel);
            }
        }catch{
            notJoined.push(channel);
        }
    }
    return notJoined;
}

// ================= HOME =================

async function sendHome(ctx){
    const userId = ctx.from.id;
    const username = ctx.from.username ? "@" + ctx.from.username : ctx.from.first_name;

    if(!users[userId]){
        users[userId] = {
            credits: 3,
            joined: new Date().toLocaleString(),
            completedTasks: []
        };
    }

    const credits = users[userId].credits;
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
    const notJoined = await checkForceJoin(ctx);
    if(notJoined.length > 0){
        let buttons = notJoined.map(c => [Markup.button.url(`📢 Join ${c}`, `https://t.me/${c.replace("@","")}`)]);
        buttons.push([Markup.button.callback("✅ Joined", "check_join")]);
        return ctx.reply(`🔒 Please join all channels first\n\nThen click ✅ Joined`, Markup.inlineKeyboard(buttons));
    }
    sendHome(ctx);
});

bot.action("check_join", async(ctx)=>{
    const notJoined = await checkForceJoin(ctx);
    if(notJoined.length > 0) return ctx.answerCbQuery("❌ Still not joined all channels", { show_alert:true });
    ctx.answerCbQuery("✅ Verified");
    sendHome(ctx);
});

// ================= DEVICES (Category Fetch) =================

bot.action("devices",(ctx)=>{
    let buttons = [];
    Object.keys(SERVICES).forEach((name)=>{
        buttons.push([Markup.button.callback(`📂 ${name}`, `buy_srv_${SERVICES[name]}`)]);
    });

    buttons.push([
        Markup.button.callback("🔄 Refresh", "devices"),
        Markup.button.callback("🏠 Home", "home")
    ]);
    
    if(!users[ctx.from.id]){
        users[ctx.from.id] = { credits: 0, joined: new Date().toLocaleString(), completedTasks: [] };
    }

    ctx.reply(
`╔══════════════════════╗
 🟢 ONLINE CATEGORIES
╚══════════════════════╝

Select a category to get a number

💎 Credits : ${users[ctx.from.id].credits}

━━━━━━━━━━━━━━━━━━`,
Markup.inlineKeyboard(buttons));
});

// ================= BUY NUMBER (Number Fetch) =================

bot.action(/buy_srv_(.+)/, async(ctx)=>{
    const service = ctx.match[1];
    const userId = ctx.from.id;

    if(users[userId].credits <= 0) return ctx.answerCbQuery("❌ No credits left", { show_alert:true });

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
        users[userId].credits -= 1; // Deduct only on success

        ctx.reply(
`╔══════════════════════╗
 📩 NEW OTP RECEIVED
╚══════════════════════╝

📱 Number : +${data.phone}
🔐 OTP : <code>${otp}</code>

💎 -1 Credit Deducted
💰 Remaining : ${users[userId].credits} credits`,
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
    sendHome(ctx);
});

// ================= CREDITS, REFERRAL, TASKS (Rest of your code) =================

bot.action("credits",(ctx)=>{
    const userId = ctx.from.id;
    const credits = users[userId].credits;
    const totalPrice = creditSettings.minimumCredits * creditSettings.pricePerCredit;
    ctx.reply(`╔══════════════════════╗\n 💎 MY CREDIT WALLET\n╚══════════════════════╝\n\n💰 Balance : ${credits} credits\n━━━━━━━━━━━━━━━━━━\n₹${creditSettings.pricePerCredit}/credit\nMinimum : ${creditSettings.minimumCredits}\n━━━━━━━━━━━━━━━━━━\nAmount : ₹${totalPrice}\n━━━━━━━━━━━━━━━━━━\n👤 Contact : ${creditSettings.contact}`, Markup.inlineKeyboard([[Markup.button.callback("🛒 Buy Credits", "buy")]]));
});

bot.action("buy",(ctx)=>{
    ctx.reply(`💎 Buy Credits\n\n👤 Contact : ${creditSettings.contact}\n⚡ Price : ₹${creditSettings.pricePerCredit}/credit`, Markup.inlineKeyboard([[Markup.button.url("👤 Contact Admin", `https://t.me/${creditSettings.contact.replace("@","")}`)]]));
});

bot.action("referral",(ctx)=>{
    ctx.reply(`👥 Referral System\n\n🔗 Your Link :\nhttps://t.me/tgfreeotpbot?start=${ctx.from.id}\n🎁 1 referral = 1 credit`);
});

bot.action("tasks",(ctx)=>{
    if(tasks.length === 0) return ctx.reply("❌ No tasks available");
    let buttons = tasks.map(t => [Markup.button.url(`🎁 Earn ${t.credits}💎`, t.channel), Markup.button.callback("✅ Claim", `claim_${t.id}`)]);
    ctx.reply(`🎁 TASKS\n\nComplete tasks and earn credits`, Markup.inlineKeyboard(buttons));
});

bot.action(/claim_(.+)/,(ctx)=>{
    const userId = ctx.from.id;
    const taskId = Number(ctx.match[1]);
    const task = tasks.find((t)=> t.id === taskId);
    if(!task) return ctx.reply("❌ Task not found");
    if(users[userId].completedTasks.includes(taskId)) return ctx.answerCbQuery("❌ Already claimed");
    users[userId].credits += task.credits;
    users[userId].completedTasks.push(taskId);
    ctx.reply(`✅ Task completed\n💎 +${task.credits} credits added`);
});

bot.action("home",(ctx)=> sendHome(ctx));

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
    if(!users[userId]) users[userId] = { credits: 0, joined: new Date().toLocaleString(), completedTasks: [] };
    users[userId].credits += amount;
    ctx.reply(`✅ Credits Added to ${userId}. Total: ${users[userId].credits}`);
    try { await bot.telegram.sendMessage(userId, `🎉 ${amount} credits added! Balance: ${users[userId].credits}`); } catch(e){}
});

bot.command("addforce",(ctx)=>{
    if(!isAdmin(ctx.from.id)) return;
    const channel = ctx.message.text.split(" ")[1];
    if(!channel) return ctx.reply("❌ Example: /addforce @channel");
    if(!FORCE_CHANNELS.includes(channel)) FORCE_CHANNELS.push(channel);
    ctx.reply(`✅ Force channel added: ${channel}`);
});

bot.command("addtask",(ctx)=>{
    if(!isAdmin(ctx.from.id)) return;
    const args = ctx.message.text.split(" ");
    if(!args[1] || !args[2]) return ctx.reply("❌ Example: /addtask link 5");
    tasks.push({ id: tasks.length + 1, channel: args[1], credits: Number(args[2]) });
    ctx.reply(`✅ Task Added`);
});

bot.command("checkuser",(ctx)=> ctx.reply(`🆔 Your User ID: ${ctx.from.id}`));

// ================= START BOT =================

bot.launch();
console.log("BOT RUNNING WITH REAL API...");

setInterval(() => {}, 1000);
app.get("/", (req, res) => res.send("Bot running"));
app.listen(process.env.PORT || 3000);

