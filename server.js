require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // Telegram webhook ke liye JSON body parsing

// Serve static files from the current directory
app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
        // Set correct MIME types
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        }
    }
}));

// SPA fallback — always serve index.html for any route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`✅ CaseDesk AI server running at http://localhost:${PORT}`);
});

// ── Telegram Bot (optional) ──────────────────────────────────────
// TELEGRAM_BOT_TOKEN set hai to bot automatically start hoga
if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
        const { getWebhookHandler, WEBHOOK_URL } = require('./telegram-bot');
        if (WEBHOOK_URL) {
            // Webhook mode: Express route se Telegram updates receive karo
            app.post('/telegram-webhook', getWebhookHandler());
            console.log('✅ Telegram webhook route registered: POST /telegram-webhook');
        }
    } catch (err) {
        console.error('⚠️  Telegram Bot start nahi hua:', err.message);
    }
}
