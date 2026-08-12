// ================= BUY NUMBER (VAK-SMS) =================

bot.action(/select_country_([^_]+)_([^_]+)_([^_]+)_([^_]+)/, async (ctx) => {

    if(await checkMaintenance(ctx)) return;

    const userId = String(ctx.from.id);
    const now = Date.now();

    if(cooldowns.has(userId)){
        const expiration = cooldowns.get(userId);

        if(now < expiration){
            const left = Math.ceil((expiration - now) / 1000);

            return ctx.answerCbQuery(
                `⏳ Please wait ${left}s`,
                { show_alert:true }
            );
        }
    }

    cooldowns.set(userId, now + 5000);

    try {

        let service = String(ctx.match[1]).toLowerCase();
        const country = ctx.match[2];
        const countryCode = ctx.match[3];
        const price = Number(ctx.match[4]);

        const user = await User.findOne({
            userId
        });

        if(!user){
            return ctx.answerCbQuery(
                "❌ User not found",
                { show_alert:true }
            );
        }

        if(user.banned){
            return ctx.answerCbQuery(
                "❌ You are banned",
                { show_alert:true }
            );
        }

        if(user.activeOrder){

            if(!user.activeOrderId){

                user.activeOrder = false;
                await user.save();

            }else{

                const checkStatus = await callVakApi("getStatus", {
                    id: user.activeOrderId
                });

                if(
                    typeof checkStatus === "string" &&
                    (
                        checkStatus === "STATUS_CANCEL" ||
                        checkStatus === "NO_ACTIVATION"
                    )
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

        if(user.credits < price){
            return ctx.answerCbQuery(
                `❌ Not enough credits

💎 Required: ${price}
💰 Balance: ${user.credits}`,
                { show_alert:true }
            );
        }

        await ctx.answerCbQuery("📡 Searching Number...");

        // ================== VAK-SMS BUY NUMBER ===================

        const responseData = await callVakApi("getNumber", {
            service,
            country
        });

        console.log(
            "VAK-SMS BUY RESPONSE:",
            responseData
        );

        // ================= VAK SUCCESS =================

        if(
            typeof responseData === "string" &&
            responseData.startsWith("ACCESS_NUMBER:")
        ){

            const parts = responseData.split(":");

            const orderId = parts[1];
            const phoneNumber = parts.slice(2).join(":");

            user.activeOrder = true;
            user.activeOrderId = String(orderId);

            await user.save();

            return ctx.reply(
`╔══════════════════════╗
 📱 NUMBER ALLOCATED
╚═══════════════════════╝

🌍 Country ID : ${country}
✅ Service : ${service.toUpperCase()}
📱 Number : <code>+${phoneNumber}</code>
🆔 Order ID : <code>${orderId}</code>

━━━━━━━━━━━━━━━━━━━
Copy number and use it.
Then tap Check OTP.`,
                {
                    parse_mode:"HTML",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback(
                                "❌ Cancel",
                                `cancel_${orderId}`
                            )
                        ],
                        [
                            Markup.button.callback(
                                "🔄 Check OTP",
                                `api_otp_${orderId}_${service}_${price}`
                            )
                        ],
                        [
                            Markup.button.callback(
                                "🏠 Home",
                                "home"
                            )
                        ]
                    ])
                }
            );
        }

        // =================== VAK ERROR ===================

        if(typeof responseData === "string"){
            return ctx.reply(
`❌ VAK-SMS ERROR

🌍 Country :
${country}

📦 Service : ${service.toUpperCase()}

❌ Response :
${responseData}`
            );
        }

        return ctx.reply(
`❌ No Number Available

━━━━━━━━━━━━━━━━━━━━

🌍 Country :
${country}

📦 Service : ${service.toUpperCase()}

📡 Provider :
VAK-SMS

━━━━━━━━━━━━━━

Please try again later.`
        );

    } catch(err){

        console.log(
            "BUY NUMBER ERROR:",
            err
        );

        return ctx.reply(
            "❌ Server error while buying number."
        );
    }

});



// ================= OTP FETCH SYSTEM (VAK-SMS) =================

bot.action(/api_otp_(.+)_(.+)_(.+)/, async (ctx) => {

    if(await checkMaintenance(ctx)) return;

    const orderId = ctx.match[1];
    const service = ctx.match[2];
    const price = Number(ctx.match[3]);
    const userId = String(ctx.from.id);

    const user = await User.findOne({
        userId
    });

    if(!user || user.credits <= 0){
        return ctx.reply(
            `❌ YOU DON'T HAVE ENOUGH CREDITS

💎 Your Balance: ${user?.credits || 0} credits

📞 Please contact admin to buy credits:
${creditSettings.contact}`,
            {
                reply_markup:{
                    inline_keyboard:[
                        [
                            {
                                text:"🛒 Buy Credits",
                                callback_data:"buy"
                            }
                        ]
                    ]
                }
            }
        );
    }

    await ctx.answerCbQuery("🔄 Checking OTP...");

    const responseData = await callVakApi("getStatus", {
        id: orderId
    });

    console.log(
        "VAK-SMS OTP RESPONSE:",
        responseData
    );

    if(
        typeof responseData === "string" &&
        responseData.startsWith("STATUS_OK:")
    ){

        const smsCode = responseData.split(":").slice(1).join(":");

        user.totalOtp += 1;

        if(
            user.pendingReferral &&
            !user.rewardGiven &&
            user.totalOtp >= 2
        ){

            const refUser = await User.findOne({
                userId: user.pendingReferral
            });

            if(refUser){

                refUser.credits += BONUS_SETTINGS.referralBonus;
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

        user.credits = Math.max(
            0,
            user.credits - price
        );

        user.activeOrder = false;
        user.activeOrderId = null;

        await user.save();

        return ctx.reply(
`╔══════════════════════╗
 📩 OTP RECEIVED
╚═══════════════════════╝

🔐 OTP

<code>${smsCode}</code>

━━━━━━━━━━━━━━━━━━━

💎 -${price} Credits

💰 Balance :
${user.credits}`,
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
    }

    if(responseData === "STATUS_WAIT_CODE"){

        return ctx.answerCbQuery(
            "⏳ Waiting For OTP...",
            { show_alert:true }
        );
    }

    if(
        responseData === "STATUS_CANCEL" ||
        responseData === "NO_ACTIVATION"
    ){

        user.activeOrder = false;
        user.activeOrderId = null;

        await user.save();

        return ctx.answerCbQuery(
            "⌛ Order expired or cancelled",
            { show_alert:true }
        );
    }

    return ctx.answerCbQuery(
        `❌ ${responseData || "Unable to check OTP"}`,
        { show_alert:true }
    );

});



// ================= CANCEL ORDER (VAK-SMS) =================

bot.action(/cancel_(.+)/, async (ctx) => {

    if(await checkMaintenance(ctx)) return;

    const orderId = ctx.match[1];

    await ctx.answerCbQuery("Processing...");

    const responseData = await callVakApi("setStatus", {
        id: orderId,
        status: 8
    });

    console.log(
        "VAK-SMS CANCEL RESPONSE:",
        responseData
    );

    if(
        responseData === "ACCESS_CANCEL" ||
        responseData === "STATUS_CANCEL"
    ){

        const user = await User.findOne({
            userId: String(ctx.from.id)
        });

        if(user){

            user.activeOrder = false;
            user.activeOrderId = null;

            await user.save();
        }

        await ctx.reply(
            "❌ Order has been cancelled successfully."
        );

        return sendHome(ctx);
    }

    return ctx.answerCbQuery(
        `❌ ${responseData || "Unable to cancel order."}`,
        { show_alert:true }
    );
});



// ================= COMPLETE ORDER (VAK-SMS) =================

bot.action(/finish_(.+)/, async (ctx) => {

    if(await checkMaintenance(ctx)) return;

    const orderId = ctx.match[1];

    const user = await User.findOne({
        userId: String(ctx.from.id)
    });

    if(!user){
        return ctx.answerCbQuery(
            "❌ User not found",
            { show_alert:true }
        );
    }

    const responseData = await callVakApi("setStatus", {
        id: orderId,
        status: 6
    });

    console.log(
        "VAK-SMS COMPLETE RESPONSE:",
        responseData
    );

    if(
        responseData === "ACCESS_READY" ||
        responseData === "STATUS_OK"
    ){

        user.activeOrder = false;
        user.activeOrderId = null;

        await user.save();

        try{
            await ctx.editMessageReplyMarkup({
                inline_keyboard:[]
            });
        }catch{}

        await ctx.reply(
`✅ Order Completed Successfully

🗑 Number Released Successfully.`
        );

        return sendHome(ctx);
    }

    return ctx.answerCbQuery(
        `❌ ${responseData || "Unable to complete order."}`,
        { show_alert:true }
    );

});



