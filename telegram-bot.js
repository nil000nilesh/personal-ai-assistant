// telegram-bot.js — CaseDesk AI Telegram Bot
// Polling mode: local/VPS pe run karo
// Webhook mode: WEBHOOK_URL env var set karo (Render/Railway ke liye)

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const OpenAI = require('openai');
const cron = require('node-cron');

// ── Firebase Admin Init ──────────────────────────────────────────
let serviceAccount;
try {
    // Option 1: JSON string in env var
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        // Option 2: JSON file in project root
        serviceAccount = require('./firebase-service-account.json');
    }
} catch (e) {
    console.error('❌ Firebase service account nahi mila.');
    console.error('   FIREBASE_SERVICE_ACCOUNT env var set karo ya firebase-service-account.json file rakho.');
    console.error('   Setup guide: README ke Telegram Bot section mein dekho.');
    process.exit(1);
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
    });
}
const db = getFirestore();

// ── Telegram Bot Init ────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN env var missing hai. .env file mein set karo.');
    process.exit(1);
}

const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Webhook mode: Express ke saath integrate — apna server start NAHI karta
// Polling mode: local dev ke liye
const bot = WEBHOOK_URL
    ? new TelegramBot(BOT_TOKEN, { webHook: false })
    : new TelegramBot(BOT_TOKEN, { polling: true });

if (WEBHOOK_URL) {
    bot.setWebHook(`${WEBHOOK_URL}/telegram-webhook`)
        .then(() => console.log(`✅ Telegram Bot webhook set: ${WEBHOOK_URL}/telegram-webhook`))
        .catch(err => console.error('❌ Webhook set failed:', err.message));
} else {
    console.log('✅ Telegram Bot polling mode mein chal raha hai...');
}

// ── OpenAI Client (key Firestore se fetch hoga) ──────────────────
let openaiClient = null;
let openaiModel = 'gpt-4.1';

async function getOpenAIClient() {
    if (openaiClient) return openaiClient;
    try {
        const keyDoc = await db.collection('system_settings').doc('api_config').get();
        if (!keyDoc.exists || !keyDoc.data().openai_key) {
            throw new Error('OpenAI key Firestore mein nahi mili (system_settings/api_config)');
        }
        openaiModel = keyDoc.data().openai_model || 'gpt-4.1';
        openaiClient = new OpenAI({ apiKey: keyDoc.data().openai_key });
        console.log(`✅ OpenAI client ready (model: ${openaiModel})`);
        return openaiClient;
    } catch (err) {
        throw new Error(`OpenAI setup failed: ${err.message}`);
    }
}

// ── User Management ──────────────────────────────────────────────
// telegram_users collection: { telegramChatId, email, linkedAt }

async function getLinkedEmail(chatId) {
    const snap = await db.collection('telegram_users').doc(String(chatId)).get();
    return snap.exists ? snap.data().email : null;
}

async function linkUser(chatId, email) {
    // Firebase Auth se verify karo ki email registered hai
    try {
        await admin.auth().getUserByEmail(email);
    } catch (e) {
        return { success: false, reason: 'email_not_found' };
    }
    // Mapping save karo
    await db.collection('telegram_users').doc(String(chatId)).set({
        telegramChatId: String(chatId),
        email: email,
        linkedAt: new Date().toISOString()
    });
    return { success: true };
}

// ── Chat History (in-memory, per chat session) ───────────────────
const chatHistories = new Map();

function getChatHistory(chatId) {
    if (!chatHistories.has(chatId)) chatHistories.set(chatId, []);
    return chatHistories.get(chatId);
}

function addToHistory(chatId, role, content) {
    const history = getChatHistory(chatId);
    history.push({ role, content });
    // Sirf last 20 messages rakhne hain
    if (history.length > 20) history.splice(0, history.length - 20);
}

// ── AI Engine ────────────────────────────────────────────────────
async function processWithAI(userEmail, userText, chatId) {
    const openai = await getOpenAIClient();

    // Firebase se user ka data fetch karo
    const userQuery = (col) => db.collection(col)
        .where('userId', '==', userEmail)
        .orderBy('timestamp', 'desc')
        .limit(30)
        .get()
        .catch(() => ({ docs: [] }));

    const [notebooksSnap, notesSnap, tasksSnap, remindersSnap] = await Promise.all([
        userQuery('notebooks'),
        userQuery('notes'),
        userQuery('tasks'),
        userQuery('reminders')
    ]);

    const notebookData  = notebooksSnap.docs.map(d => d.data());
    const casesData     = notesSnap.docs.map(d => d.data());
    const tasksData     = tasksSnap.docs.map(d => d.data());
    const remindersData = remindersSnap.docs.map(d => d.data());

    // Client summary banao
    const existingClients = {};
    [...casesData, ...notebookData].forEach(item => {
        const key = (item.client || '').toUpperCase();
        if (key) {
            if (!existingClients[key]) existingClients[key] = { name: item.client, updates: [] };
            existingClients[key].updates.push({ ts: item.timestamp, content: item.content });
        }
    });
    const clientSummary = Object.values(existingClients).map(c => {
        const sorted = c.updates.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
        return `CLIENT: ${c.name}\nLATEST: ${sorted[0]?.content?.substring(0, 200) || ''}\nTOTAL UPDATES: ${sorted.length}`;
    }).join('\n---\n');

    const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

    const systemPrompt = `You are CaseDesk AI — a smart, conversational personal banking assistant and case manager. Think and talk like a real helpful coworker, NOT like a bot. Today: ${today}
User: ${userEmail}
Platform: Telegram

YOUR PERSONALITY:
- Talk like a warm, smart coworker — natural Hinglish (Hindi + English mix)
- Be conversational — ask follow-up questions, suggest things proactively
- Use emojis naturally but don't overdo it
- NEVER write raw code, raw JSON, or technical content in reply field
- Keep replies concise for Telegram (2-4 sentences max unless user asks for details)

USER'S SAVED DATA — Search this carefully for every query:
=== CLIENT CASES ===
${clientSummary || 'Koi case data nahi abhi tak'}

=== TASKS ===
${tasksData.filter(t => !t.deleted).map(t => `[${t.status || 'Pending'}] ${t.title} | Client: ${t.client || '-'} | Due: ${t.dueDate || t.timestamp || '-'}`).join('\n') || 'Koi task nahi'}

=== REMINDERS ===
${remindersData.filter(r => !r.deleted).map(r => `[${r.status || 'Active'}] ${r.title} | Time: ${r.time} | Client: ${r.client || '-'}`).join('\n') || 'Koi reminder nahi'}

=== NOTEBOOKS ===
${notebookData.filter(n => !n.deleted).slice(-20).map(n => `Client: ${n.client || '-'} | ${(n.content || '').substring(0, 200)}`).join('\n') || 'Koi notebook entry nahi'}

RULES:
1. Client info/case update → case.save = true, formal Hindi mein content structure karo
2. Task (kaam karna hai) → task.save = true ya tasks[] array (multiple ke liye)
3. Reminder (time-bound deadline) → reminder.save = true ya reminders[] array
4. Case mein se auto-extract karo tasks aur reminders
5. Search queries → saved data search karo, complete answer do
6. Out of scope topics → politely decline, sirf banking/case topics handle karo
7. NEVER repeat previous messages unnecessarily

RESPONSE FORMAT — ALWAYS valid JSON only, NO backticks, NO extra text:
{
  "reply": "Hinglish response. Saving ke baad summary do with ✅. 2-4 sentences max for Telegram.",
  "case": { "save": false, "client": "", "mobile": null, "account": null, "address": null, "status": "", "content": "" },
  "notebook": { "save": false, "client": "", "content": "" },
  "task": { "save": false, "client": "", "title": "", "dueDate": "", "priority": "" },
  "reminder": { "save": false, "client": "", "title": "", "time": "" },
  "tasks": [],
  "reminders": []
}

case.status = EXACTLY ONE of: "Active" / "Pending" / "Processing" / "Sanctioned" / "Disbursed" / "Rejected" / "Mortgage"
task.dueDate = ISO 8601 (e.g. "2026-03-15T00:00:00") ya ""
reminder.time = ISO 8601 ya "Manual"
tasks[] format: [{"save":true,"client":"","title":"","dueDate":"","priority":""}]
reminders[] format: [{"save":true,"client":"","title":"","time":""}]`.trim();

    const history = getChatHistory(chatId);
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10),
        { role: 'user', content: userText }
    ];

    const response = await openai.chat.completions.create({
        model: openaiModel,
        messages,
        temperature: 0.5,
        max_tokens: 1000,
        response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content);
}

async function saveToFirebase(parsed, userEmail) {
    const timestamp = new Date().toISOString();
    const saves = [];

    if (parsed.case?.save) {
        saves.push(db.collection('notes').add({
            ...parsed.case, userId: userEmail, timestamp, source: 'telegram'
        }));
    }

    if (parsed.notebook?.save) {
        saves.push(db.collection('notebooks').add({
            ...parsed.notebook, userId: userEmail, timestamp, source: 'telegram'
        }));
    }

    if (parsed.task?.save) {
        saves.push(db.collection('tasks').add({
            ...parsed.task, userId: userEmail, status: 'Pending', timestamp, source: 'telegram'
        }));
    }

    (parsed.tasks || []).filter(t => t.save).forEach(task => {
        saves.push(db.collection('tasks').add({
            ...task, userId: userEmail, status: 'Pending', timestamp, source: 'telegram'
        }));
    });

    if (parsed.reminder?.save) {
        saves.push(db.collection('reminders').add({
            ...parsed.reminder, userId: userEmail, status: 'Active', timestamp, source: 'telegram'
        }));
    }

    (parsed.reminders || []).filter(r => r.save).forEach(reminder => {
        saves.push(db.collection('reminders').add({
            ...reminder, userId: userEmail, status: 'Active', timestamp, source: 'telegram'
        }));
    });

    if (saves.length > 0) await Promise.all(saves);
}

// ── Bot Commands ─────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const email = await getLinkedEmail(chatId).catch(() => null);

    if (email) {
        await bot.sendMessage(chatId,
            `✅ *Aap pehle se linked hain!*\nAccount: ${email}\n\nBus message karo — main ready hoon! 🤖`,
            { parse_mode: 'Markdown' }
        );
    } else {
        await bot.sendMessage(chatId,
            `🙏 *CaseDesk AI Bot mein Swagat hai!*\n\nApna CaseDesk account link karne ke liye:\n\`/link aapki@email.com\`\n\nExample:\n\`/link user@example.com\``,
            { parse_mode: 'Markdown' }
        );
    }
});

bot.onText(/\/link (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const email = match[1].trim().toLowerCase();

    // Basic email validation
    if (!/\S+@\S+\.\S+/.test(email)) {
        return bot.sendMessage(chatId, '❌ Sahi email format daalo.\nExample: `/link user@example.com`', { parse_mode: 'Markdown' });
    }

    await bot.sendMessage(chatId, '⏳ Verify kar raha hoon...');

    try {
        const result = await linkUser(chatId, email);
        if (result.success) {
            await bot.sendMessage(chatId,
                `✅ *Account link ho gaya!*\nEmail: ${email}\n\nAb aap directly message karke kuch bhi bol sakte hain:\n• Client case add karo\n• Task create karo\n• Reminder set karo\n• Koi bhi query pucho\n\n/help se saari commands dekho 📋`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await bot.sendMessage(chatId,
                `❌ Email nahi mili: *${email}*\n\nSahi email daalo jo aap CaseDesk app mein use karte ho.`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        console.error('Link error:', error);
        await bot.sendMessage(chatId, '❌ Error aa gaya. Thodi der mein try karo.');
    }
});

bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
        `🤖 *CaseDesk AI Bot — Help*\n\n*Commands:*\n/start — Bot start karo\n/link email — Account link karo\n/status — Pending tasks aur reminders dekhna\n/search query — Firebase mein search karo\n/help — Yeh message\n/unlink — Account unlink karo\n\n*Use kaise karein:*\n• Client case bhejo → Auto save ✅\n• Task mention karo → Auto create ✅\n• Deadline batao → Reminder set ✅ + auto notify\n• Kuch bhi pucho → AI jawab dega ✅\n\n*Auto Notifications:*\n🔔 Reminders due hone pe automatic alert\n🌅 Subah 9 baje daily digest (pending tasks + aaj ke reminders)\n\n*Examples:*\n_"Ramesh Patel ka KCC pending hai, NOC lena hai"_\n_"Aaj ke pending tasks kya hain?"_\n_"15 March ko Sharma ji ke saath meeting hai"_\n/search Ramesh — Ramesh se related sab kuch`,
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const email = await getLinkedEmail(chatId).catch(() => null);

    if (!email) {
        return bot.sendMessage(chatId, '❌ Pehle account link karo:\n`/link aapki@email.com`', { parse_mode: 'Markdown' });
    }

    try {
        const [tasksSnap, remindersSnap] = await Promise.all([
            db.collection('tasks').where('userId', '==', email).where('status', '==', 'Pending').get(),
            db.collection('reminders').where('userId', '==', email).where('status', '==', 'Active').get()
        ]);

        const tasks = tasksSnap.docs.map(d => d.data()).filter(t => !t.deleted);
        const reminders = remindersSnap.docs.map(d => d.data()).filter(r => !r.deleted);

        let text = `📊 *Aapka Status*\n\n`;
        text += `✅ *Pending Tasks (${tasks.length}):*\n`;
        if (tasks.length === 0) {
            text += '_Koi pending task nahi_ 🎉\n';
        } else {
            tasks.slice(0, 8).forEach((t, i) => {
                const due = t.dueDate ? ` | 📅 ${new Date(t.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : '';
                text += `${i + 1}. ${t.title}${t.client ? ` — ${t.client}` : ''}${due}\n`;
            });
            if (tasks.length > 8) text += `...aur ${tasks.length - 8} aur tasks\n`;
        }

        text += `\n⏰ *Active Reminders (${reminders.length}):*\n`;
        if (reminders.length === 0) {
            text += '_Koi active reminder nahi_\n';
        } else {
            reminders.slice(0, 8).forEach((r, i) => {
                const time = r.time && r.time !== 'Manual' && r.time !== 'जल्द'
                    ? ` | 📅 ${new Date(r.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
                    : '';
                text += `${i + 1}. ${r.title}${r.client ? ` — ${r.client}` : ''}${time}\n`;
            });
            if (reminders.length > 8) text += `...aur ${reminders.length - 8} aur reminders\n`;
        }

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Status error:', error);
        await bot.sendMessage(chatId, '❌ Data load nahi ho saka. Dobara try karo.');
    }
});

bot.onText(/\/unlink/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        await db.collection('telegram_users').doc(String(chatId)).delete();
        await bot.sendMessage(chatId, '✅ Account unlink ho gaya. Dubara link karne ke liye `/link email` bhejo.', { parse_mode: 'Markdown' });
    } catch (error) {
        await bot.sendMessage(chatId, '❌ Unlink nahi ho saka. Dobara try karo.');
    }
});

// ── Main Message Handler ─────────────────────────────────────────
bot.on('message', async (msg) => {
    // Skip commands (handled above) and non-text messages
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const userText = msg.text.trim();

    // User linked hai ya nahi?
    let email;
    try {
        email = await getLinkedEmail(chatId);
    } catch (err) {
        return bot.sendMessage(chatId, '❌ Database error. Thodi der mein try karo.');
    }

    if (!email) {
        return bot.sendMessage(chatId,
            '❌ Pehle apna account link karo:\n`/link aapki@email.com`',
            { parse_mode: 'Markdown' }
        );
    }

    // Typing indicator dikhao
    await bot.sendChatAction(chatId, 'typing');

    // History mein add karo
    addToHistory(chatId, 'user', userText);

    try {
        const parsed = await processWithAI(email, userText, chatId);

        // Firebase mein save karo
        await saveToFirebase(parsed, email);

        // Chat log Firebase mein save karo (web app ke saath sync ke liye)
        const timestamp = new Date().toISOString();
        await Promise.all([
            db.collection('chats').add({ role: 'user', content: userText, timestamp, userId: email, source: 'telegram' }),
            db.collection('chats').add({ role: 'assistant', content: parsed.reply, timestamp, userId: email, source: 'telegram' })
        ]);

        // AI response history mein add karo
        addToHistory(chatId, 'assistant', parsed.reply);

        // Reply bhejo
        await bot.sendMessage(chatId, parsed.reply, { parse_mode: 'Markdown' })
            .catch(() => bot.sendMessage(chatId, parsed.reply)); // Markdown fail hone par plain text

    } catch (error) {
        console.error('Message processing error:', error.message);
        if (error.message.includes('OpenAI')) {
            await bot.sendMessage(chatId, '❌ AI service temporarily unavailable. Thodi der mein try karo.');
        } else {
            await bot.sendMessage(chatId, '❌ Kuch galat ho gaya. Dobara try karo.');
        }
    }
});

bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error.message);
});

// ── /search Command — explicit Firebase search ───────────────────
bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();

    const email = await getLinkedEmail(chatId).catch(() => null);
    if (!email) {
        return bot.sendMessage(chatId, '❌ Pehle account link karo:\n`/link aapki@email.com`', { parse_mode: 'Markdown' });
    }

    await bot.sendChatAction(chatId, 'typing');

    try {
        // Firebase mein saare collections search karo
        const [notesSnap, tasksSnap, remindersSnap, notebooksSnap] = await Promise.all([
            db.collection('notes').where('userId', '==', email).get().catch(() => ({ docs: [] })),
            db.collection('tasks').where('userId', '==', email).get().catch(() => ({ docs: [] })),
            db.collection('reminders').where('userId', '==', email).get().catch(() => ({ docs: [] })),
            db.collection('notebooks').where('userId', '==', email).get().catch(() => ({ docs: [] }))
        ]);

        const q = query.toLowerCase();

        // Text match karo — client naam, content, title mein
        const matchDoc = (data) => {
            const searchableText = [
                data.client, data.title, data.content,
                data.mobile, data.account, data.address, data.status
            ].filter(Boolean).join(' ').toLowerCase();
            return searchableText.includes(q);
        };

        const matchedCases     = notesSnap.docs.map(d => d.data()).filter(d => !d.deleted && matchDoc(d));
        const matchedTasks     = tasksSnap.docs.map(d => d.data()).filter(d => !d.deleted && matchDoc(d));
        const matchedReminders = remindersSnap.docs.map(d => d.data()).filter(d => !d.deleted && matchDoc(d));
        const matchedNotebooks = notebooksSnap.docs.map(d => d.data()).filter(d => !d.deleted && matchDoc(d));

        const total = matchedCases.length + matchedTasks.length + matchedReminders.length + matchedNotebooks.length;

        if (total === 0) {
            return bot.sendMessage(chatId, `🔍 *"${query}"* ke liye koi result nahi mila.\n\nDusra keyword try karo ya client ka pura naam likho.`, { parse_mode: 'Markdown' });
        }

        let text = `🔍 *Search: "${query}"* — ${total} result(s)\n\n`;

        if (matchedCases.length > 0) {
            text += `📋 *Client Cases (${matchedCases.length}):*\n`;
            matchedCases.slice(0, 3).forEach(c => {
                text += `• *${c.client || 'Unknown'}* | Status: ${c.status || '-'}`;
                if (c.mobile) text += ` | 📞 ${c.mobile}`;
                if (c.account) text += `\n  A/C: ${c.account}`;
                text += '\n';
            });
            if (matchedCases.length > 3) text += `  _...aur ${matchedCases.length - 3} cases_\n`;
            text += '\n';
        }

        if (matchedTasks.length > 0) {
            text += `✅ *Tasks (${matchedTasks.length}):*\n`;
            matchedTasks.slice(0, 4).forEach(t => {
                const due = t.dueDate ? ` | 📅 ${new Date(t.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : '';
                text += `• [${t.status || 'Pending'}] ${t.title}${due}\n`;
            });
            text += '\n';
        }

        if (matchedReminders.length > 0) {
            text += `⏰ *Reminders (${matchedReminders.length}):*\n`;
            matchedReminders.slice(0, 4).forEach(r => {
                const time = r.time && r.time !== 'Manual' ? ` | 📅 ${new Date(r.time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : '';
                text += `• [${r.status || 'Active'}] ${r.title}${time}\n`;
            });
            text += '\n';
        }

        if (matchedNotebooks.length > 0) {
            text += `📓 *Notebooks (${matchedNotebooks.length}):*\n`;
            matchedNotebooks.slice(0, 3).forEach(n => {
                text += `• ${n.client || 'General'}: ${(n.content || '').substring(0, 80)}...\n`;
            });
        }

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
            .catch(() => bot.sendMessage(chatId, text));

    } catch (error) {
        console.error('Search error:', error);
        await bot.sendMessage(chatId, '❌ Search nahi ho saka. Dobara try karo.');
    }
});

// ── Schedulers ───────────────────────────────────────────────────

// Saare linked users ka chatId → email mapping fetch karo
async function getAllLinkedUsers() {
    const snap = await db.collection('telegram_users').get();
    return snap.docs.map(d => d.data());
}

// Due/overdue reminders check karo aur notify karo (har 5 minute mein)
async function checkDueReminders() {
    try {
        const users = await getAllLinkedUsers();
        if (users.length === 0) return;

        const now = new Date();

        for (const user of users) {
            const { telegramChatId, email } = user;
            if (!telegramChatId || !email) continue;

            // Due reminders: time <= now, status Active, telegramNotified nahi hua
            const snap = await db.collection('reminders')
                .where('userId', '==', email)
                .where('status', '==', 'Active')
                .where('telegramNotified', '==', false)
                .get()
                .catch(() => ({ docs: [] }));

            for (const docSnap of snap.docs) {
                const r = docSnap.data();
                if (r.deleted) continue;
                if (!r.time || r.time === 'Manual' || r.time === 'जल्द') continue;

                const reminderTime = new Date(r.time);
                if (isNaN(reminderTime.getTime())) continue;

                // Due ya overdue hai?
                if (reminderTime <= now) {
                    const overdue = reminderTime < now;
                    const diffMin = Math.round((now - reminderTime) / 60000);
                    const overdueText = overdue && diffMin > 60
                        ? ` _(${Math.round(diffMin / 60)} ghante overdue)_`
                        : overdue && diffMin > 0
                        ? ` _(${diffMin} min overdue)_`
                        : '';

                    const msg = `⏰ *Reminder Alert!*${overdueText}\n\n📌 *${r.title}*${r.client ? `\n👤 Client: ${r.client}` : ''}\n\nAb tak complete nahi hua? /status se check karo.`;

                    try {
                        await bot.sendMessage(telegramChatId, msg, { parse_mode: 'Markdown' });
                        // Mark as notified so duplicate na aaye
                        await docSnap.ref.update({ telegramNotified: true });
                    } catch (sendErr) {
                        console.error(`Reminder notify error (${email}):`, sendErr.message);
                    }
                }
            }
        }
    } catch (err) {
        console.error('checkDueReminders error:', err.message);
    }
}

// Daily digest: subah 9 baje pending tasks + aaj ke reminders
async function sendDailyDigest() {
    try {
        const users = await getAllLinkedUsers();
        if (users.length === 0) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        for (const user of users) {
            const { telegramChatId, email } = user;
            if (!telegramChatId || !email) continue;

            try {
                const [tasksSnap, remindersSnap] = await Promise.all([
                    db.collection('tasks').where('userId', '==', email).where('status', '==', 'Pending').get().catch(() => ({ docs: [] })),
                    db.collection('reminders').where('userId', '==', email).where('status', '==', 'Active').get().catch(() => ({ docs: [] }))
                ]);

                const pendingTasks = tasksSnap.docs.map(d => d.data()).filter(t => !t.deleted);

                // Aaj due reminders
                const todayReminders = remindersSnap.docs.map(d => d.data()).filter(r => {
                    if (r.deleted || !r.time || r.time === 'Manual' || r.time === 'जल्द') return false;
                    const rt = new Date(r.time);
                    return !isNaN(rt.getTime()) && rt >= today && rt < tomorrow;
                });

                // Overdue reminders
                const overdueReminders = remindersSnap.docs.map(d => d.data()).filter(r => {
                    if (r.deleted || !r.time || r.time === 'Manual' || r.time === 'जल्द') return false;
                    const rt = new Date(r.time);
                    return !isNaN(rt.getTime()) && rt < today;
                });

                // Kuch bhi na ho toh digest nahi bhejna
                if (pendingTasks.length === 0 && todayReminders.length === 0 && overdueReminders.length === 0) continue;

                const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long' });
                let text = `🌅 *Good Morning! Daily Digest*\n📅 ${dateStr}\n\n`;

                if (overdueReminders.length > 0) {
                    text += `🚨 *Overdue Reminders (${overdueReminders.length}):*\n`;
                    overdueReminders.slice(0, 5).forEach(r => {
                        const daysAgo = Math.floor((new Date() - new Date(r.time)) / 86400000);
                        text += `• ⚠️ ${r.title}${r.client ? ` — ${r.client}` : ''} _(${daysAgo}d overdue)_\n`;
                    });
                    text += '\n';
                }

                if (todayReminders.length > 0) {
                    text += `⏰ *Aaj ke Reminders (${todayReminders.length}):*\n`;
                    todayReminders.forEach(r => {
                        const time = new Date(r.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                        text += `• 🔔 ${r.title}${r.client ? ` — ${r.client}` : ''} | ${time}\n`;
                    });
                    text += '\n';
                }

                if (pendingTasks.length > 0) {
                    // Urgent/overdue tasks pehle
                    const urgentTasks = pendingTasks.filter(t => {
                        if (!t.dueDate) return false;
                        return new Date(t.dueDate) < new Date();
                    });
                    const normalTasks = pendingTasks.filter(t => !urgentTasks.includes(t));

                    text += `✅ *Pending Tasks (${pendingTasks.length}):*\n`;
                    urgentTasks.slice(0, 3).forEach(t => {
                        text += `• 🔴 ${t.title}${t.client ? ` — ${t.client}` : ''} _(overdue)_\n`;
                    });
                    normalTasks.slice(0, 5).forEach(t => {
                        text += `• ${t.priority === 'Urgent' ? '🟠' : '🟡'} ${t.title}${t.client ? ` — ${t.client}` : ''}\n`;
                    });
                    if (pendingTasks.length > 8) text += `  _...aur ${pendingTasks.length - 8} aur tasks_\n`;
                }

                text += `\n_CaseDesk AI — Aaj ka din productive ho! 💪_`;

                await bot.sendMessage(telegramChatId, text, { parse_mode: 'Markdown' })
                    .catch(() => bot.sendMessage(telegramChatId, text));

            } catch (userErr) {
                console.error(`Daily digest error (${email}):`, userErr.message);
            }
        }
    } catch (err) {
        console.error('sendDailyDigest error:', err.message);
    }
}

// Reminder check: har 5 minute mein (IST timezone)
cron.schedule('*/5 * * * *', checkDueReminders, { timezone: 'Asia/Kolkata' });

// Daily digest: subah 9 baje IST
cron.schedule('0 9 * * *', sendDailyDigest, { timezone: 'Asia/Kolkata' });

// Naye reminder documents mein telegramNotified:false set karo agar field missing hai
// (existing reminders ke liye one-time migration)
async function initReminderNotifiedFlag() {
    try {
        const snap = await db.collection('reminders').where('status', '==', 'Active').get();
        const batch = db.batch();
        let count = 0;
        snap.docs.forEach(d => {
            if (d.data().telegramNotified === undefined) {
                batch.update(d.ref, { telegramNotified: false });
                count++;
            }
        });
        if (count > 0) {
            await batch.commit();
            console.log(`✅ ${count} reminders mein telegramNotified:false set kiya`);
        }
    } catch (err) {
        console.error('initReminderNotifiedFlag error:', err.message);
    }
}

// Startup pe migration run karo
initReminderNotifiedFlag();

console.log('⏰ Schedulers active: reminder check (har 5 min) + daily digest (9 AM IST)');

// Express webhook handler — server.js isse use karta hai
function getWebhookHandler() {
    return (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    };
}

module.exports = { bot, getWebhookHandler, WEBHOOK_URL };
