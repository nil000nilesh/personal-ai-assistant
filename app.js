import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithRedirect, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, where, onSnapshot, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAeu14r8EACZ7U3eRszsNQmTYTFt5FndcU",
    authDomain: "ai-assistant-app-8e733.firebaseapp.com",
    projectId: "ai-assistant-app-8e733",
    storageBucket: "ai-assistant-app-8e733.firebasestorage.app",
    messagingSenderId: "318215944760",
    appId: "1:318215944760:web:2a387b7bcd068da4ff44cd"
};

const DEFAULT_PIN   = "5786";
const ALLOWED_EMAIL = "nil000nilesh@gmail.com";

// ── PIN Management (localStorage) ─────────────────────────────────
const PIN_KEY      = 'cdPinHash';
const PIN_DATE_KEY = 'cdPinDate';
const WEEK_MS      = 7 * 24 * 60 * 60 * 1000;

function getStoredPin() {
    return localStorage.getItem(PIN_KEY) || DEFAULT_PIN;
}
function savePin(pin) {
    localStorage.setItem(PIN_KEY, pin);
    localStorage.setItem(PIN_DATE_KEY, Date.now().toString());
}
function isPinWeeklyExpired() {
    const d = localStorage.getItem(PIN_DATE_KEY);
    if (!d) {
        // First run — seed the date so they get 7 days from now
        savePin(getStoredPin());
        return false;
    }
    return (Date.now() - parseInt(d)) > WEEK_MS;
}

// ── Firebase Init ──────────────────────────────────────────────────
const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();
const db       = getFirestore(app);

let chatHistory    = [];
let allSavedNotes  = [];
let allTasks       = [];
let allReminders   = [];
let allNotebooks   = [];

let isPinVerified      = false;
let pinChangeForced    = false;   // true when weekly reset forces change
let DYNAMIC_OPENAI_KEY = "";
let OPENAI_MODEL       = "gpt-4.1";
let sessionStartTime;

const ui = {
    login:     document.getElementById('login-screen'),
    pin:       document.getElementById('pin-screen'),
    appLayout: document.getElementById('app-layout'),
    viewNotes: document.getElementById('view-notes'),
    viewTasks: document.getElementById('view-tasks'),
    viewReminders: document.getElementById('view-reminders'),
    viewNotebook:  document.getElementById('view-notebook'),
    chatBox:       document.getElementById('chat-box'),
    notesGrid:     document.getElementById('notes-grid'),
    tasksList:     document.getElementById('tasks-list'),
    remindersList: document.getElementById('reminders-list'),
    notebookGrid:  document.getElementById('notebook-grid'),
    userInput:     document.getElementById('user-input'),
    micBtn:        document.getElementById('mic-btn'),
};

const views = ['notes','tasks','reminders','notebook'];

function hideAllStates() {
    ui.login.classList.add('hidden');     ui.login.classList.remove('flex');
    ui.pin.classList.add('hidden');       ui.pin.classList.remove('flex');
    ui.appLayout.classList.add('hidden'); ui.appLayout.classList.remove('flex');
}

function switchView(targetView) {
    views.forEach(v => {
        const deskBtn = document.getElementById(`tab-${v}-desk`);
        const mobBtn  = document.getElementById(`tab-${v}-mob`);
        const viewEl  = document.getElementById(`view-${v}`);
        if (v === targetView) {
            viewEl.classList.remove('hidden'); viewEl.classList.add('flex');
            deskBtn?.classList.add('active');
            mobBtn?.classList.add('active');
        } else {
            viewEl.classList.add('hidden'); viewEl.classList.remove('flex');
            deskBtn?.classList.remove('active');
            mobBtn?.classList.remove('active');
        }
    });
}

views.forEach(v => {
    document.getElementById(`tab-${v}-desk`)?.addEventListener('click', () => switchView(v));
    document.getElementById(`tab-${v}-mob`)?.addEventListener('click',  () => switchView(v));
});

// ══════════════════════════════════════════════════
//  PIN SCREEN HELPERS
// ══════════════════════════════════════════════════

function showPinScreen() {
    hideAllStates();
    ui.pin.classList.remove('hidden');
    ui.pin.classList.add('flex');
    // ALWAYS clear PIN input when showing — prevents browser auto-fill effect
    const inp = document.getElementById('pin-input');
    inp.value = '';
    setTimeout(() => { inp.value = ''; inp.focus(); }, 80); // double-clear
    // Show weekly notice if expired
    const notice = document.getElementById('pin-weekly-notice');
    if (isPinWeeklyExpired()) {
        notice.classList.remove('hidden');
    } else {
        notice.classList.add('hidden');
    }
}

// ══════════════════════════════════════════════════
//  PIN CHANGE MODAL
// ══════════════════════════════════════════════════

function openPinChangeModal(forced = false) {
    pinChangeForced = forced;
    const modal    = document.getElementById('pin-change-modal');
    const subtitle = document.getElementById('pin-change-subtitle');
    const cancelBtn= document.getElementById('cancel-pin-change');
    const errorEl  = document.getElementById('pin-change-error');

    // Clear all inputs
    ['old-pin-input','new-pin-input','confirm-pin-input'].forEach(id => {
        document.getElementById(id).value = '';
    });
    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    if (forced) {
        subtitle.textContent = '⚠️ Weekly reset — naya PIN set karein';
        cancelBtn.style.display = 'none';
    } else {
        subtitle.textContent = 'Apna PIN badlein';
        cancelBtn.style.display = '';
    }

    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('old-pin-input').focus(), 100);
}

function closePinChangeModal() {
    document.getElementById('pin-change-modal').classList.add('hidden');
    pinChangeForced = false;
}

// Submit PIN change
document.getElementById('submit-pin-change').addEventListener('click', () => {
    const oldPin     = document.getElementById('old-pin-input').value.trim();
    const newPin     = document.getElementById('new-pin-input').value.trim();
    const confirmPin = document.getElementById('confirm-pin-input').value.trim();
    const errorEl    = document.getElementById('pin-change-error');

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
    }

    if (oldPin !== getStoredPin()) {
        showError('❌ Current PIN galat hai!');
        document.getElementById('old-pin-input').value = '';
        document.getElementById('old-pin-input').focus();
        return;
    }
    if (!/^\d{4}$/.test(newPin)) {
        showError('❌ New PIN exactly 4 digits (0-9) hona chahiye!');
        document.getElementById('new-pin-input').value = '';
        document.getElementById('new-pin-input').focus();
        return;
    }
    if (newPin === oldPin) {
        showError('❌ New PIN alag hona chahiye — same PIN nahi chalega!');
        document.getElementById('new-pin-input').value = '';
        document.getElementById('new-pin-input').focus();
        return;
    }
    if (newPin !== confirmPin) {
        showError('❌ New PIN aur Confirm PIN match nahi kar rahe!');
        document.getElementById('confirm-pin-input').value = '';
        document.getElementById('confirm-pin-input').focus();
        return;
    }

    // ✅ Save new PIN with fresh date
    savePin(newPin);
    closePinChangeModal();
    showToastSimple('🔐 PIN successfully changed! Next reset: 7 days baad.');

    // If this was a forced reset and we're not in app yet, load the app
    if (pinChangeForced && !document.getElementById('app-layout').classList.contains('flex')) {
        checkAndLoadApp();
    }
});

document.getElementById('cancel-pin-change').addEventListener('click', closePinChangeModal);

// Open change PIN from PIN screen
document.getElementById('open-pin-change-from-pin-screen')?.addEventListener('click', () => {
    openPinChangeModal(false);
});

// Open change PIN from sidebar
document.getElementById('open-pin-change-sidebar')?.addEventListener('click', () => {
    openPinChangeModal(false);
});

// ══════════════════════════════════════════════════
//  FLOATING CHAT PANEL — Drag, Resize, Badge, Activity
// ══════════════════════════════════════════════════
const chatPanel  = document.getElementById('chat-panel');
const chatFab    = document.getElementById('chat-fab');
const fabBtn     = document.getElementById('open-chat-fab');
const fabBadge   = document.getElementById('fab-badge');
let unreadCount  = 0;
let panelVisible = false;

function showPanel() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = Math.min(390, vw - 40);
    const ph = Math.min(580, vh - 120);
    chatPanel.style.width  = pw + 'px';
    chatPanel.style.height = ph + 'px';
    chatPanel.style.right  = '20px';
    chatPanel.style.bottom = Math.min(100, vh - ph - 20) + 'px';
    chatPanel.style.left   = 'auto';
    chatPanel.style.top    = 'auto';
    chatPanel.style.display   = 'flex';
    chatPanel.style.opacity   = '0';
    chatPanel.style.transform = 'translateY(16px) scale(0.97)';
    requestAnimationFrame(() => {
        chatPanel.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
        chatPanel.style.opacity    = '1';
        chatPanel.style.transform  = 'translateY(0) scale(1)';
    });
    panelVisible = true;
    unreadCount  = 0;
    fabBadge.style.display = 'none';
    setTimeout(() => { ui.userInput.focus(); ui.chatBox.scrollTop = ui.chatBox.scrollHeight; }, 100);
}

function hidePanel() {
    chatPanel.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
    chatPanel.style.opacity    = '0';
    chatPanel.style.transform  = 'translateY(14px) scale(0.97)';
    setTimeout(() => { chatPanel.style.display = 'none'; }, 180);
    panelVisible = false;
}

fabBtn.addEventListener('click', () => { if (panelVisible) hidePanel(); else showPanel(); });
document.getElementById('minimise-chat-btn').addEventListener('click', hidePanel);
document.getElementById('close-chat-btn').addEventListener('click', hidePanel);

document.getElementById('toggle-activity-btn').addEventListener('click', () => {
    const bar = document.getElementById('activity-bar');
    bar.style.display = (bar.style.display === 'none' || !bar.style.display) ? 'block' : 'none';
});

window.addActivity = function(icon, text, color) {
    const feed = document.getElementById('activity-feed');
    const now  = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
    const placeholder = feed.querySelector('[style*="italic"]');
    if (placeholder) placeholder.remove();
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:3px 0;border-bottom:1px solid #f1f5f9;';
    item.innerHTML = '<span style="font-size:12px;flex-shrink:0;">' + icon + '</span>' +
        '<span style="color:' + (color||'#475569') + ';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + text + '</span>' +
        '<span style="color:#94a3b8;font-size:9px;flex-shrink:0;">' + now + '</span>';
    feed.insertBefore(item, feed.firstChild);
    while (feed.children.length > 8) feed.removeChild(feed.lastChild);
    if (!panelVisible) {
        unreadCount++;
        fabBadge.textContent   = unreadCount > 9 ? '9+' : unreadCount;
        fabBadge.style.display = 'flex';
    }
};

// ── Drag Panel ────────────────────────────────────
const dragHandle = document.getElementById('chat-panel-header');
let dragging = false, dragOffX = 0, dragOffY = 0;
dragHandle.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    dragging = true;
    const r = chatPanel.getBoundingClientRect();
    dragOffX = e.clientX - r.left; dragOffY = e.clientY - r.top;
    chatPanel.style.transition = 'none';
    document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', e => {
    if (!dragging) return;
    let nx = e.clientX - dragOffX, ny = e.clientY - dragOffY;
    const pw = chatPanel.offsetWidth, ph = chatPanel.offsetHeight;
    nx = Math.max(0, Math.min(window.innerWidth - pw, nx));
    ny = Math.max(0, Math.min(window.innerHeight - ph, ny));
    chatPanel.style.left = nx + 'px'; chatPanel.style.top = ny + 'px';
    chatPanel.style.right = 'auto';   chatPanel.style.bottom = 'auto';
});
document.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });

// ── Drag FAB ──────────────────────────────────────
let fabDragging = false, fabOX = 0, fabOY = 0;
chatFab.addEventListener('mousedown', e => {
    fabDragging = true;
    const r = chatFab.getBoundingClientRect();
    fabOX = e.clientX - r.left; fabOY = e.clientY - r.top;
    chatFab.style.transition = 'none';
    document.body.style.userSelect = 'none';
    e.preventDefault();
});
document.addEventListener('mousemove', e => {
    if (!fabDragging) return;
    let nx = e.clientX - fabOX, ny = e.clientY - fabOY;
    nx = Math.max(8, Math.min(window.innerWidth  - chatFab.offsetWidth  - 8, nx));
    ny = Math.max(8, Math.min(window.innerHeight - chatFab.offsetHeight - 8, ny));
    chatFab.style.left = nx + 'px'; chatFab.style.top = ny + 'px';
    chatFab.style.right = 'auto';   chatFab.style.bottom = 'auto';
});
document.addEventListener('mouseup', () => { fabDragging = false; document.body.style.userSelect = ''; });

// ── Resize Panel ──────────────────────────────────
let resizing = false, rsY = 0, rsH = 0;
document.getElementById('chat-resize').addEventListener('mousedown', e => {
    resizing = true; rsY = e.clientY; rsH = chatPanel.offsetHeight;
    document.body.style.userSelect = 'none'; e.stopPropagation();
});
document.addEventListener('mousemove', e => {
    if (!resizing) return;
    const newH = Math.max(380, Math.min(window.innerHeight - 60, rsH - (e.clientY - rsY)));
    chatPanel.style.height = newH + 'px';
});
document.addEventListener('mouseup', () => { resizing = false; document.body.style.userSelect = ''; });

// ══════════════════════════════════════════════════
//  AUTH FLOW
// ══════════════════════════════════════════════════

document.getElementById('login-btn').addEventListener('click', async () => {
    const btn = document.getElementById('login-btn');
    const orig = btn.innerHTML;
    btn.innerText = "Signing in...";
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        if (error.code === 'auth/popup-blocked') {
            await signInWithRedirect(auth, provider);
        } else {
            btn.innerHTML = orig;
        }
    }
});

onAuthStateChanged(auth, (user) => {
    hideAllStates();
    if (user) {
        if (user.email === ALLOWED_EMAIL) {
            if (!isPinVerified) {
                showPinScreen();
            } else {
                checkAndLoadApp();
            }
        } else {
            alert("Unauthorized Email!");
            signOut(auth);
        }
    } else {
        ui.login.classList.remove('hidden');
        ui.login.classList.add('flex');
    }
});

const doLogout = () => {
    isPinVerified      = false;
    DYNAMIC_OPENAI_KEY = "";
    signOut(auth);
};
document.getElementById('logout-btn-desk').addEventListener('click', doLogout);
document.getElementById('logout-btn-mob').addEventListener('click',  doLogout);

// ── Verify PIN button ──────────────────────────────
document.getElementById('verify-pin-btn').addEventListener('click', verifyPin);
document.getElementById('pin-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') verifyPin();
});

function verifyPin() {
    const inp = document.getElementById('pin-input');
    const val = inp.value;
    inp.value = ''; // Clear immediately regardless of result

    if (val === getStoredPin()) {
        isPinVerified = true;
        // Check weekly expiry AFTER correct PIN
        if (isPinWeeklyExpired()) {
            // Force PIN change before loading app
            openPinChangeModal(true);
        } else {
            checkAndLoadApp();
        }
    } else {
        // Shake animation feedback
        inp.style.borderColor = '#ef4444';
        setTimeout(() => { inp.style.borderColor = ''; inp.focus(); }, 1200);
        showToastSimple('❌ Galat PIN — dobara try karein');
    }
}

async function checkAndLoadApp() {
    hideAllStates();
    try {
        const keyDoc = await getDoc(doc(db, "system_settings", "api_config"));
        if (keyDoc.exists() && keyDoc.data().openai_key) {
            DYNAMIC_OPENAI_KEY = keyDoc.data().openai_key;
            if (keyDoc.data().openai_model) OPENAI_MODEL = keyDoc.data().openai_model;
            sessionStartTime = new Date().toISOString();

            ui.appLayout.classList.remove('hidden');
            ui.appLayout.classList.add('flex');

            switchView('notebook');
            loadAppListeners();

            // Show notification bubble (initially hidden)
            updateNotifBubble();
        } else {
            alert("API Key missing in Database!");
            ui.login.classList.remove('hidden');
            ui.login.classList.add('flex');
            signOut(auth);
        }
    } catch (error) {
        alert("Database connection failed.");
        console.error(error);
    }
}

// ══════════════════════════════════════════════════════════════════
//  NOTIFICATION BUBBLE — floating mini widget
// ══════════════════════════════════════════════════════════════════

let bubbleExpanded = false;

function updateNotifBubble() {
    const wrap     = document.getElementById('notif-bubble-wrap');
    const totalEl  = document.getElementById('nb-total-ct');
    const panel    = document.getElementById('notif-bubble-panel');

    // Count unread per section
    const taskUnread  = NS.items.filter(i => i.type === 'task'     && !i.read).length;
    const remUnread   = NS.items.filter(i => i.type === 'reminder' && !i.read).length;
    const caseUnread  = NS.items.filter(i => i.type === 'case'     && !i.read).length;
    const noteUnread  = NS.items.filter(i => i.type === 'notebook' && !i.read).length;
    const total       = taskUnread + remUnread + caseUnread + noteUnread;

    // Update count texts
    const te = document.getElementById('nb-task-ct');
    const re = document.getElementById('nb-rem-ct');
    const ce = document.getElementById('nb-case-ct');
    const ne = document.getElementById('nb-note-ct');
    if (te) { te.textContent = taskUnread; te.parentElement?.classList.toggle('has-notif', taskUnread > 0); }
    if (re) { re.textContent = remUnread;  re.parentElement?.classList.toggle('has-notif', remUnread > 0); }
    if (ce) { ce.textContent = caseUnread; ce.parentElement?.classList.toggle('has-notif', caseUnread > 0); }
    if (ne) { ne.textContent = noteUnread; ne.parentElement?.classList.toggle('has-notif', noteUnread > 0); }
    if (totalEl) totalEl.textContent = total > 9 ? '9+' : total;

    // Show bubble only if there are unread notifications
    if (total > 0) {
        wrap.style.display = 'flex';
    } else {
        wrap.style.display = 'none';
        // Collapse panel if visible
        if (panel) { panel.style.display = 'none'; bubbleExpanded = false; }
    }
}

// Bubble button toggle expand/collapse
document.getElementById('notif-bubble-btn')?.addEventListener('click', () => {
    const panel = document.getElementById('notif-bubble-panel');
    bubbleExpanded = !bubbleExpanded;
    if (bubbleExpanded) {
        panel.style.display = 'flex';
        // Re-trigger animation
        panel.style.animation = 'none';
        requestAnimationFrame(() => { panel.style.animation = ''; });
    } else {
        panel.style.display = 'none';
    }
});

// Section icon clicks — navigate to that view
document.querySelectorAll('.nb-sec-icon').forEach(icon => {
    icon.addEventListener('click', () => {
        const view = icon.dataset.view;
        if (view && window.switchView) window.switchView(view);
        // Collapse bubble panel
        const panel = document.getElementById('notif-bubble-panel');
        if (panel) { panel.style.display = 'none'; bubbleExpanded = false; }
    });
});

// Close bubble panel when clicking outside
document.addEventListener('click', (e) => {
    const wrap = document.getElementById('notif-bubble-wrap');
    if (wrap && !wrap.contains(e.target)) {
        const panel = document.getElementById('notif-bubble-panel');
        if (panel) { panel.style.display = 'none'; bubbleExpanded = false; }
    }
});

// ══════════════════════════════════════════════════
//  APP LISTENERS
// ══════════════════════════════════════════════════

function loadAppListeners() {
    const chatQuery = query(
        collection(db, "chats"),
        where("timestamp", ">=", sessionStartTime),
        orderBy("timestamp", "asc")
    );
    onSnapshot(chatQuery, (snapshot) => {
        const welcomeMsg = ui.chatBox.firstElementChild;
        ui.chatBox.innerHTML = "";
        if (welcomeMsg) ui.chatBox.appendChild(welcomeMsg);
        chatHistory = [];
        snapshot.forEach((docData) => {
            const msg = docData.data();
            chatHistory.push({ role: msg.role, content: msg.content });
            renderMessage(msg.role, msg.content);
        });
        ui.chatBox.scrollTop = ui.chatBox.scrollHeight;
    });

    // ── CLIENT CASES ──
    onSnapshot(query(collection(db, "notes"), orderBy("timestamp", "asc")), (snapshot) => {
        ui.notesGrid.innerHTML = "";
        allSavedNotes = [];
        let groupedNotes = {};
        snapshot.forEach((docData) => {
            const note = docData.data();
            allSavedNotes.push(note);
            const normalizedTitle = (note.client || note.title || "सामान्य").toUpperCase();
            if (!groupedNotes[normalizedTitle]) groupedNotes[normalizedTitle] = {
                displayTitle: note.client || note.title || "सामान्य",
                mobile: note.mobile || null,
                updates: []
            };
            if (!groupedNotes[normalizedTitle].mobile) {
                const mobMatch = (note.content || "").match(/\b[6-9]\d{9}\b/);
                if (mobMatch) groupedNotes[normalizedTitle].mobile = mobMatch[0];
            }
            groupedNotes[normalizedTitle].updates.push(note);
        });

        for (const key in groupedNotes) {
            const group = groupedNotes[key];
            const card  = document.createElement('div');
            card.className = "bg-white rounded-2xl shadow-md hover:shadow-xl border border-slate-100 relative overflow-hidden transition-all duration-300 group";

            const latestUpdate  = group.updates[group.updates.length - 1];
            const latestContent = (latestUpdate?.content || "").toLowerCase();
            let statusBadge = "🔵 Active";
            let statusColor = "bg-blue-50 text-blue-700 border-blue-200";
            if (/disburse ho gaya|disbursed|वितरण हो गया|वितरण पूर्ण/.test(latestContent))
                { statusBadge = "✅ Disbursed";  statusColor = "bg-green-50 text-green-700 border-green-200"; }
            else if (/rejected|अस्वीकृत/.test(latestContent))
                { statusBadge = "❌ Rejected";   statusColor = "bg-red-50 text-red-700 border-red-200"; }
            else if (/sanctioned|sanction ho gaya|स्वीकृत हो गया|ऋण स्वीकृत/.test(latestContent))
                { statusBadge = "✔️ Sanctioned"; statusColor = "bg-emerald-50 text-emerald-700 border-emerald-200"; }
            else if (/mortgage|मॉर्गेज/.test(latestContent))
                { statusBadge = "📑 Mortgage";   statusColor = "bg-purple-50 text-purple-700 border-purple-200"; }
            else if (/processing start|processing ho|प्रोसेसिंग/.test(latestContent))
                { statusBadge = "🔄 Processing"; statusColor = "bg-indigo-50 text-indigo-700 border-indigo-200"; }
            else if (/pending|लंबित/.test(latestContent))
                { statusBadge = "⏳ Pending";    statusColor = "bg-yellow-50 text-yellow-700 border-yellow-200"; }

            function fmtDate(ts) { return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
            function fmtTime(ts) { return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }
            function fmtDateTime(ts) { return fmtDate(ts) + ' — ' + fmtTime(ts); }

            let headerGrad = "from-blue-600 to-indigo-700";
            if (statusBadge.includes("Disbursed"))    headerGrad = "from-emerald-600 to-green-700";
            else if (statusBadge.includes("Sanctioned")) headerGrad = "from-teal-600 to-emerald-700";
            else if (statusBadge.includes("Rejected"))   headerGrad = "from-red-600 to-rose-700";
            else if (statusBadge.includes("Mortgage"))   headerGrad = "from-purple-600 to-violet-700";
            else if (statusBadge.includes("Processing")) headerGrad = "from-indigo-500 to-blue-700";
            else if (statusBadge.includes("Pending"))    headerGrad = "from-amber-500 to-orange-600";

            const mobNo = group.mobile
                ? '<span class="flex items-center gap-1 bg-white/10 px-2.5 py-1 rounded-full border border-white/10 text-white/70">📱 ' + group.mobile + '</span>'
                : '';
            const updCnt  = group.updates.length;
            const lastTime = fmtDateTime(latestUpdate.timestamp);

            card.innerHTML = `
                <div class="bg-gradient-to-br ${headerGrad} p-5 relative overflow-hidden">
                    <div class="absolute -right-6 -top-6 w-28 h-28 bg-white/5 rounded-full pointer-events-none"></div>
                    <div class="flex items-start justify-between gap-2 mb-3 relative">
                        <div>
                            <p class="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">📁 Client Case</p>
                            <h3 class="font-black text-white text-xl leading-tight tracking-tight">${group.displayTitle}</h3>
                        </div>
                        <span class="text-[10px] font-black px-3 py-1.5 rounded-full shrink-0 bg-white/20 text-white border border-white/20">${statusBadge}</span>
                    </div>
                    <div class="flex flex-wrap gap-1.5 text-[10px] font-bold relative">
                        ${mobNo}
                        <span class="flex items-center gap-1 bg-white/10 px-2.5 py-1 rounded-full border border-white/10 text-white/70">📋 ${updCnt} Update${updCnt>1?'s':''}</span>
                        <span class="flex items-center gap-1 bg-white/10 px-2.5 py-1 rounded-full border border-white/10 text-white/70">🕐 ${lastTime}</span>
                    </div>
                </div>
                <div class="overflow-y-auto client-updates-scroll max-h-[350px]">
                    ${[...group.updates].reverse().map((u, idx) => {
                        const isLatest = idx === 0;
                        return `<div class="relative pl-9 pr-4 py-3 ${isLatest?'bg-blue-50/30':''} border-b border-slate-50 last:border-b-0">
                            <div class="absolute left-3.5 top-4 w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm ${isLatest?'bg-blue-500':'bg-slate-300'}"></div>
                            <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span class="text-[10px] font-black px-2 py-0.5 rounded-full ${isLatest?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-500'}">📅 ${fmtDate(u.timestamp)}</span>
                                <span class="text-[10px] font-bold text-slate-400">⏰ ${fmtTime(u.timestamp)}</span>
                                ${isLatest?'<span class="text-[9px] font-black text-white bg-blue-500 px-2 py-0.5 rounded-full">LATEST</span>':''}
                            </div>
                            <p class="text-slate-700 text-sm leading-relaxed font-medium whitespace-pre-wrap devanagari">${u.content}</p>
                        </div>`;
                    }).join('')}
                </div>`;
            ui.notesGrid.appendChild(card);
        }
    });

    // ── TASKS ──
    let taskCurrentFilter = 'all';
    let taskSearchQuery   = '';

    function renderTasks() {
        const list         = document.getElementById('tasks-list');
        const empty        = document.getElementById('task-empty');
        const pendingCount = document.getElementById('task-pending-count');
        const doneCount    = document.getElementById('task-done-count');
        list.innerHTML = '';

        let filtered = allTasks.filter(t => {
            const matchFilter = taskCurrentFilter === 'all' || t.status === taskCurrentFilter ||
                (taskCurrentFilter === 'Urgent' && t.priority === 'Urgent');
            const matchSearch = !taskSearchQuery ||
                (t.title||'').toLowerCase().includes(taskSearchQuery) ||
                (t.client||'').toLowerCase().includes(taskSearchQuery);
            return matchFilter && matchSearch;
        });

        const pending = allTasks.filter(t => t.status !== 'Done').length;
        const done    = allTasks.filter(t => t.status === 'Done').length;
        if (pendingCount) pendingCount.textContent = pending + ' Pending';
        if (doneCount)    doneCount.textContent    = done    + ' Done';

        if (filtered.length === 0) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        filtered.forEach((task, idx) => {
            const isDone    = task.status === 'Done';
            const isUrgent  = task.priority === 'Urgent';
            const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isDone;
            const d       = new Date(task.timestamp);
            const dateStr = d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
            const timeStr = d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});

            let priorityBadge = isUrgent
                ? '<span class="text-[10px] font-black text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">🚨 URGENT</span>'
                : '';
            let dueBadge = '';
            if (task.dueDate) {
                const due = new Date(task.dueDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
                dueBadge = `<span class="text-[10px] font-bold ${isOverdue?'text-red-600 bg-red-50':'text-slate-500 bg-slate-100'} px-2 py-0.5 rounded-full">📅 ${due}</span>`;
            }
            let statusBadge = isDone
                ? '<span class="text-[10px] font-black text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">✅ Done</span>'
                : isOverdue
                    ? '<span class="text-[10px] font-black text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full animate-pulse">🔴 Overdue</span>'
                    : '<span class="text-[10px] font-black text-orange-700 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-full">⏳ Pending</span>';

            const div = document.createElement('div');
            div.className = `bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all group ${isDone?'opacity-60 border-slate-100':isOverdue?'border-red-200':'border-slate-100 hover:border-blue-200'}`;
            div.innerHTML = `
                <div class="p-4 flex items-start gap-4">
                    <button class="task-check-btn mt-1 flex-shrink-0 w-6 h-6 rounded-full border-2 ${isDone?'bg-green-500 border-green-500':'border-slate-300 hover:border-blue-400'} flex items-center justify-center transition-all" data-idx="${idx}">
                        ${isDone?'<svg class="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>':''}
                    </button>
                    <div class="flex-1 min-w-0">
                        <p class="font-semibold text-slate-800 text-base leading-snug devanagari ${isDone?'line-through text-slate-400':''}">${task.title}</p>
                        <div class="flex flex-wrap gap-2 mt-2 items-center">
                            ${task.client?`<span class="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">👤 ${task.client}</span>`:''}
                            ${dueBadge}${priorityBadge}
                            <span class="text-[10px] text-slate-400 font-semibold ml-auto">🕐 ${dateStr} ${timeStr}</span>
                        </div>
                    </div>
                    <div class="flex-shrink-0">${statusBadge}</div>
                </div>`;
            list.appendChild(div);
        });

        list.querySelectorAll('.task-check-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const task = filtered[parseInt(btn.dataset.idx)];
                task.status = task.status === 'Done' ? 'Pending' : 'Done';
                renderTasks();
            });
        });
    }

    onSnapshot(query(collection(db, "tasks"), orderBy("timestamp", "desc")), (snapshot) => {
        allTasks = [];
        snapshot.forEach(d => allTasks.push(d.data()));
        renderTasks();
        const pending = allTasks.filter(t => t.status !== 'Done').length;
        const tn = document.getElementById('np-task-num');
        if (tn) tn.textContent = pending;
    });

    document.getElementById('task-search')?.addEventListener('input', e => {
        taskSearchQuery = e.target.value.toLowerCase(); renderTasks();
    });
    document.getElementById('task-filter-btns')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        taskCurrentFilter = btn.dataset.filter;
        document.querySelectorAll('.task-filter-btn').forEach(b => {
            b.className = b === btn
                ? 'task-filter-btn text-[11px] font-bold px-3 py-2 rounded-xl border bg-blue-600 text-white border-blue-600'
                : 'task-filter-btn text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200 text-slate-600 bg-slate-50';
        });
        renderTasks();
    });

    // ── REMINDERS ──
    let remCurrentFilter = 'all';
    let remSearchQuery   = '';

    function parseRemDate(timeStr) {
        if (!timeStr || timeStr === 'Manual' || timeStr === 'जल्द') return null;
        const d = new Date(timeStr);
        return isNaN(d) ? null : d;
    }

    function renderReminders() {
        const list       = document.getElementById('reminders-list');
        const empty      = document.getElementById('rem-empty');
        const upcomingEl = document.getElementById('rem-upcoming-count');
        const overdueEl  = document.getElementById('rem-overdue-count');
        list.innerHTML = '';
        const now = new Date();

        let filtered = allReminders.filter(r => {
            const d = parseRemDate(r.time);
            const isOverdue = d && d < now;
            const isToday   = d && d.toDateString() === now.toDateString();
            const matchFilter = remCurrentFilter === 'all' ||
                (remCurrentFilter === 'today'    && isToday) ||
                (remCurrentFilter === 'overdue'  && isOverdue) ||
                (remCurrentFilter === 'upcoming' && d && d >= now);
            const matchSearch = !remSearchQuery ||
                (r.title||'').toLowerCase().includes(remSearchQuery) ||
                (r.client||'').toLowerCase().includes(remSearchQuery);
            return matchFilter && matchSearch;
        });

        const upcoming = allReminders.filter(r => { const d=parseRemDate(r.time); return d && d >= now; }).length;
        const overdue  = allReminders.filter(r => { const d=parseRemDate(r.time); return d && d < now; }).length;
        if (upcomingEl) upcomingEl.textContent = upcoming + ' Upcoming';
        if (overdueEl)  overdueEl.textContent  = overdue  + ' Overdue';

        if (filtered.length === 0) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        filtered.forEach(rem => {
            const remDate = parseRemDate(rem.time);
            const isOverdue = remDate && remDate < now;
            const isToday   = remDate && remDate.toDateString() === now.toDateString();
            const isManual  = !remDate;

            let cardColor, dotColor, timeLabel;
            if (isOverdue)     { cardColor = 'from-red-50 to-red-100 border-red-200';      dotColor = 'bg-red-500';    timeLabel = '🔴 Overdue'; }
            else if (isToday)  { cardColor = 'from-orange-50 to-amber-50 border-amber-200'; dotColor = 'bg-amber-500';  timeLabel = '🟠 Today'; }
            else if (isManual) { cardColor = 'from-slate-50 to-slate-100 border-slate-200'; dotColor = 'bg-slate-400';  timeLabel = '📌 Manual'; }
            else               { cardColor = 'from-blue-50 to-indigo-50 border-blue-200';   dotColor = 'bg-blue-500';   timeLabel = '🟢 Upcoming'; }

            let formattedTime = rem.time;
            if (remDate) {
                formattedTime = remDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
                if (remDate.getHours() || remDate.getMinutes())
                    formattedTime += ' — ' + remDate.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
            }

            let countdownBadge = '';
            if (remDate && !isOverdue) {
                const diff = Math.ceil((remDate - now) / (1000*60*60*24));
                countdownBadge = diff === 0
                    ? '<span class="text-[10px] font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full animate-pulse">Today!</span>'
                    : `<span class="text-[10px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">in ${diff}d</span>`;
            } else if (isOverdue) {
                const diff = Math.ceil((now - remDate) / (1000*60*60*24));
                countdownBadge = `<span class="text-[10px] font-black text-red-700 bg-red-100 px-2 py-0.5 rounded-full">${diff}d ago</span>`;
            }

            const div = document.createElement('div');
            div.className = `bg-gradient-to-br ${cardColor} border p-5 rounded-2xl shadow-sm flex flex-col gap-3 relative overflow-hidden hover:shadow-md transition-all`;
            div.innerHTML = `
                <div class="absolute -right-3 -top-3 text-5xl opacity-[0.07] select-none">⏰</div>
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full ${dotColor} ${isOverdue||isToday?'animate-pulse':''}"></span>
                        <span class="text-xs font-black text-slate-600 uppercase tracking-wide">${timeLabel}</span>
                    </div>
                    ${countdownBadge}
                </div>
                <p class="font-bold text-slate-800 text-base leading-snug devanagari">${rem.title}</p>
                <div class="flex flex-wrap gap-2 items-center mt-1">
                    <span class="text-[11px] font-bold text-slate-500 bg-white/60 px-2 py-0.5 rounded-lg">📅 ${formattedTime}</span>
                    ${rem.client?`<span class="text-[10px] font-bold text-blue-600 bg-white/60 px-2 py-0.5 rounded-lg">👤 ${rem.client}</span>`:''}
                </div>`;
            list.appendChild(div);
        });
    }

    onSnapshot(query(collection(db, "reminders"), orderBy("timestamp", "desc")), (snapshot) => {
        allReminders = [];
        snapshot.forEach(d => allReminders.push(d.data()));
        renderReminders();
        allReminders.forEach(rem => { if (window.scheduleReminder) scheduleReminder(rem); });
        const upcomingCount = allReminders.filter(r => {
            const d = new Date(r.time); return !isNaN(d) && d >= new Date();
        }).length;
        const rn = document.getElementById('np-rem-num');
        if (rn) rn.textContent = upcomingCount;
    });

    document.getElementById('rem-search')?.addEventListener('input', e => {
        remSearchQuery = e.target.value.toLowerCase(); renderReminders();
    });
    document.querySelectorAll('.rem-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            remCurrentFilter = btn.dataset.remfilter;
            document.querySelectorAll('.rem-filter-btn').forEach(b => {
                b.className = b === btn
                    ? 'rem-filter-btn text-[11px] font-bold px-3 py-2 rounded-xl border bg-blue-600 text-white border-blue-600'
                    : 'rem-filter-btn text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200 text-slate-600 bg-slate-50';
            });
            renderReminders();
        });
    });

    // ── NOTEBOOK ──
    let nbSearchQuery  = '';
    let nbSort         = 'new';
    let nbFilterClient = 'all';
    let nbViewGrid     = true;

    function renderNotebook() {
        const grid    = document.getElementById('notebook-grid');
        const empty   = document.getElementById('nb-empty');
        const countEl = document.getElementById('nb-count');
        grid.innerHTML = '';

        let grouped = {};
        let allClientNames = new Set();
        allNotebooks.forEach(page => {
            const key  = (page.client || page.title || 'सामान्य').toUpperCase();
            const name = page.client || page.title || 'सामान्य';
            allClientNames.add(name);
            if (!grouped[key]) grouped[key] = { displayName: name, updates: [] };
            grouped[key].updates.push(page);
        });

        const filterEl = document.getElementById('nb-filter');
        if (filterEl && filterEl.options.length <= 1) {
            allClientNames.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name; opt.textContent = '👤 ' + name;
                filterEl.appendChild(opt);
            });
        }

        let entries = Object.values(grouped).filter(g => {
            if (nbFilterClient !== 'all' && g.displayName !== nbFilterClient) return false;
            if (!nbSearchQuery) return true;
            return g.displayName.toLowerCase().includes(nbSearchQuery) ||
                g.updates.some(u => (u.content||'').toLowerCase().includes(nbSearchQuery));
        });

        entries.sort((a, b) => {
            const aL = Math.max(...a.updates.map(u => new Date(u.timestamp)));
            const bL = Math.max(...b.updates.map(u => new Date(u.timestamp)));
            if (nbSort === 'new') return bL - aL;
            if (nbSort === 'old') return aL - bL;
            if (nbSort === 'az')  return a.displayName.localeCompare(b.displayName);
            return 0;
        });

        if (countEl) countEl.textContent = allNotebooks.length + ' notes';
        grid.className = nbViewGrid
            ? 'grid grid-cols-1 xl:grid-cols-2 gap-6 pb-20 items-start'
            : 'flex flex-col gap-4 pb-20';

        if (entries.length === 0) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        entries.forEach(group => {
            const card = document.createElement('div');
            card.className = "bg-white rounded-[1.5rem] shadow-sm hover:shadow-xl border border-l-[8px] border-yellow-400 border-slate-200 relative transition-all duration-300 overflow-hidden group";

            const sortedUpdates = [...group.updates].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
            function fmtD(ts) { return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
            function fmtT(ts) { return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }

            const updatesHTML = sortedUpdates.map((page, idx) => {
                let displayContent = page.content || '';
                if (nbSearchQuery) {
                    const rx = new RegExp('(' + nbSearchQuery + ')', 'gi');
                    displayContent = displayContent.replace(rx, '<mark class="bg-yellow-200 rounded px-0.5">$1</mark>');
                }
                const isLatest  = idx === 0;
                const updateNum = group.updates.length - idx;
                const badgeCls  = isLatest ? 'bg-yellow-400 text-slate-900 font-black' : 'bg-slate-100 text-slate-400';
                return `<div class="px-6 py-4 border-b border-slate-50 last:border-b-0 ${isLatest?'bg-yellow-50/30':''}">
                    <div class="flex items-center gap-2 mb-2 flex-wrap">
                        <span class="text-[10px] font-black px-2 py-0.5 rounded-full ${isLatest?'bg-yellow-100 text-yellow-800':'bg-slate-100 text-slate-500'}">📅 ${fmtD(page.timestamp)}</span>
                        <span class="text-[10px] font-bold text-slate-400">⏰ ${fmtT(page.timestamp)}</span>
                        <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ml-auto ${badgeCls}">#${updateNum}</span>
                    </div>
                    <div class="text-slate-700 text-sm leading-relaxed devanagari font-medium whitespace-pre-wrap">${displayContent}</div>
                </div>`;
            }).join('');

            card.innerHTML = `
                <div class="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
                    <div>
                        <div class="text-[10px] text-yellow-400 font-black uppercase tracking-widest mb-0.5">📋 क्लाइंट नोट</div>
                        <h3 class="font-black text-xl tracking-tight">${group.displayName}</h3>
                    </div>
                    <div class="text-right">
                        <div class="text-[10px] text-slate-400 mb-0.5">कुल अपडेट</div>
                        <div class="text-yellow-400 text-2xl font-black">${group.updates.length}</div>
                    </div>
                </div>
                <div class="divide-y divide-slate-50 max-h-[300px] overflow-y-auto client-updates-scroll">${updatesHTML}</div>`;
            grid.appendChild(card);
        });
    }

    onSnapshot(query(collection(db, "notebooks"), orderBy("timestamp", "desc")), (snapshot) => {
        allNotebooks = [];
        snapshot.forEach(d => allNotebooks.push(d.data()));
        renderNotebook();
    });

    document.getElementById('nb-search')?.addEventListener('input', e => { nbSearchQuery = e.target.value.toLowerCase(); renderNotebook(); });
    document.getElementById('nb-sort')?.addEventListener('change',  e => { nbSort = e.target.value; renderNotebook(); });
    document.getElementById('nb-filter')?.addEventListener('change',e => { nbFilterClient = e.target.value; renderNotebook(); });
    document.getElementById('nb-view-toggle')?.addEventListener('click', () => {
        nbViewGrid = !nbViewGrid;
        document.getElementById('nb-view-toggle').textContent = nbViewGrid ? '⊞ Grid' : '☰ List';
        renderNotebook();
    });
}

// ══════════════════════════════════════════════════
//  CHAT MESSAGE RENDER
// ══════════════════════════════════════════════════

function renderMessage(role, content) {
    const div    = document.createElement('div');
    div.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'} w-full`;
    const bubble  = document.createElement('div');
    if (role === 'user') {
        bubble.className = "p-4 rounded-2xl max-w-[85%] text-sm leading-relaxed bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md rounded-tr-sm";
    } else {
        bubble.className = "p-4 rounded-2xl max-w-[85%] text-sm leading-relaxed bg-white border border-slate-200 text-slate-700 shadow-sm rounded-tl-sm";
    }
    bubble.textContent = content;
    div.appendChild(bubble);
    ui.chatBox.appendChild(div);
}

// ══════════════════════════════════════════════════
//  VOICE INPUT
// ══════════════════════════════════════════════════

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition, isRecording = false;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'hi-IN';
    recognition.onstart  = () => { isRecording = true;  ui.micBtn.classList.add('recording'); ui.userInput.placeholder = "Listening..."; };
    recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) ui.userInput.value += event.results[i][0].transcript + ' ';
        }
    };
    recognition.onend = () => { isRecording = false; ui.micBtn.classList.remove('recording'); ui.userInput.placeholder = "Kuch bhi boliye..."; };
    ui.micBtn.addEventListener('click', () => { if (isRecording) recognition.stop(); else recognition.start(); });
} else {
    ui.micBtn.style.display = 'none';
}

// ══════════════════════════════════════════════════
//  AI SEND MESSAGE
// ══════════════════════════════════════════════════

let isProcessing = false;

async function sendMessage() {
    if (isProcessing) return;
    const text = ui.userInput.value.trim();
    if (!text) return;

    isProcessing = true;
    ui.userInput.disabled = true;
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;
    sendBtn.classList.add('opacity-50');
    ui.userInput.value = "";

    chatHistory.push({ role: 'user', content: text });
    await addDoc(collection(db, "chats"), { role: "user", content: text, timestamp: new Date().toISOString() });

    const loadingDiv = document.createElement('div');
    loadingDiv.className = "flex justify-start w-full";
    loadingDiv.innerHTML = `<div class="p-4 rounded-2xl bg-white border border-slate-200 text-blue-500 text-sm font-bold animate-pulse shadow-sm flex items-center gap-2"><span class="text-xl">🤖</span> AI सोच रहा है...</div>`;
    ui.chatBox.appendChild(loadingDiv);
    ui.chatBox.scrollTop = ui.chatBox.scrollHeight;

    try {
        const [notebooksSnap, notesSnap, tasksSnap, remindersSnap] = await Promise.all([
            getDocs(collection(db, "notebooks")),
            getDocs(collection(db, "notes")),
            getDocs(collection(db, "tasks")),
            getDocs(collection(db, "reminders"))
        ]);

        function summarize(arr, fields) {
            return arr.slice(-30).map(item => fields.map(f => `${f}: ${item[f]||''}`).join(' | ')).join('\n');
        }

        const savedContext = `
=== SAVED NOTEBOOKS ===
${summarize(notebooksSnap.docs.map(d=>d.data()), ['client','content','timestamp'])}
=== CLIENT CASES ===
${summarize(notesSnap.docs.map(d=>d.data()),     ['client','content','timestamp'])}
=== TASKS ===
${summarize(tasksSnap.docs.map(d=>d.data()),     ['title','status','client','timestamp'])}
=== REMINDERS ===
${summarize(remindersSnap.docs.map(d=>d.data()), ['title','time','client','timestamp'])}`.trim();

        const today = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
        const systemPrompt = `
Aap "CaseDesk AI" ke AI Assistant hain. Aaj ki tarikh: ${today}

AAPKE PAAS YEH SAVED DATA HAI:
${savedContext}

AAPKA KAAM:
1. Client information milne par: Professional Devanagari Hindi notebook draft banao
2. Query milne par: Saved data se jawab do
3. Task/Reminder request par: Create karo

RESPONSE FORMAT (HAMESHA valid JSON):
{"reply":"...Hindi mein...","notebook":{"save":true/false,"client":"...","content":"..."},"case":{"save":true/false,"client":"...","mobile":null,"content":"..."},"task":{"save":true/false,"client":"...","title":"..."},"reminder":{"save":true/false,"client":"...","title":"...","time":"..."}}

RULES: Sirf JSON do, koi extra text nahi.`.trim();

        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${DYNAMIC_OPENAI_KEY}` },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [{ role: "system", content: systemPrompt }, ...chatHistory.slice(-10)],
                temperature: 0.3,
                max_tokens: 1200
            })
        });

        if (!openaiRes.ok) {
            const e = await openaiRes.json();
            throw new Error(e.error?.message || "OpenAI API Error");
        }

        const openaiData = await openaiRes.json();
        const rawContent = openaiData.choices[0].message.content.trim();

        let aiResponse;
        try {
            aiResponse = JSON.parse(rawContent.replace(/```json|```/g, '').trim());
        } catch (e) {
            aiResponse = { reply: rawContent, notebook:{save:false}, case:{save:false}, task:{save:false}, reminder:{save:false} };
        }

        const replyText = aiResponse.reply || "कार्य सम्पन्न हुआ।";
        chatHistory.push({ role: 'assistant', content: replyText });

        const now = new Date().toISOString();
        const saves = [];

        if (aiResponse.notebook?.save && aiResponse.notebook?.content) {
            saves.push(addDoc(collection(db, "notebooks"), {
                title: aiResponse.notebook.client||"सामान्य",
                content: aiResponse.notebook.content,
                client: aiResponse.notebook.client||"सामान्य",
                timestamp: now
            }));
            addActivity('📓', 'Notebook updated: ' + (aiResponse.notebook.client||'General'), '#4f46e5');
            addNotif('notebook', '📓 Notebook saved — ' + (aiResponse.notebook.client||'General'), 'AI ne automatically save kiya');
        }

        if (aiResponse.case?.save && aiResponse.case?.content) {
            saves.push(addDoc(collection(db, "notes"), {
                title: aiResponse.case.client||"सामान्य",
                content: aiResponse.case.content,
                client: aiResponse.case.client||"सामान्य",
                mobile: aiResponse.case.mobile||null,
                timestamp: now
            }));
            addActivity('📂', 'Client case saved: ' + (aiResponse.case.client||'General'), '#0891b2');
            addNotif('case', '📂 Client Case updated — ' + (aiResponse.case.client||'General'), aiResponse.case.mobile?'📱 '+aiResponse.case.mobile:'Case record saved');
        }

        if (aiResponse.task?.save && aiResponse.task?.title) {
            saves.push(addDoc(collection(db, "tasks"), {
                title: aiResponse.task.title,
                status: "Pending",
                client: aiResponse.task.client||"सामान्य",
                timestamp: now
            }));
            addActivity('✅', 'Task created: ' + aiResponse.task.title.substring(0,30), '#d97706');
            addNotif('task', '✅ New Task — ' + aiResponse.task.title.substring(0,45), 'Client: '+(aiResponse.task.client||'General'));
        }

        if (aiResponse.reminder?.save && aiResponse.reminder?.title) {
            const remObj = { title: aiResponse.reminder.title, time: aiResponse.reminder.time||"जल्द", client: aiResponse.reminder.client||"सामान्य", timestamp: now };
            saves.push(addDoc(collection(db, "reminders"), remObj));
            addActivity('⏰', 'Reminder set: ' + aiResponse.reminder.title.substring(0,30), '#dc2626');
            addNotif('reminder', '⏰ Reminder set — ' + aiResponse.reminder.title.substring(0,40), '📅 '+(aiResponse.reminder.time||'जल्द'));
            scheduleReminder(remObj);
        }

        saves.push(addDoc(collection(db, "chats"), { role: "assistant", content: replyText, timestamp: now }));
        await Promise.all(saves);

        loadingDiv.remove();
        ui.chatBox.scrollTop = ui.chatBox.scrollHeight;

    } catch (err) {
        loadingDiv.remove();
        const errMsg = `❌ त्रुटि: ${err.message}`;
        await addDoc(collection(db, "chats"), { role: "assistant", content: errMsg, timestamp: new Date().toISOString() });
    } finally {
        isProcessing = false;
        ui.userInput.disabled = false;
        sendBtn.disabled = false;
        sendBtn.classList.remove('opacity-50');
        ui.userInput.focus();
    }
}

document.getElementById('send-btn').addEventListener('click', sendMessage);
ui.userInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

// ══════════════════════════════════════════════════
//  PAGE NAVIGATION HELPERS
// ══════════════════════════════════════════════════

const PAGE_TO_NOTIF = {
    notebook:  ['notebook'],
    notes:     ['case'],
    tasks:     ['task'],
    reminders: ['reminder']
};

function markPageNotifsRead(page) {
    const types = PAGE_TO_NOTIF[page];
    if (!types || typeof NS === 'undefined') return;
    let changed = false;
    NS.items.forEach(item => {
        if (types.includes(item.type) && !item.read) { item.read = true; changed = true; }
    });
    if (changed) {
        NS.unread = NS.items.filter(i => !i.read).length;
        refreshBadges();
        renderNotifList();
        updateNotifBubble();
    }
}

// Wrap switchView for badge clearing
const _baseSwitchView = switchView;
window.switchView = function(targetView) {
    _baseSwitchView(targetView);
    markPageNotifsRead(targetView);
};

['notebook','notes','tasks','reminders'].forEach(v => {
    ['desk','mob'].forEach(sfx => {
        document.getElementById(`tab-${v}-${sfx}`)?.addEventListener('click', () => markPageNotifsRead(v));
    });
});

window.registerUpdate = function() {};
window.toggleUpdPanel = function() {};
window.goToPage  = function(page) { window.switchView(page); };
window.clearAllUpdates = function() {};

// ══════════════════════════════════════════════════
//  NOTIFICATION ENGINE
// ══════════════════════════════════════════════════

const NS = {
    items: [],
    unread: 0,
    filter: 'all',
    pushOK: false,
    scheduledKeys: new Set(),
    savedToday: 0
};

window.openNotifPanel = function() {
    document.getElementById('notif-panel').classList.add('open');
    document.getElementById('notif-overlay').classList.add('open');
    NS.items.forEach(i => i.read = true);
    NS.unread = 0;
    refreshBadges();
    updateNotifBubble();
    renderNotifList();
};
window.closeNotifPanel = function() {
    document.getElementById('notif-panel').classList.remove('open');
    document.getElementById('notif-overlay').classList.remove('open');
};
window.markAllRead = function() {
    NS.items.forEach(i => i.read = true);
    NS.unread = 0;
    refreshBadges();
    updateNotifBubble();
    renderNotifList();
};

document.getElementById('notif-bell-btn').addEventListener('click', openNotifPanel);
document.getElementById('notif-bell-mob')?.addEventListener('click', openNotifPanel);

document.querySelectorAll('.nf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        NS.filter = btn.dataset.nf;
        document.querySelectorAll('.nf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderNotifList();
    });
});

function refreshBadges() {
    const taskUnread = NS.items.filter(i => i.type === 'task'     && !i.read).length;
    const remUnread  = NS.items.filter(i => i.type === 'reminder' && !i.read).length;
    const total      = NS.items.filter(i => !i.read).length;

    ['bell-badge','bell-badge-mob'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (total > 0) { el.textContent = total>9?'9+':total; el.style.display = 'flex'; }
        else el.style.display = 'none';
    });

    const dot = document.getElementById('bell-dot');
    if (dot) dot.style.display = total > 0 ? '' : 'none';

    const tb = document.getElementById('task-badge');
    if (tb) { if(taskUnread>0){tb.textContent=taskUnread>9?'9+':taskUnread;tb.style.display='flex';}else tb.style.display='none'; }
    const rb = document.getElementById('rem-badge');
    if (rb) { if(remUnread>0){rb.textContent=remUnread>9?'9+':remUnread;rb.style.display='flex';}else rb.style.display='none'; }

    const ub = document.getElementById('np-unread-badge');
    if (ub) { if(total>0){ub.textContent=total;ub.style.display='';}else ub.style.display='none'; }
}

function refreshCounters() {
    const tn = document.getElementById('np-task-num');
    const rn = document.getElementById('np-rem-num');
    const sn = document.getElementById('np-saved-num');
    if (tn) tn.textContent = NS.items.filter(i=>i.type==='task').length;
    if (rn) rn.textContent = NS.items.filter(i=>i.type==='reminder').length;
    if (sn) sn.textContent = NS.savedToday;
}

function renderNotifList() {
    const list  = document.getElementById('notif-list');
    const empty = document.getElementById('notif-empty');
    refreshCounters();

    const show = NS.filter === 'all' ? NS.items : NS.items.filter(i => i.type === NS.filter);
    if (show.length === 0) { list.innerHTML = ''; list.appendChild(empty); empty.style.display='block'; return; }
    empty.style.display = 'none';
    list.innerHTML = '';

    const cfg = {
        task:     { bg:'#fbbf24', label:'✅ Task' },
        reminder: { bg:'#ef4444', label:'⏰ Reminder' },
        notebook: { bg:'#6366f1', label:'📓 Notebook' },
        case:     { bg:'#0891b2', label:'📂 Case' },
    };

    [...show].reverse().forEach(item => {
        const c = cfg[item.type] || cfg.notebook;
        const d = document.createElement('div');
        d.className = 'nitem ' + (item.read ? 'read' : 'unread');
        d.innerHTML =
            '<div class="nicon" style="background:' + c.bg + '20;color:' + c.bg + ';font-size:16px;">' +
                (item.type==='task'?'✅':item.type==='reminder'?'⏰':item.type==='notebook'?'📓':'📂') +
            '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<div class="ntitle">' + item.title + '</div>' +
                (item.sub ? '<div class="nsub">' + item.sub + '</div>' : '') +
                '<div class="ntime">' + item.time + '</div>' +
            '</div>' +
            (!item.read ? '<div class="ndot"></div>' : '');
        d.onclick = () => { item.read = true; NS.unread = Math.max(0,NS.unread-1); refreshBadges(); updateNotifBubble(); renderNotifList(); };
        list.appendChild(d);
    });
}

// ── Add notification ──────────────────────────────
window.addNotif = function(type, title, sub) {
    const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
    NS.items.push({ id: Date.now(), type, title, sub: sub||'', time: now, read: false });
    if (type==='notebook'||type==='case') NS.savedToday++;
    NS.unread++;
    refreshBadges();
    refreshCounters();
    renderNotifList();
    updateNotifBubble();         // ← Update mini bubble
    showToast(type, title, sub);
    if (NS.pushOK && document.hidden) browserPush(type, title, sub);
};

// ── Simple text toast (for PIN messages) ─────────
function showToastSimple(msg) {
    const wrap = document.getElementById('toast-wrap');
    const t = document.createElement('div');
    t.className = 'toast t-notebook';
    t.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;';
    t.innerHTML = `<span style="font-size:12px;font-weight:700;color:#fff;">${msg}</span>
        <button onclick="this.closest('.toast').remove()" style="background:none;border:none;color:rgba(255,255,255,.5);cursor:pointer;font-size:13px;padding:0;">✕</button>`;
    wrap.appendChild(t);
    setTimeout(() => { t.style.animation='toastOut .3s ease forwards'; setTimeout(()=>t.remove(),300); }, 4000);
}

// ── In-app toast ──────────────────────────────────
function showToast(type, title, sub) {
    const wrap = document.getElementById('toast-wrap');
    const t = document.createElement('div');
    t.className = 'toast t-' + type;
    const icons  = {task:'✅',reminder:'⏰',notebook:'📓',case:'📂'};
    const colors = {task:'#f59e0b',reminder:'#ef4444',notebook:'#6366f1',case:'#0891b2'};
    t.innerHTML =
        '<div style="width:28px;height:28px;border-radius:8px;background:' + (colors[type]||'#6366f1') + ';display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">' + (icons[type]||'🔔') + '</div>' +
        '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:12px;font-weight:700;color:#fff;line-height:1.3;">' + title + '</div>' +
            (sub ? '<div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + sub + '</div>' : '') +
        '</div>' +
        '<button onclick="this.closest(\'.toast\').remove()" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:13px;padding:0;flex-shrink:0;">✕</button>';
    wrap.appendChild(t);
    setTimeout(() => { t.style.animation='toastOut .3s ease forwards'; setTimeout(()=>t.remove(),300); }, 5000);
}

// ── Browser push ──────────────────────────────────
function browserPush(type, title, body) {
    try {
        const labels = {task:'Task',reminder:'Reminder',notebook:'Notebook',case:'Case'};
        new Notification('CaseDesk AI — ' + (labels[type]||'Update'), {
            body: title + (body ? '\n' + body : ''),
            icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' rx='11' fill='%236366f1'/></svg>",
            tag: 'casedesk-' + type,
            requireInteraction: type === 'reminder'
        });
    } catch(e) {}
}

// ── Enable push permission ────────────────────────
async function enablePush() {
    if (!('Notification' in window)) {
        document.getElementById('push-bar-text').textContent = 'Ye browser notifications support nahi karta.';
        document.getElementById('enable-push-btn').style.display = 'none';
        return;
    }
    const p = await Notification.requestPermission();
    const bar = document.getElementById('push-bar');
    if (p === 'granted') {
        NS.pushOK = true;
        bar.style.background = '#f0fdf4'; bar.style.borderColor = '#bbf7d0';
        bar.innerHTML = '<span style="font-size:11px;font-weight:700;color:#15803d;">✨ Notifications enabled!</span>';
        setTimeout(() => browserPush('notebook','CaseDesk AI connected!','Har task/reminder ka alert milega.'), 500);
    } else {
        document.getElementById('push-bar-text').textContent = 'Permission denied. Browser settings se allow karein.';
        document.getElementById('enable-push-btn').style.display = 'none';
    }
}
document.getElementById('enable-push-btn').addEventListener('click', enablePush);

if ('Notification' in window) {
    if (Notification.permission === 'granted') {
        NS.pushOK = true;
        document.getElementById('push-bar').style.display = 'none';
    } else if (Notification.permission === 'denied') {
        document.getElementById('push-bar-text').textContent = 'Notifications blocked. Browser settings > Allow karein.';
        document.getElementById('enable-push-btn').style.display = 'none';
    }
}

// ── Reminder Scheduler ────────────────────────────
window.scheduleReminder = function(rem) {
    if (!rem.time || rem.time === 'Manual' || rem.time === 'जल्द') return;
    const fireAt = new Date(rem.time);
    if (isNaN(fireAt)) return;
    const key = rem.title + '|' + rem.time;
    if (NS.scheduledKeys.has(key)) return;
    NS.scheduledKeys.add(key);

    const msLeft = fireAt - Date.now();
    if (msLeft > 0 && msLeft < 7 * 24 * 3600 * 1000) {
        setTimeout(() => {
            addNotif('reminder', '⏰ ' + rem.title, rem.client ? 'Client: ' + rem.client : 'Reminder time!');
            if (NS.pushOK) browserPush('reminder', rem.title, rem.client || 'Reminder!');
        }, msLeft);
    } else if (msLeft <= 0 && msLeft > -3600000) {
        addNotif('reminder', '🔴 Overdue: ' + rem.title, rem.client || '');
    }
};
