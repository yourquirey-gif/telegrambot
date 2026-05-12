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
                }
            }
        );

        return res.data;

    }catch(err){

        console.log(err.response?.data || err.message);

        return null;

    }

}

// ================= FORCE JOIN CHECK =================

async function checkForceJoin(ctx){

    let notJoined = [];

    for(const channel of FORCE_CHANNELS){

        try{

            const member =
            await ctx.telegram.getChatMember(
                channel,
                ctx.from.id
            );

            if(
                member.status !== "member" &&
                member.status !== "creator" &&
                member.status !== "administrator"
            ){

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

    const username =
    ctx.from.username
    ? "@" + ctx.from.username
    : ctx.from.first_name;

    // NEW USER
    if(!users[userId]){

        users[userId] = {

            credits: 3,
            joined: new Date().toLocaleString(),
            completedTasks: []

        };

    }

    const credits = users[userId].credits;

    let bar = "";

    for(let i=0;i<credits;i++){
        bar += "▰";
    }

    for(let i=credits;i<10;i++){
        bar += "▱";
    }

    ctx.reply(

`╔══════════════════════╗
 🔥 OTP MONITOR BOT 🔥
╚══════════════════════╝

👤 USER : ${username}

🆔 USER ID :
<code>${userId}</code>

💎 BALANCE : ${credits} credits
[${bar}]

⚡ COST / OTP : 1 credit
✅ Charged only if NEW OTP arrives

━━━━━━━━━━━━━━━━━━`,

{
parse_mode:"HTML",

...Markup.inlineKeyboard([

[
Markup.button.callback(
"🟢 Online Devices",
"devices"
)
],

[
Markup.button.callback(
"💎 My Credits",
"credits"
),

Markup.button.callback(
"🎁 Tasks",
"tasks"
)
],

[
Markup.button.callback(
"👥 Referral",
"referral"
),

Markup.button.callback(
"🛒 Buy Credits",
"buy"
)
]

])

}

);

}

// ================= START =================

bot.start(async(ctx)=>{

    const notJoined =
    await checkForceJoin(ctx);

    if(notJoined.length > 0){

        let buttons = [];

        notJoined.forEach((c)=>{

            buttons.push([

                Markup.button.url(
                    `📢 Join ${c}`,
                    `https://t.me/${c.replace("@","")}`
                )

            ]);

        });

        buttons.push([

            Markup.button.callback(
                "✅ Joined",
                "check_join"
            )

        ]);

        return ctx.reply(

`🔒 Please join all channels first

Then click ✅ Joined`,

Markup.inlineKeyboard(buttons)

);

    }

    sendHome(ctx);

});

// ================= CHECK JOIN =================

bot.action("check_join", async(ctx)=>{

    const notJoined =
    await checkForceJoin(ctx);

    if(notJoined.length > 0){

        return ctx.answerCbQuery(
            "❌ Still not joined all channels",
            { show_alert:true }
        );

    }

    ctx.answerCbQuery(
        "✅ Verified"
    );

    sendHome(ctx);

});

// ================= DEVICES =================

bot.action("devices",(ctx)=>{

    let buttons = [];

    Object.keys(SERVICES).forEach((name)=>{

        buttons.push([

            Markup.button.callback(
                `📂 ${name}`,
                `buy_srv_${SERVICES[name]}`
            )

        ]);

    });

    buttons.push([

        Markup.button.callback(
            "🔄 Refresh",
            "devices"
        ),

        Markup.button.callback(
            "🏠 Home",
            "home"
        )

    ]);
    
    if(!users[ctx.from.id]){
  users[ctx.from.id] = {
    credits: 0,
    joined: new Date().toLocaleString(),
    completedTasks: []
  };
    }

    ctx.reply(

`╔══════════════════════╗
 🟢 ONLINE CATEGORIES
╚══════════════════════╝

Select a category to get a number

💎 Credits :
${users[ctx.from.id].credits}

━━━━━━━━━━━━━━━━━━`,

Markup.inlineKeyboard(buttons)

);

});

// ================= BUY NUMBER =================

bot.action(/buy_srv_(.+)/, async(ctx)=>{

    const service = ctx.match[1];

    const userId = ctx.from.id;

    if(users[userId].credits <= 0){

        return ctx.answerCbQuery(
            "❌ No credits left",
            { show_alert:true }
        );

    }

    ctx.answerCbQuery(
        "Allocating Number..."
    );

    const order =
    await callApi(
        `/buy/activation/india/any/${service}`
    );

    if(!order){

        return ctx.reply(
            "❌ No numbers available"
        );

    }

    ctx.reply(

`╔══════════════════════╗
 📱 NUMBER ALLOCATED
╚══════════════════════╝

✅ Service :
${service.toUpperCase()}

📱 Number :
<code>+${order.phone}</code>

🆔 Order ID :
${order.id}

━━━━━━━━━━━━━━━━━━

Tap refresh to get OTP`,

{
parse_mode:"HTML",

...Markup.inlineKeyboard([

[
Markup.button.callback(
"🔄 Check OTP / Refresh",
`api_otp_${order.id}`
)
],

[
Markup.button.callback(
"❌ Cancel Order",
`cancel_${order.id}`
)
]

])

}

);

});

// ================= CHECK OTP =================

bot.action(/api_otp_(.+)/, async(ctx)=>{

    const orderId = ctx.match[1];

    const userId = ctx.from.id;

    ctx.answerCbQuery(
        "Checking SMS..."
    );

    const data =
    await callApi(
        `/check/${orderId}`
    );

    if(!data){

        return ctx.reply(
            "❌ Order not found"
        );

    }

    if(data.sms && data.sms.length > 0){

        const otp =
        data.sms[data.sms.length - 1].code;

        users[userId].credits -= 1;

        ctx.reply(

`╔══════════════════════╗
 📩 NEW OTP RECEIVED
╚══════════════════════╝

📱 Number :
+${data.phone}

🔐 OTP :
<code>${otp}</code>

💎 -1 Credit Deducted

💰 Remaining :
${users[userId].credits} credits`,

{
parse_mode:"HTML"
}

);

    }else{

        ctx.reply(

`╔══════════════════════╗
 ⚠️ NO NEW OTP
╚══════════════════════╝

Try again after few seconds`,

Markup.inlineKeyboard([

[
Markup.button.callback(
"🔄 Refresh Again",
`api_otp_${orderId}`
)
]

])

);

    }

});

// ================= CREDITS =================

bot.action("credits",(ctx)=>{

    const userId = ctx.from.id;

    const credits =
    users[userId].credits;

    const totalPrice =
    creditSettings.minimumCredits *
    creditSettings.pricePerCredit;

    ctx.reply(

`╔══════════════════════╗
 💎 MY CREDIT WALLET
╚══════════════════════╝

💰 Balance :
${credits} credits

━━━━━━━━━━━━━━━━━━

₹${creditSettings.pricePerCredit}/credit

Minimum :
${creditSettings.minimumCredits}

━━━━━━━━━━━━━━━━━━

Amount :
₹${totalPrice}

━━━━━━━━━━━━━━━━━━

👤 Contact :
${creditSettings.contact}`,

Markup.inlineKeyboard([

[
Markup.button.callback(
"🛒 Buy Credits",
"buy"
)
]

])

);

});

// ================= BUY =================

bot.action("buy",(ctx)=>{

    ctx.reply(

`💎 Buy Credits

👤 Contact :
${creditSettings.contact}

⚡ Price :
₹${creditSettings.pricePerCredit}/credit`,

Markup.inlineKeyboard([

[
Markup.button.url(
"👤 Contact Admin",
`https://t.me/${creditSettings.contact.replace("@","")}`
)
]

])

);

});

// ================= REFERRAL =================

bot.action("referral",(ctx)=>{

    const userId = ctx.from.id;

    ctx.reply(

`👥 Referral System

🔗 Your Link :

https://t.me/tgfreeotpbot?start=${userId}

🎁 1 referral = 1 credit`

);

});

// ================= TASKS =================

bot.action("tasks",(ctx)=>{

    if(tasks.length === 0){

        return ctx.reply(
            "❌ No tasks available"
        );

    }

    let buttons = [];

    tasks.forEach((t)=>{

        buttons.push([

            Markup.button.url(
                `🎁 Earn ${t.credits}💎`,
                t.channel
            ),

            Markup.button.callback(
                "✅ Claim",
                `claim_${t.id}`
            )

        ]);

    });

    ctx.reply(

`🎁 TASKS

Complete tasks
and earn credits`,

Markup.inlineKeyboard(buttons)

);

});

// ================= CLAIM TASK =================

bot.action(/claim_(.+)/,(ctx)=>{

    const userId = ctx.from.id;

    const taskId =
    Number(ctx.match[1]);

    const task =
    tasks.find(
        (t)=> t.id === taskId
    );

    if(!task){

        return ctx.reply(
            "❌ Task not found"
        );

    }

    if(
        users[userId]
        .completedTasks
        .includes(taskId)
    ){

        return ctx.answerCbQuery(
            "❌ Already claimed"
        );

    }

    users[userId].credits += task.credits;

    users[userId]
    .completedTasks
    .push(taskId);

    ctx.reply(

`✅ Task completed

💎 +${task.credits} credits added`

);

});

// ================= HOME =================

bot.action("home",(ctx)=>{

    sendHome(ctx);

});

// ================= ADMIN COMMANDS =================

// SET PRICE
bot.command("setprice",(ctx)=>{

    if(!isAdmin(ctx.from.id)) {

        return ctx.reply("❌ You are not admin");

    }

    const amount =
    Number(
        ctx.message.text.split(" ")[1]
    );

    if(!amount){

        return ctx.reply(
            "❌ Example:\n/setprice 5"
        );

    }

    creditSettings.pricePerCredit =
    amount;

    ctx.reply(
`✅ Price Updated

₹${amount} per credit`
);

});

// SET MINIMUM
bot.command("setmin",(ctx)=>{

    if(!isAdmin(ctx.from.id)) {

        return ctx.reply("❌ You are not admin");

    }

    const amount =
    Number(
        ctx.message.text.split(" ")[1]
    );

    if(!amount){

        return ctx.reply(
            "❌ Example:\n/setmin 10"
        );

    }

    creditSettings.minimumCredits =
    amount;

    ctx.reply(
`✅ Minimum Updated`
);

});

// SET CONTACT
bot.command("setcontact",(ctx)=>{

    if(!isAdmin(ctx.from.id)) {

        return ctx.reply("❌ You are not admin");

    }

    const username =
    ctx.message.text.split(" ")[1];

    if(!username){

        return ctx.reply(
            "❌ Example:\n/setcontact @username"
        );

    }

    creditSettings.contact =
    username;

    ctx.reply(
`✅ Contact Updated`
);

});

// ADD CREDIT
bot.command("addcredit", async (ctx) => {

    if(!isAdmin(ctx.from.id)) {

        return ctx.reply("❌ You are not admin");

    }

    const args =
    ctx.message.text.split(" ");

    const userId =
    String(args[1]);

    const amount =
    Number(args[2]);

    if(!userId || !amount){

        return ctx.reply(
            "❌ Example:\n/addcredit userid 5"
        );

    }

    // AUTO CREATE USER
    if(!users[String(userId)]){

        users[String(userId)] = {

            credits: 0,
            joined: new Date().toLocaleString(),
            completedTasks: []

        };

    }

    users[String(userId)].credits += amount;

    // ADMIN MESSAGE
    ctx.reply(

`✅ Credits Added

👤 User :
${userId}

💎 Added :
${amount}

🪙 Total :
${users[String(userId)].credits}`

    );

    // USER NOTIFICATION
    try{

        await bot.telegram.sendMessage(

            userId,

`🎉 Congratulations!

💎 ${amount} credits added
to your account.

🪙 Current Balance :
${users[String(userId)].credits} credits`

        );

    }catch(err){

        console.log(
            "User notification failed"
        );

    }

});

// ================= ADMIN LIST =================

bot.command("admins",(ctx)=>{

    if(!isAdmin(ctx.from.id)) {

        return ctx.reply("❌ You are not admin");

    }

    let text = "👑 ADMIN LIST\n\n";

    ADMINS.forEach((id,index)=>{

        text += `${index + 1}. ${id}\n`;

    });

    ctx.reply(text);

});

// ================= ADD FORCE CHANNEL =================

bot.command("addforce",(ctx)=>{

    if(!isAdmin(ctx.from.id)) {

        return ctx.reply("❌ You are not admin");

    }

    const channel =
    ctx.message.text.split(" ")[1];

    if(!channel){

        return ctx.reply(
            "❌ Example:\n/addforce @channel"
        );

    }

    if(FORCE_CHANNELS.includes(channel)){

        return ctx.reply(
            "⚠️ Channel already added"
        );

    }

    FORCE_CHANNELS.push(channel);

    ctx.reply(
`✅ Force channel added

${channel}`
);

});

// ================= ADD TASK =================

bot.command("addtask",(ctx)=>{

    if(!isAdmin(ctx.from.id)) {

        return ctx.reply("❌ You are not admin");

    }

    const args =
    ctx.message.text.split(" ");

    const link = args[1];

    const credits =
    Number(args[2]);

    if(!link || !credits){

        return ctx.reply(
            "❌ Example:\n/addtask https://t.me/channel 5"
        );

    }

    tasks.push({

        id: tasks.length + 1,
        channel: link,
        credits: credits

    });

    ctx.reply(
`✅ Task Added`
);

});
// ================= CHECK USER =================

bot.command("checkuser",(ctx)=>{

    ctx.reply(

`🆔 Your User ID:

${ctx.from.id}`

);

});
// REMOVE FORCE CHANNEL
bot.command("removeforce", (ctx) => {

    if(!isAdmin(ctx.from.id)) return;

    const channel =
    ctx.message.text.split(" ")[1];

    if(!channel){

        return ctx.reply(
            "❌ Example:\n/removeforce @channel"
        );

    }

    FORCE_CHANNELS =
    FORCE_CHANNELS.filter(
        c => c !== channel
    );

    ctx.reply(
`✅ Force channel removed

${channel}`
    );

});

// TASK LIST
bot.command("taskslist",(ctx)=>{

    if(!isAdmin(ctx.from.id)) return;

    if(tasks.length === 0){

        return ctx.reply(
            "❌ No tasks"
        );

    }

    let text = "🎁 TASK LIST\n\n";

    tasks.forEach((t)=>{

        text +=
`ID: ${t.id}
Link: ${t.channel}
Credits: ${t.credits}

`;

    });

    ctx.reply(text);

});

// REMOVE TASK
bot.command("removetask",(ctx)=>{

    if(!isAdmin(ctx.from.id)) return;

    const id =
    Number(
        ctx.message.text.split(" ")[1]
    );

    if(!id){

        return ctx.reply(
            "❌ Example:\n/removetask 1"
        );

    }

    tasks =
    tasks.filter(t => t.id !== id);

    ctx.reply(`✅ Task removed
ID: ${id}`);

});
bot.command("removechannel", (ctx) => {

    if(!isAdmin(ctx.from.id)){

        return ctx.reply(
            "❌ Admin only"
        );

    }

    const channel =
    ctx.message.text.split(" ")[1];

    if(!channel){

        return ctx.reply(
            "❌ Example:\n/removechannel @channel"
        );

    }

    FORCE_CHANNELS =
    FORCE_CHANNELS.filter(
        c => c !== channel
    );

    ctx.reply(
`✅ Removed ${channel}`
    );

});

// ================= START BOT =================

bot.launch();

console.log("BOT RUNNING...");
// KEEP ALIVE FOR RENDER
setInterval(() => {}, 1000);
