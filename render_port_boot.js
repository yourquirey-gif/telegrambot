// Render port bootstrap: bind $PORT immediately so the web service is detectable
// even while Telegram/MongoDB startup work is still initializing.
const http = require('http');
const express = require('express');

const PORT = Number(process.env.PORT || 3000);
const originalListen = express.application.listen;

if (process.env.RENDER || process.env.RENDER_SERVICE_ID) {
  let renderServer = null;
  let expressApp = null;

  const earlyHandler = (req, res) => {
    if (expressApp) return expressApp(req, res);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Starting bot...');
  };

  renderServer = http.createServer(earlyHandler);
  renderServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Render health port listening on 0.0.0.0:${PORT}`);
  });

  express.application.listen = function (...args) {
    // index.js normally calls app.listen(PORT,...). Reuse the already-open
    // Render listener instead of attempting to bind the same port twice.
    const requestedPort = args[0];
    if (requestedPort === PORT || String(requestedPort) === String(PORT)) {
      expressApp = this;
      renderServer.removeAllListeners('request');
      renderServer.on('request', expressApp);
      const callback = args.find(x => typeof x === 'function');
      if (callback) {
        if (renderServer.listening) process.nextTick(callback);
        else renderServer.once('listening', callback);
      }
      return renderServer;
    }
    return originalListen.apply(this, args);
  };
}
