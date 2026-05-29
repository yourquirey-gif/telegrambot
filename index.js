const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const mongoose = require("mongoose");
const crypto = require("crypto");

mongoose.connect(process.env.MONGO_URI)
.then(() => {
   console.log("MongoDB Connected");
})
.catch((err) => {
   console.log(err);
});

const bot = new Telegraf(process.env.BOT_TOKEN);

const userSchema = new mongoose.Schema({

   userId: String,

   username: String,
   verified: {
type: Boolean,
default: false
},

ipHash: {
type: String,
default: null
},

browserInfo: {
type: String,
default: null
},

deviceType: {
type: String,
default: null
},

vpnDetected: {
type: Boolean,
default: false
},   

activeOrder: {
type: Boolean,
default: false
},

activeOrderId: {
type: String,
default: null
},   
   
totalOtp: {
type: Number,
default: 0
},   
   
pendingReferral: {
type: String,
default: null
},

rewardGiven: {
type: Boolean,
default: false
},

   credits: {
      type: Number,
      default: 1,
   min: 0
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
   },
});

const User = mongoose.model(
   "User",
   userSchema
);

const forceSchema = new mongoose.Schema({

   channel: String,

   joinLink: {
      type: String,
      default: null
   },

   title: {
      type: String,
      default: "Join Channel"
   }

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

const countrySchema = new mongoose.Schema({

    name: String,

    countryId: String,

    countryCode: String,

    servicePrices: {
        type: Object,
        default: {}
    }

});

const Country = mongoose.model(
    "Country",
    countrySchema
);

const serviceSchema = new mongoose.Schema({

    name: String,
    serviceCode: String

});

const Service = mongoose.model(
    "Service",
    serviceSchema
);
const deviceSchema = new mongoose.Schema({

    userId: String,

    fingerprint: String,

    ipHash: String,

    browserInfo: String,

    deviceType: String,

    vpnDetected: Boolean

});

const Device = mongoose.model(
    "Device",
    deviceSchema
);
const cooldowns = new Map();
const stockCache = new Map();
const priceCache = new Map();

let maintenanceMode = false;

async function checkMaintenance(ctx){

if(await isAdmin(ctx.from.id)){
return false;
}

if(maintenanceMode){

await ctx.reply(

`🛠 BOT UNDER MAINTENANCE

We're currently upgrading and improving the bot to provide a better experience.

⏳ Please wait for a while and try again later.

🙏 Thank you for your patience.`

);

return true;

}

return false;

}

let usdtRate = 86;

async function loadUsdtRate(){

const setting =
await Setting.findOne({
key: "usdtRate"
});

if(setting){

usdtRate =
Number(setting.value);

}

}

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

const VAK_API_KEY = process.env.VAK_API_KEY;
const VAK_BASE_URL = "https://vak-sms.com/v1";

// ================= OWNER =================

const OWNER_ID = 5087094625;
const LOG_CHANNEL = "@otpadminlogchannel";

// ================= ADMINS =================



// ================= FORCE CHANNELS =================



// ================= CREDIT SETTINGS =================

let creditSettings = {
    pricePerCredit: 5,
    minimumCredits: 10,
    contact: "@Quiressupportotpbot"
       };

const settingSchema = new mongoose.Schema({

   key: String,

   value: mongoose.Schema.Types.Mixed

});

const Setting = mongoose.model(
   "Setting",
   settingSchema
);
loadUsdtRate();

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

async function callVakApi(action, params = {}) {

try {

        const url = "https://vak-sms.com/stubs/handler_api.php";

        const res = await axios.get(url, {
            params: {
                api_key: VAK_API_KEY,
                action: action,
                ...params
            }
        });

        console.log("FULL RESPONSE:", res.data);

        return res.data;

    } catch (err) {

        console.log("FULL ERROR:", err.response?.data || err.message);

        return "ERROR";
    }
}

// ================= Automatic Price Feteching System =================

async function getDynamicCredits(service, countryId){

const cacheKey = `${service}_${countryId}`;

if(priceCache.has(cacheKey)){

const cached = priceCache.get(cacheKey);

if(Date.now() < cached.expire){
return cached.price;
}

priceCache.delete(cacheKey);

}

try{

const response = await axios.get(
"https://vak-sms.com/stubs/handler_api.php",
{
params:{
api_key: VAK_API_KEY,
action: "getPrices",
service,
country: countryId
}
}
);

const usdtPrice =
Number(response.data?.price || 0);

if(!usdtPrice){
return 1;
}

const inrPrice =
usdtPrice * usdtRate;

const finalInr =
inrPrice + 10;

const credits =
Math.max(
1,
Math.ceil(finalInr / 5)
);

priceCache.set(
cacheKey,
{
price: credits,
expire: Date.now() + 300000
}
);

return credits;

}catch(err){

console.log(
"Dynamic Price Error:",
err.message
);

return 3;

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
                notJoined.push(ch);
            }

        }catch{

            notJoined.push(ch);

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

⚡ COST / OTP : Depends on service
✅ Charged only if NEW OTP arrives

🏆 #Top Whole TG We Provide Cheap Numbers For Any Services

━━━━━━━━━━━━━━━━━━`,
{
    parse_mode:"HTML",
    ...Markup.inlineKeyboard([
        [Markup.button.callback("🟢 Get Number", "devices_1")],
        [Markup.button.callback("💎 My Credits", "credits"), Markup.button.callback("🎁 Tasks", "tasks")],
        [Markup.button.callback("👥 Referral", "referral"), Markup.button.callback("🛒 Buy Credits", "buy")],
        [Markup.button.callback("👤 Profile", "profile")]
    ])
});
}

// ================= START =================

bot.start(async(ctx)=>{

   if(await checkMaintenance(ctx)) return;

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

                user.pendingReferral =
referrerId;

await user.save();

                user.referralBy =
                referrerId;

                await user.save();

                try{

                  

                }catch{}

            }

        }

    }

    // ================= FORCE JOIN =================

    const notJoined =
    await checkForceJoin(ctx);

    if(notJoined.length > 0){

let buttons =
notJoined.map(c => {

const channel =
typeof c === "string"
? c
: c.channel;

if(String(channel).startsWith("-100")){

return [
Markup.button.url(
"📢 Join Channel",
"https://t.me"
)
];

}

return [
Markup.button.url(
`📢 Join ${channel}`,
`https://t.me/${String(channel).replace("@","")}`
)
];

});

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

 if(
!user.verified ||
!user.ipHash ||
!user.browserInfo
){

return ctx.reply(

`🔐 VERIFY YOURSELF

To prevent fake referrals and spam,
please verify yourself first.`,

Markup.inlineKeyboard([

[
Markup.button.url(
"✅ Verify Yourself",
`https://telegrambot-mas3.onrender.com/verify/${ctx.from.id}`
)
]

])

);

}

return sendHome(ctx);
   
});

bot.action("check_join", async(ctx)=>{

   if(await checkMaintenance(ctx)) return;

const notJoined =
await checkForceJoin(ctx);

if(notJoined.length > 0){

return ctx.answerCbQuery(
"❌ Join all channels first",
{
show_alert:true
}
);

}

const user =
await User.findOne({
userId:String(ctx.from.id)
});

if(
!user.verified ||
!user.ipHash ||
!user.browserInfo
){

return ctx.reply(

`🔐 VERIFY YOURSELF

To prevent fake referrals and spam,
please verify yourself first.`,

Markup.inlineKeyboard([

[
Markup.button.url(
"✅ Verify Yourself",
`https://telegrambot-mas3.onrender.com/verify/${ctx.from.id}`
)
]

])

);

}

ctx.answerCbQuery("✅ Verification complete");

return sendHome(ctx);

});

// ================= DEVICES (Category Fetch) =================

bot.action(/devices_(\d+)?/, async(ctx)=>{

   if(await checkMaintenance(ctx)) return;

   const user =
await User.findOne({
userId: String(ctx.from.id)
});
const page =
Number(ctx.match[1]) || 1;

const limit = 5;

const skip =
(page - 1) * limit;

const services =
await Service.find()
.skip(skip)
.limit(limit);

const total =
await Service.countDocuments();

const totalPages =
Math.ceil(total / limit);

let buttons = [];

for(const s of services){

buttons.push([
Markup.button.callback(
`📂 ${s.name}`,
`buy_srv_${s.serviceCode}_1`
)
]);

}

let nav = [];

if(page > 1){

nav.push(
Markup.button.callback(
"⬅ Previous",
`devices_${page - 1}`
)
);

}

if(page < totalPages){

nav.push(
Markup.button.callback(
"Next ➡",
`devices_${page + 1}`
)
);

}

if(nav.length > 0){
buttons.push(nav);
}

buttons.push([
Markup.button.callback(
"🏠 Home",
"home"
)
]);

ctx.reply(

`╔══════════════════════╗
 🟢 ONLINE SERVICES
╚══════════════════════╝

💎 Credits:
${user.credits}

📄 Page:
${page}/${totalPages}`,

Markup.inlineKeyboard(buttons)

);

});


// ================= SELECT COUNTRY =================

bot.action(/buy_srv_([^_]+)_(\d+)/, async (ctx) => {

   if(await checkMaintenance(ctx)) return;

const service =
String(ctx.match[1]).toLowerCase();

const page =
Number(ctx.match[2]) || 1;

const limit = 5;

const skip =
(page - 1) * limit;

let countries =
await Country.find();

countries.sort((a,b)=>
a.name.localeCompare(b.name)
);

countries =
countries.slice(skip, skip + limit);

const total =
await Country.countDocuments();

const totalPages =
Math.ceil(total / limit);

let buttons = [];
   
for(const c of countries){

let stock = "0";

const cacheKey =
`${service}_${c.countryId}`;

if(stockCache.has(cacheKey)){

const cached =
stockCache.get(cacheKey);

if(Date.now() < cached.expire){

stock = cached.stock;

}else{

stockCache.delete(cacheKey);

}

}

if(stock === "0"){

try{

const stockData =
await callVakApi(
'getNumbersStatus',
{
country: c.countryId
}
);

if(
stockData &&
typeof stockData === "object"
){

stock =
stockData[
`${service}_0`
] || "0";

stockCache.set(
cacheKey,
{
stock,
expire:
Date.now() + 30000
}
);

}

}catch{}

}

const dynamicPrice =
await getDynamicCredits(
service,
c.countryId
);

buttons.push([

Markup.button.callback(
`${c.name}  💎${dynamicPrice}  📦${stock}`,
`select_country_${service}_${c.countryId}_${c.countryCode}_${dynamicPrice}`
)

]);

}

let nav = [];

if(page > 1){

nav.push(
Markup.button.callback(
"⬅ Previous",
`buy_srv_${service}_${page - 1}`
)
);

}

if(page < totalPages){

nav.push(
Markup.button.callback(
"Next ➡",
`buy_srv_${service}_${page + 1}`
)
);

}

let bottomRow = [];

if(page > 1){

bottomRow.push(
Markup.button.callback(
"⬅ Previous",
`buy_srv_${service}_${page - 1}`
)
);

}

bottomRow.push(
Markup.button.callback(
"🏠 Home",
"home"
)
);

if(page < totalPages){

bottomRow.push(
Markup.button.callback(
"Next ➡",
`buy_srv_${service}_${page + 1}`
)
);

}

buttons.push(bottomRow);

ctx.reply(

`🌍 Select Country

📦 Service:
${service.toUpperCase()}

📄 Page:
${page}/${totalPages}`,

Markup.inlineKeyboard(buttons)

);

});

// ================= BUY NUMBER (DYNAMIC FOR ALL COUNTRIES - FIXED) =================

   bot.action(/select_country_([^_]+)_([^_]+)_([^_]+)_([^_]+)/, async (ctx) => {

      if(await checkMaintenance(ctx)) return;
      
   const userId = String(ctx.from.id);

const now = Date.now();

if(cooldowns.has(userId)){

const expiration =
cooldowns.get(userId);

if(now < expiration){

const left =
Math.ceil(
(expiration - now) / 1000
);

return ctx.answerCbQuery(

`⏳ Please wait ${left}s`,

{
show_alert:true
}

);

}

}

cooldowns.set(
userId,
now + 5000
);
    try {
        let service = ctx.match[1];
        let country = ctx.match[2];
       let countryCode = ctx.match[3];
       let price = Number(ctx.match[4]);

        const user = await User.findOne({
            userId: String(ctx.from.id)
        });

        // ================= USER CHECK =================
        if (!user) {
            return ctx.answerCbQuery("❌ User not found", { show_alert: true });
        }

        // ================= BANNED CHECK =================
        if (user.banned) {
            return ctx.answerCbQuery("❌ You are banned", { show_alert: true });
        }

        // ================= CREDIT CHECK =================

if(user.activeOrder){

if(!user.activeOrderId){

user.activeOrder = false;

await user.save();

}else{

let checkStatus =
await callVakApi(
'getStatus',
{
id: user.activeOrderId
}
);

if(
!String(checkStatus).includes("STATUS_WAIT_CODE")
){

user.activeOrder = false;
user.activeOrderId = null;

await user.save();

}

}

}

if(user.activeOrder){

return ctx.reply(

`⚠️ You already have an active order.

Please complete or cancel it first.`

);

}
        if (user.credits < price) {
            return ctx.answerCbQuery(

`❌ Not enough credits

💎 Required: ${price}
💰 Balance: ${user.credits}`,

{ show_alert: true }

);
        }

        ctx.answerCbQuery("📡 Searching Number...");
        service = service.toLowerCase();

        // ================= API REQUEST (FIXED: getNumber with capital N) =================
        let responseData = await callVakApi('getNumber', {
            service: service,
            country: country
        });

        if (responseData && typeof responseData === "string") {
            responseData = responseData.trim();
        }

        console.log(`API Request -> Country: ${country}, Service: ${service}, Response: ${responseData}`);

        // ================= SUCCESS RESPONSE =================
        if (responseData && typeof responseData === "string" && responseData.includes("ACCESS_NUMBER")) {
            const parts = responseData.split(":");

const orderId = parts[1];

user.activeOrder = true;
user.activeOrderId = orderId;

await user.save();

const phoneNumber = parts[2];

            return ctx.reply(
`╔══════════════════════╗
 📱 NUMBER ALLOCATED
╚══════════════════════╝

🌍 Country ID : ${country}
✅ Service : ${service.toUpperCase()}
📱 Number : <code>+${countryCode} ${phoneNumber.slice(countryCode.length)}</code>
🆔 Order ID : <code>${orderId}</code>

━━━━━━━━━━━━━━━━━━
Copy number and use it.
Then tap refresh to get OTP.`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🔄 Check OTP", `api_otp_${orderId}_${service}_${price}`)],
                        [Markup.button.callback("❌ Cancel", `cancel_${orderId}`)]
                    ])
                }
            );
        }
        // ================= API ERRORS HANDLING =================
        else if (responseData && responseData.includes("NO_BALANCE")) {
            return ctx.reply("❌ API wallet balance low. Please contact Admin.");
        }
        else if (responseData && (responseData.includes("NO_NUMBERS") || responseData.includes("NO_NUMBER"))) {
            return ctx.reply(
`❌ No numbers available right now.

🌍 Country ID : ${country}
📦 Service : ${service.toUpperCase()}

⏳ Try again later or choose another country.`
            );
        }
        else if (responseData && responseData.includes("BAD_KEY")) {
            return ctx.reply("❌ Invalid API Key configuration.");
        }
        else {
            return ctx.reply(
`❌ Failed to get number.
📡 API Response: <code>${responseData || "NULL"}</code>`, 
                { parse_mode: "HTML" }
            );
        }

    } catch (err) {
        console.log("BUY NUMBER ERROR:", err);
        return ctx.reply("❌ Server error while buying number.");
    }
});



// ================= OTP FETCH SYSTEM (FIXED ACTION) =================

bot.action(/api_otp_(.+)_(.+)_(.+)/, async (ctx) => {
   if(await checkMaintenance(ctx)) return;
   
    const orderId = ctx.match[1];
    const service = ctx.match[2];
   const price = Number(ctx.match[3]);
    const userId = ctx.from.id;

    const user = await User.findOne({ userId: String(userId) });

    if (!user || user.credits <= 0) {
        return ctx.reply(
            `❌ YOU DON'T HAVE ENOUGH CREDITS\n\n💎 Your Balance: 0 credits\n\n📞 Please contact admin to buy credits:\n${creditSettings.contact}`,
            {
                reply_markup: {
                    inline_keyboard: [[{ text: "🛒 Buy Credits", callback_data: "buy" }]]
                }
            }
        );
    }

    ctx.answerCbQuery("Checking SMS...");
    
    // Fixed capitalization: getStatus
    let responseData = await callVakApi('getStatus', { id: orderId });

    if (responseData && typeof responseData === 'string') {
        responseData = responseData.trim();
    }

    if (responseData && typeof responseData === 'string' && responseData.includes('STATUS_OK')) {
        const smsCode = responseData.split(':')[1]; 
user.totalOtp += 1;

       // ================= REFERRAL REWARD AFTER 2 OTP =================

if(
user.pendingReferral &&
!user.rewardGiven &&
user.totalOtp >= 2
){

const refUser =
await User.findOne({
userId: user.pendingReferral
});

if(refUser){

refUser.credits +=
BONUS_SETTINGS.referralBonus;

refUser.referrals += 1;

await refUser.save();

user.rewardGiven = true;

await user.save();

try{

await bot.telegram.sendMessage(

refUser.userId,

`🎉 Referral Completed Successfully

👤 Your referred user completed 2 OTPs

💎 +${BONUS_SETTINGS.referralBonus} credits added to your wallet.`

);

}catch{}

}

}
        user.credits = Math.max(0, user.credits - price);
       user.activeOrder = false;
       user.activeOrderId = null;
       
        await user.save();
       
        ctx.reply(`╔══════════════════════╗\n 📩 NEW OTP RECEIVED\n╚══════════════════════╝\n\n🔐 OTP : <code>${smsCode}</code>\n\n💎 -${price} Credit Deducted\n💰 Remaining : ${user.credits} credits`, { parse_mode: "HTML" });
    } else if (responseData === 'STATUS_WAIT_CODE') {
        ctx.reply("⚠️ No OTP yet. Status: Waiting for SMS...", Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh Again", `api_otp_${orderId}_${service}_${price}`)]]));
    } else {
        ctx.reply("⚠️ No OTP received yet or session expired. Try refreshing in a bit.", Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", `api_otp_${orderId}_${service}_${price}`)]]));
    }
});



// ================= CANCEL ORDER (FIXED ACTION) =================

bot.action(/cancel_(.+)/, async (ctx) => {
   if(await checkMaintenance(ctx)) return;
   
    const orderId = ctx.match[1];
    
    // Fixed capitalization: setStatus
    let responseData = await callVakApi('setStatus', { id: orderId, status: '8' });

    if (responseData && typeof responseData === 'string') {
        responseData = responseData.trim();
    }

    ctx.answerCbQuery("Processing...");
    
 if (
responseData &&
typeof responseData === 'string' &&
responseData.includes('ACCESS_CANCEL')
){

const user =
await User.findOne({
userId: String(ctx.from.id)
});

if(user){

user.activeOrder = false;
 user.activeOrderId = null;  

await user.save();

}

ctx.reply(
"❌ Order has been cancelled successfully."
);

}else{

ctx.reply(
"⚠️ Could not cancel order (It might have expired or already processed)."
);

}
    await sendHome(ctx);
});



// ================= CREDITS, REFERRAL, TASKS (Rest of your code) =================

bot.action("credits", async(ctx)=>{

if(await checkMaintenance(ctx)) return;

const userId = ctx.from.id;

const user = await User.findOne({
userId: String(userId)
});

const credits = user.credits;

const totalPrice =
creditSettings.minimumCredits *
creditSettings.pricePerCredit;

ctx.reply(

`╔══════════════════════╗
 💎 MY CREDIT WALLET
╚══════════════════════╝

💰 Balance : ${credits} credits

━━━━━━━━━━━━━━━━━━

₹${creditSettings.pricePerCredit}/credit

Minimum : ${creditSettings.minimumCredits}

━━━━━━━━━━━━━━━━━━

Amount : ₹${totalPrice}

━━━━━━━━━━━━━━━━━━

👤 Contact : ${creditSettings.contact}`,

Markup.inlineKeyboard([

[
Markup.button.callback(
"🛒 Buy Credits",
"buy"
)
],

[
Markup.button.callback(
"🏠 Home",
"home"
)
]

])

);

});

bot.action("buy", async(ctx)=>{

   if(await checkMaintenance(ctx)) return;

   ctx.reply(

`💎 Buy Credits

👤 Contact : ${creditSettings.contact}

⚡ Price : ₹${creditSettings.pricePerCredit}/credit`,

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

bot.action("referral", async(ctx)=>{
   if(await checkMaintenance(ctx)) return;

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

🎁 Reward:
${BONUS_SETTINGS.referralBonus} credits

━━━━━━━━━━━━━━━━━━

⚠️ Referral Conditions:

✅ User must verify device
✅ User must complete 2 OTPs
✅ Fake/VPN/Multi accounts are rejected

━━━━━━━━━━━━━━━━━━

💎 Invite friends and earn unlimited credits.`

);
   });

bot.action("tasks", async(ctx)=>{
   if(await checkMaintenance(ctx)) return;
    if(tasks.length === 0) return ctx.reply("❌ No tasks available");
    let buttons = tasks.map(t => [Markup.button.url(`🎁 Earn ${t.credits}💎`, t.channel), Markup.button.callback("✅ Claim", `claim_${t.id}`)]);
    ctx.reply(`🎁 TASKS\n\nComplete tasks and earn credits`, Markup.inlineKeyboard(buttons));
});

bot.action(/claim_(.+)/, async(ctx)=>{
   if(await checkMaintenance(ctx)) return;
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

bot.action("profile", async(ctx)=>{
   if(await checkMaintenance(ctx)) return;

const user =
await User.findOne({
userId: String(ctx.from.id)
});

ctx.reply(

`╔══════════════════════╗
 👤 USER PROFILE
╚══════════════════════╝

🆔 User ID :
<code>${user.userId}</code>

💎 Credits :
${user.credits}

📦 Total OTP :
${user.totalOtp || 0}

👥 Referrals :
${user.referrals}

✅ Verified :
${user.verified ? "Yes" : "No"}

📅 Joined :
${user.joined}

━━━━━━━━━━━━━━━━━━`,

{
parse_mode:"HTML",

...Markup.inlineKeyboard([

[
Markup.button.callback(
"🏠 Home",
"home"
)
]

])

}

);

});

bot.action("home", async(ctx)=>{
   if(await checkMaintenance(ctx)) return;
   await sendHome(ctx);
});

// ================= ADMIN COMMANDS =================

bot.command("maintenance", async(ctx)=>{

if(!(await isAdmin(ctx.from.id))){
return;
}

const status =
ctx.message.text.split(" ")[1];

if(!status){

return ctx.reply(

`❌ Example:

/maintenance on
/maintenance off`

);

}

if(status.toLowerCase() === "on"){

maintenanceMode = true;

return ctx.reply(
"✅ Maintenance mode enabled"
);

}

if(status.toLowerCase() === "off"){

maintenanceMode = false;

return ctx.reply(
"✅ Maintenance mode disabled"
);

}

ctx.reply(
"❌ Use only on/off"
);

});

bot.command("setprice", async(ctx)=>{
    if(!(await isAdmin(ctx.from.id))) return ctx.reply("❌ Admin only");
    const amount = Number(ctx.message.text.split(" ")[1]);
    if(!amount) return ctx.reply("❌ Example: /setprice 5");
    creditSettings.pricePerCredit = amount;
    ctx.reply(`✅ Price Updated: ₹${amount}`);
});
// ================= SET MINIMUM =================

bot.command("setminimum", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return ctx.reply("❌ Admin only");

    const amount =
    Number(ctx.message.text.split(" ")[1]);

    if(!amount){
        return ctx.reply(
            "❌ Example: /setminimum 10"
        );
    }

    creditSettings.minimumCredits =
    amount;

    ctx.reply(
`✅ Minimum credits updated

🛒 New Minimum:
${amount}`
    );

});


// ================= SET CONTACT =================

bot.command("setcontact", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return ctx.reply("❌ Admin only");

    const username =
    ctx.message.text.split(" ")[1];

    if(!username){
        return ctx.reply(
            "❌ Example: /setcontact @username"
        );
    }

    creditSettings.contact =
    username;

    ctx.reply(
`✅ Contact updated

👤 New Contact:
${username}`
    );

});

bot.command("setusdt", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

const rate =
Number(
ctx.message.text.split(" ")[1]
);

if(!rate){

return ctx.reply(

`❌ Example:

/setusdt 86`

);

}

usdtRate = rate;

await Setting.findOneAndUpdate(

{
key:"usdtRate"
},

{
value: rate
},

{
upsert:true
}

);

ctx.reply(

`✅ USDT Rate Updated

💵 1 USDT = ₹${rate}`

);

});

bot.command("addcredit", async (ctx) => {
    if(!(await isAdmin(ctx.from.id))) return ctx.reply("❌ Admin only");
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

bot.command("deductcredit", async (ctx) => {

if(!(await isAdmin(ctx.from.id)))
return ctx.reply("❌ Admin only");

const args =
ctx.message.text.split(" ");

const userId =
String(args[1]);

const amount =
Number(args[2]);

if(!userId || !amount){

return ctx.reply(

"❌ Example:\n/deductcredit userid 5"

);

}

const user =
await User.findOne({
userId
});

if(!user){

return ctx.reply(
"❌ User not found"
);

}

user.credits =
Math.max(
0,
user.credits - amount
);

await user.save();

ctx.reply(

`✅ Credits Deducted

👤 User:
${userId}

💎 Deducted:
${amount}

💰 Remaining:
${user.credits}`

);

try{

await bot.telegram.sendMessage(

userId,

`⚠️ ${amount} credits deducted

💰 Remaining balance:
${user.credits}`

);

}catch{}

});

bot.command("addforce", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

const args =
ctx.message.text.split(" ");

if(args.length < 2){

return ctx.reply(

`❌ Examples:

🌍 Public Channel:

/addforce @mychannel none Anime Updates

🔒 Private Channel:

/addforce -1001234567890 https://t.me/+abcd Premium Updates`

);

}

const channel = args[1];

const joinLink =
args[2] && args[2] !== "none"
? args[2]
: null;

const title =
args.slice(3).join(" ") || "Join Channel";

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

channel,
joinLink,
title

});

ctx.reply(

`✅ Force Channel Added

📢 Title:
${title}

🆔 Channel:
${channel}

${joinLink ? `🔗 Link:\n${joinLink}` : "🌍 Public Channel"}`

);

});
bot.command("addtask", async(ctx)=>{
    if(!(await isAdmin(ctx.from.id))) return;
    const args = ctx.message.text.split(" ");
    if(!args[1] || !args[2]) return ctx.reply("❌ Example: /addtask link 5");
    tasks.push({ id: tasks.length + 1, channel: args[1], credits: Number(args[2]) });
    ctx.reply(`✅ Task Added`);
});
// ================= REMOVE FORCE =================

bot.command("removeforce", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return ctx.reply("❌ Admin only");

    const channel =
    ctx.message.text.split(" ")[1];

    if(!channel){
        return ctx.reply(
            "❌ Example: /removeforce @channel"
        );
    }

    const exists =
    await ForceChannel.findOne({
        channel
    });

    if(!exists){
        return ctx.reply(
            "❌ Channel not found"
        );
    }

    await ForceChannel.deleteOne({
        channel
    });

    ctx.reply(
`✅ Force channel removed:

${channel}`
    );

});

// ================= REMOVE TASK =================

bot.command("removetask", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return ctx.reply("❌ Admin only");

    const taskId =
    Number(ctx.message.text.split(" ")[1]);

    if(!taskId){
        return ctx.reply(
            "❌ Example: /removetask 1"
        );
    }

    const index =
    tasks.findIndex(
        (t)=> t.id === taskId
    );

    if(index === -1){
        return ctx.reply(
            "❌ Task not found"
        );
    }

    tasks.splice(index, 1);

    ctx.reply(
`✅ Task Removed

🗑 Task ID:
${taskId}`
    );

});
bot.command("ban", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
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

    if(!(await isAdmin(ctx.from.id)))
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

// ================= ADD COUNTRY =================

bot.command("addcountry", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

const args =
ctx.message.text.split(" ");

if(args.length < 5){

return ctx.reply(

`❌ Example:

/addcountry 🇮🇳 India 22 91`

);

}

const name =
args[1] + " " + args[2];

const countryId =
args[3];

const countryCode =
args[4];

const already =
await Country.findOne({
countryId
});

if(already){

return ctx.reply(
"❌ Country already exists"
);

}

await Country.create({

name,
countryId,
countryCode

});

ctx.reply(

`✅ Country Added

🌍 ${name}

🆔 ${countryId}

📞 +${countryCode}`

);

});

// ================= REMOVE COUNTRY =================

bot.command("removecountry", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    const id =
    ctx.message.text.split(" ")[1];

    if(!id){
        return ctx.reply(
            "❌ Example:\n/removecountry 22"
        );
    }

    await Country.deleteOne({
        countryId: id
    });

    ctx.reply(
`✅ Country Removed

🆔 ${id}`
    );

});

// ================= LIST COUNTRIES =================

bot.command("countries", async(ctx)=>{

    const countries =
    await Country.find();

    if(countries.length === 0){
        return ctx.reply(
            "❌ No countries added"
        );
    }

    let text =
`🌍 COUNTRY LIST\n\n`;

    countries.forEach((c)=>{

        text +=
`${c.name}

🆔 ID: ${c.countryId}
📞 +${c.countryCode}

`;

    });

    ctx.reply(text);

});

// ================= ADD SERVICE =================

bot.command("setcountryprice", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

const args =
ctx.message.text.split(" ");

if(args.length < 4){

return ctx.reply(

`❌ Example:

/setcountryprice tg 22 5

tg = service code
22 = country id
5 = credits`

);

}

const service =
String(args[1]).toLowerCase();

const countryId =
args[2];

const price =
Number(args[3]);

const country =
await Country.findOne({
countryId
});

if(!country){

return ctx.reply(
"❌ Country not found"
);

}

country.servicePrices = {
   ...country.servicePrices,
   [service]: price
};

await country.markModified("servicePrices");

await country.save();

ctx.reply(

`✅ Price Updated

📦 Service:
${service}

🌍 Country:
${country.name}

💎 Price:
${price}`

);

});


bot.command("addservice", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    const args =
    ctx.message.text.split(" ");

    if(args.length < 3){

        return ctx.reply(
`❌ Example:

/addservice Telegram tg`
        );

    }

    const name =
    args[1];

    const serviceCode =
    args[2];

    const already =
    await Service.findOne({
        serviceCode
    });

    if(already){
        return ctx.reply(
            "❌ Service already exists"
        );
    }

    await Service.create({

        name,
        serviceCode,

    });

    ctx.reply(
`✅ Service Added

📦 ${name}
🔑 ${serviceCode}`
    );

});

// ================= REMOVE SERVICE =================


bot.command("removeservice", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    const code =
    ctx.message.text.split(" ")[1];

    if(!code){
        return ctx.reply(
            "❌ Example:\n/removeservice tg"
        );
    }

    await Service.deleteMany({
    serviceCode: code
});

    ctx.reply(
`✅ Service Removed

🔑 ${code}`
    );

});

// ================= LIST SERVICES =================

bot.command("services", async(ctx)=>{

    const services =
    await Service.find();

    if(services.length === 0){
        return ctx.reply(
            "❌ No services added"
        );
    }

    let text =
`📦 SERVICE LIST\n\n`;

    services.forEach((s)=>{

        text +=
`${s.name}

🔑 ${s.serviceCode}

`;

    });

    ctx.reply(text);

});

// ================= DEDUCT ALL USERS CREDITS =================

bot.command("deductall", async(ctx)=>{

    if(ctx.from.id !== OWNER_ID)
    return;

    const amount =
    Number(
        ctx.message.text.split(" ")[1]
    );

    if(!amount){

        return ctx.reply(
            "❌ Example:\n/deductall 2"
        );

    }

    const users =
    await User.find();

    let total = 0;

    for(const user of users){

        user.credits =
        Math.max(
            0,
            user.credits - amount
        );

        await user.save();

        total++;

    }

    ctx.reply(

`✅ Credits deducted

👥 Users:
${total}

💎 Deducted:
${amount}`

    );

});



bot.command("stats", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
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

// ================= ADMIN PANEL =================

bot.command("admin", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id))){
        return ctx.reply("❌ Admin only");
    }

    ctx.reply(

`⚙️ ADMIN PANEL

Select an option below`,

Markup.inlineKeyboard([

[
Markup.button.callback(
"📊 Stats",
"admin_stats"
)
],

[
Markup.button.callback(
"👥 Users List",
"admin_users"
)
],

[
Markup.button.callback(
"💎 Add Credit",
"admin_addcredit"
),

Markup.button.callback(
"➖ Deduct Credit",
"admin_deductcredit"
), 

Markup.button.callback(
"📢 Broadcast",
"admin_broadcast"
)
],

[
Markup.button.callback(
"🚫 Ban User",
"admin_ban"
),

Markup.button.callback(
"✅ Unban User",
"admin_unban"
)
],

[
Markup.button.callback(
"📢 Add Force",
"admin_addforce"
),

Markup.button.callback(
"❌ Remove Force",
"admin_removeforce"
)
],

[
Markup.button.callback(
"🎁 Add Task",
"admin_addtask"
),

Markup.button.callback(
"🗑 Remove Task",
"admin_removetask"
)
],

[
Markup.button.callback(
"💰 Set Price",
"admin_setprice"
),

Markup.button.callback(
"🛒 Set Minimum",
"admin_setminimum"
)
],

[
Markup.button.callback(
"💵 Set USDT",
"admin_setusdt"
)
],   

[
Markup.button.callback(
"👤 Change Contact",
"admin_setcontact"
)
],

[
Markup.button.callback(
"👑 Add Admin",
"admin_addadmin"
),

Markup.button.callback(
"❌ Remove Admin",
"admin_removeadmin"
)
],

   [
Markup.button.callback(
"🌍 Add Country",
"admin_addcountry"
),

Markup.button.callback(
"❌ Remove Country",
"admin_removecountry"
)
],

[
Markup.button.callback(
"📋 Countries",
"admin_countries"
),

Markup.button.callback(
"📦 Services",
"admin_services"
)
],

[
Markup.button.callback(
"➕ Add Service",
"admin_addservice"
),

Markup.button.callback(
"➖ Remove Service",
"admin_removeservice"
)
],

[
Markup.button.callback(
"💸 Deduct All",
"admin_deductall"
),

Markup.button.callback(
"➕ Add All",
"admin_addall"
)
],
   
[
Markup.button.callback(
"💎 Set Price for service which country",
"admin_setprice2"
)
],
[
Markup.button.callback(
"🛠 Maintenance ON",
"admin_maintenance_on"
),

Markup.button.callback(
"✅ Maintenance OFF",
"admin_maintenance_off"
)
]

])

    );

});


// ================= ADMIN BUTTON ACTIONS =================

bot.command("addall", async(ctx)=>{

    if(ctx.from.id !== OWNER_ID)
    return;

    const amount =
    Number(
        ctx.message.text.split(" ")[1]
    );

    if(!amount){

        return ctx.reply(
            "❌ Example:\n/addall 2"
        );

    }

    const users =
    await User.find();

    let total = 0;

    for(const user of users){

        user.credits += amount;

        await user.save();

        total++;

        try{

            await bot.telegram.sendMessage(

                user.userId,

`🎉 Admin added credits

💎 +${amount} credits

💰 New Balance:
${user.credits}`

            );

        }catch{}

    }

    ctx.reply(

`✅ Credits Added To All Users

👥 Users:
${total}

💎 Added:
${amount}`

    );

});

bot.action("admin_deductcredit", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(
`➖ Use Command:

/deductcredit userid amount`
);

});

bot.action("admin_users", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

const users =
await User.find();

if(users.length === 0){

return ctx.reply(
"❌ No users found"
);

}

let text =
`👥 USER LIST\n\n`;

for(const u of users){

text +=
`👤 ${u.username || "NoName"}

🆔 ${u.userId}

💎 Credits: ${u.credits}

📦 OTP: ${u.totalOtp || 0}

✅ Verified:
${u.verified ? "Yes" : "No"}

━━━━━━━━━━━━━━
`;

}

if(text.length > 4000){

const chunks =
text.match(/[\s\S]{1,4000}/g);

for(const chunk of chunks){

await ctx.reply(chunk);

}

}else{

ctx.reply(text);

}

});

bot.action("admin_addcountry", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(
`🌍 Use Command:

/addcountry 🇮🇳 India 22 91`
);

});

bot.action("admin_removecountry", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(
`❌ Use Command:

/removecountry 22`
);

});

bot.action("admin_countries", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(
`📋 Use Command:

/countries`
);

});

bot.action("admin_services", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(
`📦 Use Command:

/services`
);

});

bot.action("admin_addservice", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(
`➕ Use Command:

/addservice Telegram tg`
);

});

bot.action("admin_removeservice", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(
`➖ Use Command:

/removeservice tg`
);

});

bot.action("admin_deductall", async(ctx)=>{

if(ctx.from.id !== OWNER_ID)
return;

ctx.reply(
`💸 Use Command:

/deductall 2`
);

});

bot.action("admin_addall", async(ctx)=>{

if(ctx.from.id !== OWNER_ID)
return;

ctx.reply(
`➕ Use Command:

/addall 5`
);

});
bot.action("admin_setprice2", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(

`💎 Use Command:

/setcountryprice tg 22 5

tg = service code
22 = country id
5 = credits`

);

});

bot.action("admin_removeforce", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`❌ Use Command:

/removeforce @channel`
    );

});

bot.action("admin_removetask", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`🗑 Use Command:

/removetask taskid`
    );

});

bot.action("admin_stats", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`📊 Use Command:

/stats`
    );

});

bot.action("admin_addcredit", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`💎 Use Command:

/addcredit userid amount`
    );

});

bot.action("admin_broadcast", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`📢 Use Command:

/broadcast your message`
    );

});

bot.action("admin_ban", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`🚫 Use Command:

/ban userid`
    );

});

bot.action("admin_unban", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`✅ Use Command:

/unban userid`
    );

});

bot.action("admin_addforce", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

   ctx.reply(
`📢 Examples:

🌍 Public Channel:

/addforce @mychannel none Anime Updates

🔒 Private Channel:

/addforce -1001234567890 https://t.me/+abcd Premium Updates`
);

});

bot.action("admin_addtask", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`🎁 Use Command:

/addtask link credits`
    );

});

bot.action("admin_setprice", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`💰 Use Command:

/setprice amount`
    );

});

bot.action("admin_setusdt", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(

`💵 Use Command:

/setusdt 86`

);

});
bot.action("admin_setminimum", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`🛒 Use Command:

/setminimum amount`
    );

});

bot.action("admin_setcontact", async(ctx)=>{

    if(!(await isAdmin(ctx.from.id)))
    return;

    ctx.reply(
`👤 Use Command:

/setcontact @username`
    );

});

bot.action("admin_addadmin", async(ctx)=>{

    if(ctx.from.id !== OWNER_ID)
    return;

    ctx.reply(
`👑 Use Command:

/addadmin userid`
    );

});

bot.action("admin_removeadmin", async(ctx)=>{

    if(ctx.from.id !== OWNER_ID)
    return;

    ctx.reply(
`❌ Use Command:

/removeadmin userid`
    );

});

// ================= ADD ADMIN =================

bot.action("admin_maintenance_on", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(

`🛠 Enable Maintenance Mode

Use Command:

/maintenance on`

);

});

bot.action("admin_maintenance_off", async(ctx)=>{

if(!(await isAdmin(ctx.from.id)))
return;

ctx.reply(

`✅ Disable Maintenance Mode

Use Command:

/maintenance off`

);

});

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

    const already =
    await Admin.findOne({
        userId: String(userId)
    });

    if(already){
        return ctx.reply(
            "❌ User already admin"
        );
    }

    await Admin.create({
        userId: String(userId)
    });

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

    const admin =
    await Admin.findOne({
        userId: String(userId)
    });

    if(!admin){
        return ctx.reply(
            "❌ User is not admin"
        );
    }

    await Admin.deleteOne({
        userId: String(userId)
    });

    ctx.reply(
`✅ Admin removed

👤 User ID:
${userId}`
    );

    try{

        await bot.telegram.sendMessage(

            userId,

`⚠️ Admin Access Removed

Your admin privileges have been removed by the owner.

You are now using the bot as a normal user.

❌ You no longer have access to:

• Ban / Unban users
• Add credits
• Broadcast messages
• Manage tasks
• View admin statistics`

        );

    }catch{}

});

// ================= BROADCAST =================

bot.command("broadcast", async (ctx) => {

    if(!(await isAdmin(ctx.from.id)))
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

app.use(express.json());

bot.launch({
dropPendingUpdates: true
});
console.log("BOT RUNNING WITH REAL API...");



app.get("/verify/:id", async(req, res)=>{

const userId = req.params.id;

res.send(`

<!DOCTYPE html>
<html>

<head>

<title>Verification</title>

<meta name="viewport" content="width=device-width, initial-scale=1.0">

<script async src="https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@3/dist/fp.min.js"></script>

<style>

body{
background:#070b14;
color:white;
font-family:sans-serif;
display:flex;
justify-content:center;
align-items:center;
height:100vh;
margin:0;
overflow:hidden;
}

.box{
text-align:center;
padding:30px;
width:90%;
max-width:400px;
background:rgba(255,255,255,0.05);
border:1px solid rgba(255,255,255,0.1);
border-radius:25px;
backdrop-filter:blur(10px);
box-shadow:0 0 30px rgba(0,255,255,0.15);
animation:fadeIn 0.5s ease;
}

.loader{
width:90px;
height:90px;
border-radius:50%;
border:5px solid rgba(255,255,255,0.1);
border-top:5px solid #00ffe5;
margin:auto;
animation:spin 1s linear infinite;
box-shadow:0 0 25px #00ffe5;
}

.scan{
margin-top:25px;
font-size:20px;
font-weight:bold;
animation:pulse 1s infinite;
}

.text{
margin-top:15px;
opacity:0.8;
font-size:14px;
line-height:1.5;
}

.success{
font-size:60px;
animation:pop 0.5s ease;
}

@keyframes spin{
100%{
transform:rotate(360deg);
}
}

@keyframes pulse{
0%,100%{
opacity:1;
}
50%{
opacity:0.4;
}
}

@keyframes fadeIn{
from{
opacity:0;
transform:scale(0.9);
}
to{
opacity:1;
transform:scale(1);
}
}

@keyframes pop{
0%{
transform:scale(0);
}
100%{
transform:scale(1);
}
}

</style>

</head>

<body>

<div class="box">

<div class="loader"></div>

<div class="scan">
🔐 Verifying Device...
</div>

<div class="text">
Checking secure fingerprint<br>
Please wait...
</div>

</div>

<script>

async function verify(){

try{

const fp = await FingerprintJS.load();

const result = await fp.get();

const visitorId = result.visitorId;
console.log("Sending verification request...");
const response = await fetch("https://telegrambot-mas3.onrender.com/save-device", {

method:"POST",

headers:{
"Content-Type":"application/json"
},

body: JSON.stringify({

userId:"${userId}",

fingerprint: visitorId,

browser: navigator.userAgent,

deviceType: /Mobi|Android/i.test(navigator.userAgent)
? "Mobile"
: "Desktop"

})

});

const data = await response.json();
console.log(data);
if(data.success){

if(data.multiAccount){

document.body.innerHTML =
'<div class="box">' +
'<div class="success">⚠️</div>' +
'<h2>Multiple Accounts Detected</h2>' +
'<p>You can still use the bot,<br>but referral rewards are disabled.</p>' +
'</div>';

return;

}

document.body.innerHTML =
'<div class="box">' +
'<div class="success">✅</div>' +
'<h1>Verification Successful</h1>' +
'<p>You can now return to Telegram bot.</p>' +
'</div>';

}else{

document.body.innerHTML =
'<div class="box">' +
'<div class="success">⚠️</div>' +
'<h2>Verification Failed</h2>' +
'<p>Try another device/browser.</p>' +
'</div>';

}

}catch(err){

document.body.innerHTML =
'<div class="box">' +
'<div class="success">❌</div>' +
'<h2>Verification Error</h2>' +
'<p>Please try again later.</p>' +
'</div>';

console.log(err);

}

}

window.onload = () => {
verify();
};

</script>

</body>
</html>

`);

});


app.post("/save-device", async(req, res)=>{

try{

const crypto = require("crypto");

const {
userId,
fingerprint,
browser,
deviceType
} = req.body;

if(!userId || !fingerprint){

return res.json({
success:false
});

}

const rawIp =
(req.headers["x-forwarded-for"] || "")
.toString()
.split(",")[0]
.trim() ||
req.socket.remoteAddress ||
"unknown";

const ipHash =
crypto
.createHash("sha256")
.update(rawIp)
.digest("hex");

const suspiciousVpn =
rawIp.toLowerCase().includes("vpn") ||
rawIp.toLowerCase().includes("proxy");

const user =
await User.findOne({
userId:String(userId)
});

if(!user){

return res.json({
success:false
});

}

const alreadyUsed =
await Device.findOne({
fingerprint
});
   
const sameIp =
await User.findOne({
ipHash,
verified:true
});

let multiAccount = false;

if(
sameIp &&
sameIp.userId !== String(userId)
){

multiAccount = true;

}

if(
alreadyUsed &&
alreadyUsed.userId !== String(userId)
){

multiAccount = true;

}

if(!alreadyUsed){

await Device.create({

fingerprint,
userId,
ipHash,
browserInfo: browser,
deviceType,
vpnDetected: suspiciousVpn

});

}

user.ipHash = ipHash;
user.browserInfo = browser;
user.deviceType = deviceType;
user.vpnDetected = suspiciousVpn;
user.verified = true;

await user.save();


// ================= REFERRAL REWARD =================


return res.json({

success:true,

multiAccount,

message: multiAccount
? "Multiple accounts detected. Referral rewards disabled."
: "Verification successful"

});

}catch(err){

console.log(err);

return res.json({
success:false
});

}

});

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
   res.send("Bot running");
});

app.listen(PORT, () => {
   console.log(`Server running on port ${PORT}`);
});
