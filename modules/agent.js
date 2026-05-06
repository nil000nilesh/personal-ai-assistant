// modules/agent.js — CaseDesk AI: Proactive Agent, Agentic Planning, WhatsApp, Long-term Memory
import { db } from './firebase.js';
import { collection, addDoc, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { APP } from './state.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function toast(title, body, type = 'info') {
    if (window.showToast) window.showToast(title, body, type);
    else console.info(`[Agent] ${title}: ${body}`);
}

function appendAgentMessage(text) {
    const chatBox = document.getElementById('chat-box');
    if (!chatBox) return;
    const div = document.createElement('div');
    div.className = 'flex justify-start w-full';
    div.innerHTML = `<div style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);border:1px solid #c7d2fe;border-radius:16px;border-top-left-radius:4px;padding:12px 14px;max-width:85%;font-size:13px;line-height:1.6;color:#3730a3;"><strong>🤖 Agent:</strong> ${text}</div>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// ─── 1. Morning Briefing ─────────────────────────────────────────────────────

function getMorningBriefingText() {
    const now = new Date();
    const overdueTasks = (APP.allTasks || []).filter(t => {
        if (t.status === 'Done' || t.status === 'Finished' || t.deleted) return false;
        if (!t.dueDate) return false;
        return new Date(t.dueDate) < now;
    });
    const pendingTasks = (APP.allTasks || []).filter(t =>
        t.status !== 'Done' && t.status !== 'Finished' && !t.deleted
    );
    const todayStr = now.toISOString().slice(0, 10);
    const todayReminders = (APP.allReminders || []).filter(r => {
        if (r.deleted || r.status === 'Closed') return false;
        const dt = r.time || '';
        return dt.startsWith(todayStr);
    });

    const mostUrgent = overdueTasks[0];
    let lines = [
        `📋 ${pendingTasks.length} pending task${pendingTasks.length !== 1 ? 's' : ''} (${overdueTasks.length} overdue)`,
        `⏰ ${todayReminders.length} reminder${todayReminders.length !== 1 ? 's' : ''} today`,
    ];
    if (mostUrgent) {
        lines.push(`💡 Most urgent: ${mostUrgent.title || mostUrgent.task || 'Untitled task'}`);
    }
    return lines.join('<br>');
}

function scheduleMorningBriefing() {
    const now = new Date();
    const hour = now.getHours();
    const todayKey = now.toISOString().slice(0, 10);
    const lastBriefing = localStorage.getItem('lastBriefingDate');

    const isMorning = hour >= 6 && hour < 11;
    const alreadyShown = lastBriefing === todayKey;

    if (isMorning && !alreadyShown) {
        setTimeout(() => {
            localStorage.setItem('lastBriefingDate', todayKey);
            const briefingText = getMorningBriefingText();
            toast(
                '🌅 Good Morning!',
                `Here's your briefing — check chat for details.`,
                'info'
            );
            appendAgentMessage(`Good Morning! Here's your briefing:<br>${briefingText}`);
            if (window.addActivity) window.addActivity('🌅', 'Morning briefing shown', '#6366f1');
        }, 2000);
    }

    // Proactive reminder pings every 30 minutes
    setInterval(() => {
        checkProactiveReminders();
    }, 30 * 60 * 1000);
}

function checkProactiveReminders() {
    const now = new Date();
    const nowMs = now.getTime();
    const windowMs = 2 * 60 * 1000; // ±2 minutes

    (APP.allReminders || []).forEach(r => {
        if (r.deleted || r.status === 'Closed') return;
        const dt = r.time;
        if (!dt || dt === 'Manual' || dt === 'जल्द') return;
        const rMs = new Date(dt).getTime();
        if (Math.abs(rMs - nowMs) <= windowMs) {
            toast(
                '⏰ Reminder',
                `${r.title || r.text || 'Upcoming reminder'} — abhi handle karein!`,
                'warning'
            );
        }
    });
}

// Keep scheduleProactiveReminderPings as alias (called from initAgent)
function scheduleProactiveReminderPings() {
    // Initial check on load, then every 30 min (already set in scheduleMorningBriefing)
    checkProactiveReminders();
}

// ─── 2. Multi-step Agentic Planning ─────────────────────────────────────────

export async function runAgentPlan(goal) {
    if (!goal || !goal.trim()) {
        toast('🤖 Agent', 'Goal batao — kya karna hai?', 'warning');
        return;
    }

    const cleanGoal = goal.replace(/^(agent:|plan:)\s*/i, '').trim();
    toast('🤖 Analyzing goal...', cleanGoal, 'info');
    if (window.addActivity) window.addActivity('🤖', `Agent plan: ${cleanGoal}`, '#8b5cf6');

    // Gather context from APP
    const tasks = APP.allTasks || [];
    const reminders = APP.allReminders || [];
    const notes = APP.allSavedNotes || [];
    const groupedNotes = APP.allGroupedNotes || {};

    const goalLower = cleanGoal.toLowerCase();

    // Try to detect entities (names, keywords)
    const allClients = Object.keys(groupedNotes);
    const mentionedClients = allClients.filter(c => goalLower.includes(c.toLowerCase()));
    const closingKeywords = ['close', 'complete', 'done', 'finish', 'mark'];
    const isClosingAction = closingKeywords.some(k => goalLower.includes(k));
    const pendingKeyword = goalLower.includes('pending') || goalLower.includes('open');

    let planSteps = [];
    let relatedTasks = [];
    let relatedReminders = [];

    if (mentionedClients.length > 0) {
        const client = mentionedClients[0];
        relatedTasks = tasks.filter(t =>
            (t.assignedTo || '').toLowerCase().includes(client.toLowerCase()) ||
            (t.client || '').toLowerCase().includes(client.toLowerCase()) ||
            (t.title || '').toLowerCase().includes(client.toLowerCase()) ||
            (t.task || '').toLowerCase().includes(client.toLowerCase())
        );
        relatedReminders = reminders.filter(r =>
            (r.title || '').toLowerCase().includes(client.toLowerCase()) ||
            (r.text || '').toLowerCase().includes(client.toLowerCase())
        );

        const pendingRelated = relatedTasks.filter(t =>
            t.status !== 'done' && t.status !== 'completed'
        );

        planSteps.push(`🔍 <strong>Client found:</strong> ${client}`);
        planSteps.push(`📋 <strong>Total tasks for ${client}:</strong> ${relatedTasks.length} (${pendingRelated.length} pending)`);

        if (isClosingAction || pendingKeyword) {
            if (pendingRelated.length === 0) {
                planSteps.push(`✅ <strong>Koi pending task nahi</strong> ${client} ke liye — sab complete ho chuke hain!`);
            } else {
                planSteps.push(`📝 <strong>Yeh tasks close kiye jaayenge:</strong>`);
                pendingRelated.forEach((t, i) => {
                    planSteps.push(`&nbsp;&nbsp;${i + 1}. ${t.title || t.task || 'Untitled'} ${t.dueDate ? `(due: ${t.dueDate})` : ''}`);
                });
                planSteps.push(`⚠️ <strong>Confirmation:</strong> Kya aap ${pendingRelated.length} task(s) close karna chahte hain?`);

                // Ask for confirmation via chat
                const confirmHtml = planSteps.join('<br>') +
                    `<br><br><button onclick="window._agentExecutePlan('close_tasks','${client}')" style="background:#6366f1;color:white;border:none;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;margin-right:8px;">✅ Haan, karo</button>` +
                    `<button onclick="this.closest('div').closest('div').style.opacity='0.5'" style="background:#e2e8f0;color:#475569;border:none;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;">❌ Nahi</button>`;
                appendAgentMessage(confirmHtml);

                // Wire the execution
                window._agentExecutePlan = async (action, ctx) => {
                    if (action === 'close_tasks') {
                        const toClose = (APP.allTasks || []).filter(t =>
                            t.status !== 'done' && t.status !== 'completed' && (
                                (t.assignedTo || '').toLowerCase().includes(ctx.toLowerCase()) ||
                                (t.client || '').toLowerCase().includes(ctx.toLowerCase()) ||
                                (t.title || '').toLowerCase().includes(ctx.toLowerCase()) ||
                                (t.task || '').toLowerCase().includes(ctx.toLowerCase())
                            )
                        );
                        toClose.forEach(t => { t.status = 'done'; });
                        toast('✅ Done!', `${toClose.length} task(s) ${ctx} ke liye close kar diye gaye.`, 'success');
                        appendAgentMessage(`✅ <strong>${toClose.length} task(s)</strong> ${ctx} ke liye mark as done kar diye gaye!`);
                        if (window.addActivity) window.addActivity('✅', `${toClose.length} tasks closed for ${ctx}`, '#10b981');
                    }
                };
                return;
            }
        } else {
            relatedReminders.forEach((r, i) => {
                planSteps.push(`⏰ Reminder ${i + 1}: ${r.title || r.text || 'Untitled'}`);
            });
        }
    } else {
        // Generic plan based on goal keywords
        const overdueTasks = tasks.filter(t => {
            if (t.status === 'done' || t.status === 'completed') return false;
            if (!t.dueDate) return false;
            return new Date(t.dueDate) < new Date();
        });

        planSteps.push(`🎯 <strong>Goal:</strong> ${cleanGoal}`);

        if (goalLower.includes('overdue') || goalLower.includes('late')) {
            planSteps.push(`📋 <strong>${overdueTasks.length} overdue task(s) found</strong>`);
            overdueTasks.slice(0, 5).forEach((t, i) => {
                planSteps.push(`&nbsp;&nbsp;${i + 1}. ${t.title || t.task || 'Untitled'} — due ${t.dueDate}`);
            });
            if (overdueTasks.length > 5) planSteps.push(`&nbsp;&nbsp;... aur ${overdueTasks.length - 5} aur`);
        } else if (goalLower.includes('reminder')) {
            const todayStr = new Date().toISOString().slice(0, 10);
            const todayReminders = reminders.filter(r => (r.datetime || r.date || '').startsWith(todayStr));
            planSteps.push(`⏰ <strong>Aaj ke ${todayReminders.length} reminder(s)</strong>`);
            todayReminders.slice(0, 5).forEach((r, i) => {
                planSteps.push(`&nbsp;&nbsp;${i + 1}. ${r.title || r.text || 'Untitled'}`);
            });
        } else if (goalLower.includes('note') || goalLower.includes('client')) {
            planSteps.push(`📁 <strong>${allClients.length} clients</strong> ki notes hain`);
            planSteps.push(`💡 Kisi specific client ka naam batao aur main unke tasks/notes dikhaunga`);
        } else {
            planSteps.push(`📊 Current state:`);
            planSteps.push(`&nbsp;&nbsp;• ${tasks.filter(t => t.status !== 'done').length} pending tasks`);
            planSteps.push(`&nbsp;&nbsp;• ${reminders.length} reminders`);
            planSteps.push(`&nbsp;&nbsp;• ${allClients.length} clients`);
            planSteps.push(`💡 Goal ke baare mein zyada detail do — main ek step-by-step plan bana sakta hoon`);
        }
    }

    appendAgentMessage(planSteps.join('<br>'));
}

// ─── 3. WhatsApp Integration ─────────────────────────────────────────────────

export function sendWhatsApp(mobile, message) {
    const clean = (mobile || '').replace(/\D/g, '');
    if (!clean) { alert('Mobile number nahi hai!'); return; }
    const text = encodeURIComponent(message || 'CaseDesk AI se message');
    window.open(`https://wa.me/${clean.startsWith('91') ? clean : '91' + clean}?text=${text}`, '_blank');
}

export function sendWhatsAppToClient(clientName) {
    if (!clientName) { alert('Client name nahi hai!'); return; }
    const groupedNotes = APP.allGroupedNotes || {};
    const clientNotes = groupedNotes[clientName] || [];

    // Try to find mobile number in notes
    let mobile = '';
    let loanDetails = '';
    for (const note of clientNotes) {
        const content = note.content || note.note || note.text || '';
        const mobileMatch = content.match(/(?:mobile|mob|phone|ph|contact)[:\s]*([6-9]\d{9})/i)
            || content.match(/\b([6-9]\d{9})\b/);
        if (mobileMatch && !mobile) mobile = mobileMatch[1];

        const loanMatch = content.match(/(?:loan|amount|emi)[:\s]*([\d,]+)/i);
        if (loanMatch && !loanDetails) loanDetails = loanMatch[1];
    }

    const pendingTasks = (APP.allTasks || []).filter(t =>
        t.status !== 'done' && t.status !== 'completed' && (
            (t.assignedTo || '').toLowerCase().includes(clientName.toLowerCase()) ||
            (t.client || '').toLowerCase().includes(clientName.toLowerCase())
        )
    );

    const message = `Namaste ${clientName} ji! 🙏\n\nYeh CaseDesk se follow-up message hai.` +
        (loanDetails ? `\n\nAapke loan/amount: ₹${loanDetails}` : '') +
        (pendingTasks.length > 0 ? `\n\nPending matters: ${pendingTasks.length} item(s)` : '') +
        `\n\nKripya jaldi contact karein.\n\nDhanyawad! 🙏`;

    if (!mobile) {
        const inputMobile = prompt(`${clientName} ka mobile number dalein:`);
        if (!inputMobile) return;
        sendWhatsApp(inputMobile, message);
    } else {
        sendWhatsApp(mobile, message);
    }
}

// ─── 4. Long-term Memory ─────────────────────────────────────────────────────

export async function saveMemory(content, tags = []) {
    try {
        await addDoc(collection(db, 'memories'), {
            content,
            tags,
            userId: APP.currentUserEmail,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.warn('[Agent] saveMemory failed:', e);
    }
}

export async function getRecentMemories(n = 10) {
    try {
        const q = query(
            collection(db, 'memories'),
            where('userId', '==', APP.currentUserEmail),
            orderBy('timestamp', 'desc'),
            limit(n)
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data().content);
    } catch (e) {
        console.warn('[Agent] getRecentMemories failed:', e);
        return [];
    }
}

export async function getMemoryContext() {
    const memories = await getRecentMemories(10);
    if (!memories.length) return '';
    return `\n\n[Long-term Memory — Recent Facts]\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`;
}

// ─── 5. Proactive Idle Suggestions ───────────────────────────────────────────

let _lastActivityTs = Date.now();

function resetIdleTimer() {
    _lastActivityTs = Date.now();
}

function checkIdleSuggestion() {
    const idleMs = Date.now() - _lastActivityTs;
    const fiveMin = 5 * 60 * 1000;
    if (idleMs < fiveMin) return;

    // Reset so we don't spam
    _lastActivityTs = Date.now();

    const now = new Date();
    const overdueTasks = (APP.allTasks || []).filter(t => {
        if (t.status === 'done' || t.status === 'completed') return false;
        if (!t.dueDate) return false;
        return new Date(t.dueDate) < now;
    });

    const todayStr = now.toISOString().slice(0, 10);
    const todayReminders = (APP.allReminders || []).filter(r => {
        const dt = r.datetime || r.date || '';
        return dt.startsWith(todayStr);
    });

    if (overdueTasks.length > 0) {
        const t = overdueTasks[0];
        const title = t.title || t.task || 'Ek task';
        appendAgentMessage(`💡 Ek kaam karein: <strong>${title}</strong> abhi mark kar dein?`);
        toast('💡 Idle Suggestion', `${title} — abhi complete karein?`, 'info');
    } else if (todayReminders.length > 0) {
        const r = todayReminders[0];
        const title = r.title || r.text || 'Reminder';
        appendAgentMessage(`⏰ Reminder: <strong>${title}</strong> — handle ho gaya?`);
        toast('⏰ Reminder Check', `${title} — ho gaya kya?`, 'info');
    }
}

function scheduleIdleSuggestion() {
    // Track user activity
    document.addEventListener('keydown', resetIdleTimer, { passive: true });
    document.addEventListener('click', resetIdleTimer, { passive: true });
    document.addEventListener('touchstart', resetIdleTimer, { passive: true });

    // Check every minute
    setInterval(checkIdleSuggestion, 60 * 1000);
}

// ─── 6. Chat Input Interceptor ───────────────────────────────────────────────

function setupChatInterceptor() {
    // Poll until the send button / input exists in DOM
    const tryWire = () => {
        const sendBtn = document.getElementById('send-btn');
        const userInput = document.getElementById('user-input');
        if (!sendBtn || !userInput) {
            setTimeout(tryWire, 500);
            return;
        }

        const origClick = sendBtn.onclick;
        sendBtn.addEventListener('click', async (e) => {
            const val = (userInput.value || '').trim();
            if (/^(agent:|plan:)/i.test(val)) {
                e.stopImmediatePropagation();
                userInput.value = '';
                await runAgentPlan(val);
            }
            // Otherwise let the original handler run
        }, true); // capture phase — fires before existing listeners

        userInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const val = (userInput.value || '').trim();
                if (/^(agent:|plan:)/i.test(val)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    userInput.value = '';
                    await runAgentPlan(val);
                }
            }
        }, true);
    };
    tryWire();
}

// ─── initAgent ───────────────────────────────────────────────────────────────

export function initAgent() {
    // Wire globals
    window.runAgentPlan = runAgentPlan;
    window.sendWhatsApp = sendWhatsApp;
    window.sendWhatsAppToClient = sendWhatsAppToClient;
    window.saveMemory = saveMemory;
    window.getRecentMemories = getRecentMemories;
    window.getMemoryContext = getMemoryContext;

    // Morning briefing + 30-min reminder pings
    scheduleMorningBriefing();

    // Idle suggestion timer
    scheduleIdleSuggestion();

    // Initial proactive reminder check (30-min interval already set in scheduleMorningBriefing)
    scheduleProactiveReminderPings();

    // Chat interceptor for "agent:" / "plan:" prefix
    setupChatInterceptor();

    console.info('[Agent] CaseDesk AI Agent initialized ✅');
}
