const { Telegram } = require('telegraf');

// User-facing order messages expose only generic Server 1 / Server 2 labels.
// Currency is displayed only as INR (₹); the legacy DB field can remain internally.
function cleanUserText(text) {
  let t = String(text || '');

  const userFlow = /NUMBER ALLOCATED|Searching (?:5SIM|VAK-SMS) number|Provider\s*:\s*(?:5SIM|VAK-SMS)|(?:5SIM|VAK-SMS)\s+(?:ERROR|order cancelled|did not return)|(?:5SIM|VAK-SMS)\s+(?:OTP|order)/i.test(t);
  const purchaseLog = t.includes('📅 New Purchase Success');

  if (userFlow) {
    t = t.replace(/Searching\s+5SIM\s+number/gi, 'Searching Number');
    t = t.replace(/Searching\s+VAK-SMS\s+number/gi, 'Searching Number');
    t = t.replace(/🖥\s*Server\s*:\s*5SIM/gi, '🖥 Server : Server 1');
    t = t.replace(/🖥\s*Server\s*:\s*VAK-SMS/gi, '🖥 Server : Server 2');
    t = t.replace(/📡\s*Provider\s*:\s*5SIM/gi, '🖥 Server : Server 1');
    t = t.replace(/📡\s*Provider\s*:\s*VAK-SMS/gi, '🖥 Server : Server 2');
    t = t.replace(/❌\s*5SIM\s+ERROR/gi, '❌ Server 1 ERROR');
    t = t.replace(/❌\s*VAK-SMS\s+ERROR/gi, '❌ Server 2 ERROR');
    t = t.replace(/❌\s*5SIM did not return a number/gi, '❌ Server 1 did not return a number');
    t = t.replace(/❌\s*VAK-SMS did not return a number/gi, '❌ Server 2 did not return a number');
    t = t.replace(/❌\s*5SIM order cancelled/gi, '❌ Server 1 order cancelled');
    t = t.replace(/❌\s*VAK-SMS order cancelled/gi, '❌ Server 2 order cancelled');
    t = t.replace(/\b5SIM\b/gi, 'Server 1');
    t = t.replace(/\bVAK-SMS\b/gi, 'Server 2');
  }

  if (purchaseLog) {
    const m = t.match(/Order ID\s*:\s*([^\n]+)/i);
    const id = m?.[1]?.trim() || '';
    const server = id.startsWith('5s:') ? 'Server 1' : id.startsWith('vk:') ? 'Server 2' : '';
    if (server && !/\nServer\s*:/i.test(t)) {
      t = t.replace(/(📅 New Purchase Success\s*\n\n)/, `$1Server: ${server}\n`);
    }
    t = t.replace(/\b5SIM\b/gi, 'Server 1').replace(/\bVAK-SMS\b/gi, 'Server 2');
  }

  // Legacy credit wording -> direct rupee wording.
  t = t.replace(/(\d+(?:\.\d+)?)\s*credits\b/gi, '₹$1');
  t = t.replace(/(\d+(?:\.\d+)?)\s*credit\b/gi, '₹$1');
  t = t.replace(/(Required\s*:\s*)₹?([0-9]+(?:\.[0-9]+)?)/gi, '$1₹$2');
  t = t.replace(/(Balance\s*:\s*)₹?([0-9]+(?:\.[0-9]+)?)/gi, '$1₹$2');
  t = t.replace(/(Price\s*:\s*)₹?([0-9]+(?:\.[0-9]+)?)/gi, '$1₹$2');
  t = t.replace(/(Cost\s*\/\s*OTP\s*:\s*)₹?([0-9]+(?:\.[0-9]+)?)/gi, '$1₹$2');
  t = t.replace(/Credits\s+deducted/gi, 'Balance deducted');
  t = t.replace(/My Credits/gi, 'My Balance');
  t = t.replace(/Buy Credits/gi, 'Add Balance');
  t = t.replace(/\bcredits\b/gi, 'balance');
  t = t.replace(/\bcredit\b/gi, 'balance');

  if (/💎\s*BALANCE\s*:/i.test(t)) t = t.replace(/💎\s*BALANCE\s*:/gi, '💰 BALANCE :');
  return t;
}

try {
  const originalCallApi = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async function(method, payload, ...args) {
    try {
      if (payload) {
        if (typeof payload.text === 'string') payload.text = cleanUserText(payload.text);
        if (typeof payload.caption === 'string') payload.caption = cleanUserText(payload.caption);
        if (payload.reply_markup?.inline_keyboard) {
          for (const row of payload.reply_markup.inline_keyboard) {
            for (const button of row) {
              if (typeof button.text === 'string') button.text = cleanUserText(button.text);
            }
          }
        }
      }
    } catch (e) {
      console.log('UI currency hook error:', e.message);
    }
    return originalCallApi.call(this, method, payload, ...args);
  };
} catch (e) {
  console.log('UI currency boot error:', e.message);
}
