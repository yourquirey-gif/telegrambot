const { Telegram } = require('telegraf');

// User-facing messages must expose only generic Server 1 / Server 2 labels.
// Admin configuration messages are intentionally left unchanged.
function cleanUserText(text) {
  let t = String(text || '');
  const userFlow = /NUMBER ALLOCATED|Searching (?:5SIM|VAK-SMS) number|Provider\s*:\s*VAK-SMS|5SIM ERROR|VAK-SMS ERROR|5SIM did not return|VAK-SMS ERROR/i.test(t);
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
  return t;
}

try {
  const originalCallApi = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async function(method, payload, ...args) {
    try {
      if (method === 'sendMessage' && payload) {
        const original = String(payload.text || '');
        const cleaned = cleanUserText(original);
        if (cleaned !== original) payload.text = cleaned;
      }
    } catch (e) {
      console.log('Server privacy hook error:', e.message);
    }
    return originalCallApi.call(this, method, payload, ...args);
  };
} catch (e) {
  console.log('Server privacy boot error:', e.message);
}
