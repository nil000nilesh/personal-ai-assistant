import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithRedirect, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, where, onSnapshot, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAeu14r8EACZ7U3eRszsNQmTYTFt5FndcU",
    authDomain: "ai-assistant-app-8e733.firebaseapp.com",
    projectId: "ai-assistant-app-8e733",
    storageBucket: "ai-assistant-app-8e733.firebasestorage.app",
    messagingSenderId: "318215944760",
    appId: "1:318215944760:web:2a387b7bcd068da4ff44cd"
};
const ADMIN_EMAIL = "nil000nilesh@gmail.com"; // Sirf yahi admin hai — hardcoded, change nahi hoga
let currentUserPin = ""; // Firestore se fetch hoga per user
let currentUserRole = "user"; // Admin sirf ADMIN_EMAIL ke liye set hoga

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app);

let chatHistory = [];
let allSavedNotes = []; 
let allTasks = [];
let allReminders = [];
let allNotebooks = [];

let isPinVerified = false;
let DYNAMIC_OPENAI_KEY = "";
let OPENAI_MODEL = "gpt-4.1"; // Firebase se override ho sakta hai
let sessionStartTime;
let currentUserEmail = ""; // Logged-in user ki email — data isolation ke liye

const ui = {
    login: document.getElementById('login-screen'),
    pin: document.getElementById('pin-screen'),
    appLayout: document.getElementById('app-layout'),
    viewNotes: document.getElementById('view-notes'),
    viewTasks: document.getElementById('view-tasks'),
    viewReminders: document.getElementById('view-reminders'),
    viewNotebook: document.getElementById('view-notebook'),
    chatBox: document.getElementById('chat-box'),
    notesGrid: document.getElementById('notes-grid'),
    tasksList: document.getElementById('tasks-list'),
    remindersList: document.getElementById('reminders-list'),
    notebookGrid: document.getElementById('notebook-grid'),
    userInput: document.getElementById('user-input'),
    micBtn: document.getElementById('mic-btn'),
    chatModal: document.getElementById('chat-modal'),
    chatModalContent: document.getElementById('chat-modal-content')
};

const views = ['notes', 'tasks', 'reminders', 'notebook'];

// ERROR FIXED HERE: Removing flex class so it hides properly
function hideAllStates() {
    ui.login.classList.add('hidden'); ui.login.classList.remove('flex');
    ui.pin.classList.add('hidden'); ui.pin.classList.remove('flex');
    ui.appLayout.classList.add('hidden'); ui.appLayout.classList.remove('flex');
}

function switchView(targetView) {
    views.forEach(v => {
        const deskBtn = document.getElementById(`tab-${v}-desk`);
        const mobBtn = document.getElementById(`tab-${v}-mob`);
        const viewEl = document.getElementById(`view-${v}`);
        if(v === targetView) {
            viewEl.classList.remove('hidden'); viewEl.classList.add('flex');
            if(deskBtn) deskBtn.classList.add('active');
            if(mobBtn) mobBtn.classList.add('active');
        } else {
            viewEl.classList.add('hidden'); viewEl.classList.remove('flex');
            if(deskBtn) deskBtn.classList.remove('active');
            if(mobBtn) mobBtn.classList.remove('active');
        }
    });
}

// Store reference to original switchView before notification engine overrides
const _baseSwitchView = switchView;
views.forEach(v => {
    document.getElementById(`tab-${v}-desk`)?.addEventListener('click', () => switchView(v));
    document.getElementById(`tab-${v}-mob`)?.addEventListener('click', () => switchView(v));
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
    if(!chatPanel) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = Math.min(390, vw - 40);
    const ph = Math.min(580, vh - 120);
    chatPanel.style.width = pw + 'px';
    chatPanel.style.height = ph + 'px';
    chatPanel.style.right = '20px';
    chatPanel.style.bottom = Math.min(100, vh - ph - 20) + 'px';
    chatPanel.style.left = 'auto';
    chatPanel.style.top = 'auto';
    chatPanel.style.display = 'flex';
    chatPanel.style.opacity = '0';
    chatPanel.style.transform = 'translateY(16px) scale(0.97)';
    requestAnimationFrame(() => {
        chatPanel.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
        chatPanel.style.opacity = '1';
        chatPanel.style.transform = 'translateY(0) scale(1)';
    });
    panelVisible = true;
    unreadCount = 0;
    if(fabBadge) fabBadge.style.display = 'none';
    setTimeout(() => { if(ui.userInput) ui.userInput.focus(); if(ui.chatBox) ui.chatBox.scrollTop = ui.chatBox.scrollHeight; }, 100);
}

function hidePanel() {
    if(!chatPanel) return;
    chatPanel.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
    chatPanel.style.opacity = '0';
    chatPanel.style.transform = 'translateY(14px) scale(0.97)';
    setTimeout(() => { if(chatPanel) { chatPanel.style.display = 'none'; chatPanel.style.display = ''; chatPanel.style.display = 'none'; } }, 180);
    panelVisible = false;
}

fabBtn.addEventListener('click', (e) => {
    if(panelVisible) hidePanel(); else showPanel();
});
document.getElementById('minimise-chat-btn').addEventListener('click', hidePanel);
document.getElementById('close-chat-btn').addEventListener('click', hidePanel);

// ── CLEAR CHAT — New session start karo ──────────────────────────
document.getElementById('clear-chat-btn')?.addEventListener('click', async () => {
    if(!confirm('Nayi chat session shuru karein?\n\nPurani history screen se hat jayegi (data Firestore mein safe rahega).')) return;
    // Reset session timestamp — sirf nayi messages dikhegi
    sessionStartTime = new Date().toISOString();
    chatHistory = [];
    // Clear chat box UI, welcome message raho
    if(ui.chatBox) {
        const welcome = ui.chatBox.firstElementChild;
        ui.chatBox.innerHTML = '';
        if(welcome) ui.chatBox.appendChild(welcome);
    }
    // New session greeting save to Firestore
    try {
        await addDoc(collection(db, "chats"), {
            role: "assistant",
            content: "✨ Nayi chat session shuru hui! Ab fresh start — boliye, kya kaam hai? 😊",
            timestamp: new Date().toISOString(),
            userId: currentUserEmail
        });
    } catch(e) { console.warn('Session reset save failed:', e); }
});

// Activity bar toggle
document.getElementById('toggle-activity-btn').addEventListener('click', () => {
    const bar = document.getElementById('activity-bar');
    bar.style.display = (bar.style.display === 'none' || bar.style.display === '') ? 'block' : 'none';
});

// Add activity entry function
window.addActivity = function(icon, text, color) {
    const feed = document.getElementById('activity-feed');
    const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
    const placeholder = feed.querySelector('[style*="italic"]');
    if(placeholder) placeholder.remove();
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:3px 0;border-bottom:1px solid #f1f5f9;';
    item.innerHTML = '<span style="font-size:12px;flex-shrink:0;">' + icon + '</span>' +
        '<span style="color:' + (color||'#475569') + ';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + text + '</span>' +
        '<span style="color:#94a3b8;font-size:9px;flex-shrink:0;">' + now + '</span>';
    feed.insertBefore(item, feed.firstChild);
    while(feed.children.length > 8) feed.removeChild(feed.lastChild);
    if(!panelVisible && fabBadge) {
        unreadCount++;
        fabBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        fabBadge.style.display = 'flex';
    }
};

// ── DRAG PANEL (header drag) ──────────────────
const dragHandle = document.getElementById('chat-panel-header');
let dragging = false, dragOffX = 0, dragOffY = 0;
dragHandle.addEventListener('mousedown', e => {
    if(e.target.closest('button')) return;
    dragging = true;
    const r = chatPanel.getBoundingClientRect();
    dragOffX = e.clientX - r.left; dragOffY = e.clientY - r.top;
    chatPanel.style.transition = 'none';
    document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', e => {
    if(!dragging) return;
    let nx = e.clientX - dragOffX, ny = e.clientY - dragOffY;
    const pw = chatPanel.offsetWidth, ph = chatPanel.offsetHeight;
    nx = Math.max(0, Math.min(window.innerWidth - pw, nx));
    ny = Math.max(0, Math.min(window.innerHeight - ph, ny));
    chatPanel.style.left = nx + 'px'; chatPanel.style.top = ny + 'px';
    chatPanel.style.right = 'auto';   chatPanel.style.bottom = 'auto';
});
document.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });

// ── DRAG FAB ─────────────────────────────────
let fabDragging = false, fabOX = 0, fabOY = 0, fabMoved = false;
chatFab.addEventListener('mousedown', e => {
    fabDragging = true; fabMoved = false;
    const r = chatFab.getBoundingClientRect();
    fabOX = e.clientX - r.left; fabOY = e.clientY - r.top;
    chatFab.style.transition = 'none';
    document.body.style.userSelect = 'none';
    e.preventDefault();
});
document.addEventListener('mousemove', e => {
    if(!fabDragging) return;
    fabMoved = true;
    let nx = e.clientX - fabOX, ny = e.clientY - fabOY;
    nx = Math.max(8, Math.min(window.innerWidth - chatFab.offsetWidth - 8, nx));
    ny = Math.max(8, Math.min(window.innerHeight - chatFab.offsetHeight - 8, ny));
    chatFab.style.left = nx + 'px'; chatFab.style.top = ny + 'px';
    chatFab.style.right = 'auto';   chatFab.style.bottom = 'auto';
});
document.addEventListener('mouseup', () => { fabDragging = false; document.body.style.userSelect = ''; });

// ── RESIZE PANEL (bottom drag) ────────────────
let resizing = false, rsY = 0, rsH = 0;
document.getElementById('chat-resize').addEventListener('mousedown', e => {
    resizing = true; rsY = e.clientY; rsH = chatPanel.offsetHeight;
    document.body.style.userSelect = 'none'; e.stopPropagation();
});
document.addEventListener('mousemove', e => {
    if(!resizing) return;
    const newH = Math.max(380, Math.min(window.innerHeight - 60, rsH - (e.clientY - rsY)));
    chatPanel.style.height = newH + 'px';
});
document.addEventListener('mouseup', () => { resizing = false; document.body.style.userSelect = ''; });

document.getElementById('login-btn').addEventListener('click', async () => {
    const btn = document.getElementById('login-btn');
    const originalHTML = btn.innerHTML;
    btn.innerText = "Signing in...";
    try { 
        await signInWithPopup(auth, provider); 
    } catch (error) { 
        if(error.code === 'auth/popup-blocked') {
            await signInWithRedirect(auth, provider);
        } else {
            btn.innerHTML = originalHTML;
        }
    }
});

onAuthStateChanged(auth, async (user) => {
    hideAllStates();
    if (user) {
        // ── ADMIN: nil000nilesh@gmail.com — always access, hardcoded ──
        if (user.email === ADMIN_EMAIL) {
            currentUserRole = "admin";
            currentUserEmail = user.email;
            // Bootstrap admin doc if missing
            try {
                const snap = await getDocs(query(collection(db, "allowed_users"), where("email", "==", ADMIN_EMAIL)));
                if (snap.empty) {
                    await setDoc(doc(db, "allowed_users", "admin_master"), {
                        email: ADMIN_EMAIL,
                        name: user.displayName || "Nilesh",
                        pin: "5786",
                        role: "admin",
                        addedAt: new Date().toISOString()
                    });
                    currentUserPin = "5786";
                } else {
                    currentUserPin = snap.docs[0].data().pin || "5786";
                }
            } catch(e) {
                currentUserPin = "5786"; // fallback
            }
            if (!isPinVerified) {
                showPinScreen(user, { name: user.displayName || "Nilesh", email: ADMIN_EMAIL, role: "admin" });
            } else {
                checkAndLoadApp();
            }
            return;
        }

        // ── REGULAR USER: Must be added by admin WITH a PIN ────────────
        try {
            const snap = await getDocs(query(collection(db, "allowed_users"), where("email", "==", user.email)));

            if (!snap.empty) {
                const userData = snap.docs[0].data();

                if (!userData.pin || userData.pin.trim().length !== 4) {
                    hideAllStates();
                    showPinPendingScreen(user);
                    return;
                }

                currentUserPin = userData.pin;
                currentUserRole = "user";
                currentUserEmail = user.email;

                if (!isPinVerified) {
                    showPinScreen(user, { name: userData.name || user.displayName, email: user.email, role: "user" });
                } else {
                    checkAndLoadApp();
                }
            } else {
                hideAllStates();
                showUnauthorizedScreen(user);
            }
        } catch(err) {
            // Firestore rules permission denied — user allowed_users read blocked
            // Firestore rules mein allowed_users read allow karein (niche instructions)
            console.error("Auth check error:", err);
            // Agar permission denied hai to unauthorized screen dikhao
            if(err.code === 'permission-denied') {
                hideAllStates();
                showUnauthorizedScreen(user);
            } else {
                hideAllStates();
                showDbErrorScreen(user, err.message);
            }
        }
    } else { 
        isPinVerified = false;
        ui.login.classList.remove('hidden'); 
        ui.login.classList.add('flex'); 
    }
});

// ── Show "waiting for admin PIN" screen ────────────────────────────
function showPinPendingScreen(user) {
    ui.login.classList.remove('hidden'); ui.login.classList.add('flex');
    const rightPanel = document.querySelector('#login-screen > div:last-child');
    if (!rightPanel) return;
    rightPanel.innerHTML = `
        <div class="absolute inset-0 opacity-[0.03]" style="background-image:radial-gradient(#6366f1 1px,transparent 1px);background-size:24px 24px;"></div>
        <div class="w-full max-w-sm relative z-10 text-center">
            <div class="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center text-3xl" style="background:rgba(245,158,11,0.1);border:2px solid rgba(245,158,11,0.3);">⏳</div>
            <div class="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 mb-5">
                <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                <span class="text-[11px] font-bold text-amber-700 tracking-wide uppercase">Pending Approval</span>
            </div>
            <h3 class="text-2xl font-black text-slate-900 mb-2">PIN Setup Pending</h3>
            <p class="text-slate-500 text-sm mb-6">Aapka account registered hai lekin<br/>Admin ne abhi PIN set nahi kiya hai.</p>
            <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 text-left">
                <div class="text-xs font-black text-amber-700 uppercase tracking-wide mb-2">Logged in as:</div>
                <div class="flex items-center gap-3">
                    <img src="${user.photoURL||''}" class="w-10 h-10 rounded-xl object-cover ${user.photoURL?'':'hidden'}"/>
                    <div>
                        <div class="font-bold text-slate-800 text-sm">${user.displayName || 'User'}</div>
                        <div class="text-xs text-slate-500">${user.email}</div>
                    </div>
                </div>
            </div>
            <p class="text-slate-400 text-xs mb-6">Admin (Nilesh ji) se PIN set karwane ke baad dobara login karein.</p>
            <button onclick="window._doLogout&&window._doLogout()" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-3 rounded-xl font-bold transition-all text-sm">
                🔄 Logout & Try Again
            </button>
        </div>`;
}

// ── Show DB error screen ─────────────────────────────────────────────
function showDbErrorScreen(user, errMsg) {
    ui.login.classList.remove('hidden'); ui.login.classList.add('flex');
    const rightPanel = document.querySelector('#login-screen > div:last-child');
    if (!rightPanel) return;
    rightPanel.innerHTML = `
        <div class="absolute inset-0 opacity-[0.03]" style="background-image:radial-gradient(#6366f1 1px,transparent 1px);background-size:24px 24px;"></div>
        <div class="w-full max-w-sm relative z-10 text-center">
            <div class="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center text-3xl" style="background:rgba(239,68,68,0.1);border:2px solid rgba(239,68,68,0.3);">⚠️</div>
            <h3 class="text-2xl font-black text-slate-900 mb-2">Connection Error</h3>
            <p class="text-slate-500 text-sm mb-3">Firebase Firestore rules mein <strong>allowed_users</strong> collection ka read allow karna hoga.</p>
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-5 text-left text-xs text-slate-600 font-mono">${errMsg||'Permission denied'}</div>
            <p class="text-slate-400 text-xs mb-5">Firebase Console → Firestore → Rules mein update karein</p>
            <button onclick="window._doLogout&&window._doLogout()" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-3 rounded-xl font-bold transition-all text-sm">
                ← Back to Login
            </button>
        </div>`;
}
function showUnauthorizedScreen(user) {
    ui.login.classList.remove('hidden'); ui.login.classList.add('flex');
    const rightPanel = document.querySelector('#login-screen > div:last-child');
    if (!rightPanel) return;
    rightPanel.innerHTML = `
        <div class="absolute inset-0 opacity-[0.03]" style="background-image:radial-gradient(#6366f1 1px,transparent 1px);background-size:24px 24px;"></div>
        <div class="w-full max-w-sm relative z-10 text-center">
            <div class="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center text-3xl" style="background:rgba(239,68,68,0.1);border:2px solid rgba(239,68,68,0.3);">🚫</div>
            <h3 class="text-2xl font-black text-slate-900 mb-2">Access Denied</h3>
            <p class="text-slate-500 text-sm mb-4">Aapka email <strong>${user.email}</strong> is app mein authorized nahi hai.</p>
            <p class="text-slate-400 text-xs mb-6">Admin se apna email add karwane ke baad dobara try karein.</p>
            <button onclick="window._doLogout&&window._doLogout()" class="w-full bg-red-50 hover:bg-red-100 text-red-600 px-6 py-3 rounded-xl font-bold transition-all text-sm border border-red-200">
                ← Back to Login
            </button>
        </div>`;
}

function showPinScreen(user, userDoc) {
    // Clear all PIN boxes first
    document.querySelectorAll('.pin-box').forEach(b => { b.value = ''; b.classList.remove('filled','error'); });
    document.getElementById('pin-input').value = '';
    document.getElementById('verify-pin-btn').disabled = true;
    document.getElementById('pin-error').classList.add('hidden');

    // Set user info
    const name = userDoc?.name || user.displayName || "User";
    const email = user.email || "";
    document.getElementById('pin-user-name').textContent = name;
    document.getElementById('pin-user-email').textContent = email;

    // Avatar
    if (user.photoURL) {
        const img = document.getElementById('pin-user-avatar');
        img.src = user.photoURL; img.classList.remove('hidden');
        document.getElementById('pin-user-initials').classList.add('hidden');
    } else {
        const initials = name.split(' ').map(n=>n[0]||'').join('').toUpperCase().slice(0,2);
        document.getElementById('pin-user-initials').textContent = initials;
    }

    ui.pin.classList.remove('hidden'); ui.pin.classList.add('flex');

    // Auto-focus first box after short delay
    setTimeout(() => { document.querySelector('.pin-box')?.focus(); }, 200);

    // Fetch task + reminder counts for mini widget
    fetchPinWidgetCounts();
}

async function fetchPinWidgetCounts() {
    try {
        const [tasksSnap, remSnap] = await Promise.all([
            getDocs(query(collection(db, "tasks"),     where("userId", "==", currentUserEmail))),
            getDocs(query(collection(db, "reminders"), where("userId", "==", currentUserEmail)))
        ]);
        const now = new Date();

        // Filter active (non-deleted) docs
        const activeTasks = tasksSnap.docs.filter(d => !d.data().deleted);
        const activeRems  = remSnap.docs.filter(d => !d.data().deleted);

        // Total counts
        const totalTasks = activeTasks.length;
        const totalRems  = activeRems.length;

        // Overdue tasks (Pending + past due/timestamp)
        const overdueTaskCount = activeTasks.filter(d => {
            const data = d.data();
            if(data.status === 'Done' || data.status === 'Finished') return false;
            const dueDate = data.dueDate ? new Date(data.dueDate) : (data.timestamp ? new Date(data.timestamp) : null);
            return dueDate && dueDate < now;
        }).length;

        // Overdue reminders (past time, not Closed)
        const overdueRemCount = activeRems.filter(d => {
            const data = d.data();
            if(data.status === 'Closed') return false;
            if(!data.time || data.time === 'Manual' || data.time === 'जल्द') return false;
            const t = new Date(data.time);
            return !isNaN(t) && t < now;
        }).length;

        // Latest task (newest by timestamp, not Done/Finished)
        const pendingTasks = activeTasks
            .map(d => d.data())
            .filter(t => t.status !== 'Done' && t.status !== 'Finished')
            .sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
        const latestTask = pendingTasks[0] || null;

        // Latest reminder (newest by timestamp, not Closed)
        const pendingRems = activeRems
            .map(d => d.data())
            .filter(r => r.status !== 'Closed')
            .sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
        const latestRem = pendingRems[0] || null;

        // Update UI — Totals
        document.getElementById('pin-task-total').textContent = totalTasks;
        document.getElementById('pin-rem-total').textContent = totalRems;

        // Update UI — Overdue row
        const overdueRow = document.getElementById('pin-overdue-row');
        if(overdueTaskCount > 0 || overdueRemCount > 0) {
            overdueRow.classList.remove('hidden');
            overdueRow.classList.add('flex');
            document.getElementById('pin-task-overdue').textContent = overdueTaskCount;
            document.getElementById('pin-rem-overdue').textContent = overdueRemCount;
        }

        // Update UI — Latest items
        const latestSection = document.getElementById('pin-latest-items');
        if(latestTask || latestRem) {
            latestSection.classList.remove('hidden');

            if(latestTask) {
                const ltEl = document.getElementById('pin-latest-task');
                ltEl.classList.remove('hidden');
                document.getElementById('pin-latest-task-title').textContent = latestTask.title || 'Untitled Task';
                const taskDate = latestTask.dueDate ? new Date(latestTask.dueDate) : new Date(latestTask.timestamp);
                const clientStr = latestTask.client ? '👤 ' + latestTask.client + ' · ' : '';
                document.getElementById('pin-latest-task-meta').textContent = clientStr + '📅 ' + taskDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
            }

            if(latestRem) {
                const lrEl = document.getElementById('pin-latest-rem');
                lrEl.classList.remove('hidden');
                document.getElementById('pin-latest-rem-title').textContent = latestRem.title || 'Untitled Reminder';
                const remTime = latestRem.time && latestRem.time !== 'Manual' && latestRem.time !== 'जल्द' ? new Date(latestRem.time) : null;
                const clientStr = latestRem.client ? '👤 ' + latestRem.client + ' · ' : '';
                document.getElementById('pin-latest-rem-meta').textContent = clientStr + (remTime ? '📅 ' + remTime.toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : '📌 Manual');
            }
        }

        document.getElementById('pin-notif-widget').classList.remove('hidden');
    } catch(e) { console.error('Quick Peek error:', e); }
}

const doLogout = () => {
    isPinVerified = false;
    DYNAMIC_OPENAI_KEY = "";
    currentUserPin = "";
    currentUserRole = "user";
    currentUserEmail = "";
    // Reset overdue popup so it shows again on next login
    window.overduePopupShown = false;
    window._overdueTasksReady = false;
    window._overdueRemReady = false;
    // Clear PIN boxes
    document.querySelectorAll('.pin-box').forEach(b => { b.value = ''; b.classList.remove('filled','error'); });
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-error').classList.add('hidden');
    document.getElementById('pin-notif-widget').classList.add('hidden');
    signOut(auth); 
};
window._doLogout = doLogout; // For use in dynamically rendered screens
document.getElementById('logout-btn-desk').addEventListener('click', doLogout);
document.getElementById('logout-btn-mob').addEventListener('click', doLogout);
document.getElementById('pin-logout-btn').addEventListener('click', doLogout);

// ── OTP-style 4-box PIN input ──────────────────────────────────────
const pinBoxes = document.querySelectorAll('.pin-box');
const pinHiddenInput = document.getElementById('pin-input');
const verifyBtn = document.getElementById('verify-pin-btn');
const pinError = document.getElementById('pin-error');

pinBoxes.forEach((box, i) => {
    box.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g,'');
        box.value = val ? val[0] : '';
        if (val) {
            box.classList.add('filled');
            // Move to next
            if (i < 3) pinBoxes[i+1].focus();
        } else {
            box.classList.remove('filled');
        }
        updatePinFromBoxes();
    });
    box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
            if (!box.value && i > 0) {
                pinBoxes[i-1].value = '';
                pinBoxes[i-1].classList.remove('filled');
                pinBoxes[i-1].focus();
                updatePinFromBoxes();
                e.preventDefault();
            }
        }
        if (e.key === 'Enter' && !verifyBtn.disabled) {
            doVerifyPin();
        }
    });
    // Prevent paste of multiple chars into one box — handle paste on first box
    box.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'');
        if (!pasted) return;
        pasted.split('').slice(0,4).forEach((ch, idx) => {
            if (pinBoxes[idx]) { pinBoxes[idx].value = ch; pinBoxes[idx].classList.add('filled'); }
        });
        updatePinFromBoxes();
        const nextEmpty = Math.min(pasted.length, 3);
        pinBoxes[nextEmpty]?.focus();
    });
});

function updatePinFromBoxes() {
    const pin = [...pinBoxes].map(b=>b.value).join('');
    pinHiddenInput.value = pin;
    verifyBtn.disabled = pin.length < 4;
    pinError.classList.add('hidden');
    pinBoxes.forEach(b => b.classList.remove('error'));
}

function doVerifyPin() {
    const enteredPin = pinHiddenInput.value;
    if (enteredPin === currentUserPin) {
        isPinVerified = true;
        checkAndLoadApp();
    } else {
        pinError.classList.remove('hidden');
        pinBoxes.forEach(b => { b.classList.add('error'); setTimeout(()=>b.classList.remove('error'), 500); });
        // Clear boxes after shake
        setTimeout(() => {
            pinBoxes.forEach(b => { b.value = ''; b.classList.remove('filled','error'); });
            pinHiddenInput.value = '';
            verifyBtn.disabled = true;
            pinBoxes[0].focus();
        }, 500);
    }
}

document.getElementById('verify-pin-btn').addEventListener('click', doVerifyPin);

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

            // Show admin button only for admin role
            if (currentUserRole === 'admin') {
                const adminNav = document.getElementById('admin-nav-item');
                if (adminNav) adminNav.style.display = 'block';
            }
            
            switchView('notebook');
            loadAppListeners();
            setupAdminPanel();
        } else { 
            alert("API Key missing in Database!");
            ui.login.classList.remove('hidden'); ui.login.classList.add('flex');
            signOut(auth);
        }
    } catch (error) { 
        alert("Database connection failed."); 
        console.error(error);
    }
}

function loadAppListeners() {
    // ── Data isolation ──────────────────────────────────────────────────
    // Admin: saara data (purana + naya, bina userId field wala bhi)
    // User: sirf apna data (userId == apna email)
    const uid = currentUserEmail;
    const isAdminUser = (currentUserRole === 'admin');

    // ── CHAT ────────────────────────────────────────────────────────────
    const chatQ = isAdminUser
        ? query(collection(db, "chats"))
        : query(collection(db, "chats"), where("userId", "==", uid));

    onSnapshot(chatQ, (snapshot) => {
        const welcomeMsg = ui.chatBox.firstElementChild;
        ui.chatBox.innerHTML = "";
        if(welcomeMsg) ui.chatBox.appendChild(welcomeMsg);
        const msgs = [];
        snapshot.forEach(d => { const m = d.data(); if(isAdminUser && m.userId && m.userId !== ADMIN_EMAIL) return; if((m.timestamp||'') >= sessionStartTime) msgs.push(m); });
        msgs.sort((a,b) => (a.timestamp||'').localeCompare(b.timestamp||''));
        chatHistory = [];
        msgs.forEach(msg => {
            chatHistory.push({ role: msg.role, content: msg.content });
            renderMessage(msg.role, msg.content);
        });
        ui.chatBox.scrollTop = ui.chatBox.scrollHeight;
    });

    // ── NOTES (Client Cases) ────────────────────────────────────────────
    // Admin: sirf apna data (userId==adminEmail) + purana data (no userId field)
    // User: sirf apna data (userId==email)
    const notesQ = isAdminUser
        ? query(collection(db, "notes"))
        : query(collection(db, "notes"), where("userId", "==", uid));

    // ── Notes state for search/sort/filter ──────────────────────────────
    let notesSearchQ = '', notesSortQ = 'new', notesStatusFilter = 'all';
    let allGroupedNotes = {}; // persistent grouped data

    function getStatus(latestContent) {
        const c = latestContent.toLowerCase();
        // Priority order — most specific first
        if(/disburse ho gaya|disbursed|वितरण हो गया|वितरण पूर्ण|loan disbursed|ऋण वितरित/.test(c)) return 'Disbursed';
        if(/\brejected\b|अस्वीकृत|loan rejected|ऋण अस्वीकृत/.test(c)) return 'Rejected';
        // Sanctioned — strict: must be "Sanctioned" as status, not just "sanction process"
        if(/status:\s*sanctioned|\bsanctioned\b|sanction ho gaya|स्वीकृत हो गया|ऋण स्वीकृत है/.test(c)) return 'Sanctioned';
        if(/mortgage|मॉर्गेज/.test(c)) return 'Mortgage';
        if(/processing start|processing ho raha|प्रोसेसिंग में है/.test(c)) return 'Processing';
        // Pending — strict: only if "status: pending" or "स्थिति: लंबित" — NOT "pending documents"
        if(/status:\s*pending|स्थिति[:\s]*लंबित|case.*pending|application.*pending/.test(c)) return 'Pending';
        // Active — check explicit status field first
        if(/status:\s*active/.test(c)) return 'Active';
        return 'Active';
    }

    function fmtDateN(ts) { return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
    function fmtTimeN(ts) { return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }

    function renderNotes() {
        const grid = ui.notesGrid;
        const emptyEl = document.getElementById('notes-empty');
        const countEl = document.getElementById('notes-count');
        grid.innerHTML = '';

        let entries = Object.values(allGroupedNotes);

        // Status filter
        if(notesStatusFilter !== 'all') {
            entries = entries.filter(g => {
                const latest = g.updates[g.updates.length - 1];
                return getStatus(latest?.content || '') === notesStatusFilter;
            });
        }

        // Search
        if(notesSearchQ) {
            const q = notesSearchQ.toLowerCase();
            entries = entries.filter(g =>
                g.displayTitle.toLowerCase().includes(q) ||
                (g.mobile||'').includes(q) ||
                (g.account||'').includes(q) ||
                (g.address||'').toLowerCase().includes(q) ||
                g.updates.some(u => (u.content||'').toLowerCase().includes(q))
            );
        }

        // Sort
        entries.sort((a, b) => {
            const aT = Math.max(...a.updates.map(u => new Date(u.timestamp)));
            const bT = Math.max(...b.updates.map(u => new Date(u.timestamp)));
            if(notesSortQ === 'new') return bT - aT; // newest first
            if(notesSortQ === 'old') return aT - bT;
            if(notesSortQ === 'az')  return a.displayTitle.localeCompare(b.displayTitle);
            if(notesSortQ === 'za')  return b.displayTitle.localeCompare(a.displayTitle);
            return 0;
        });

        if(countEl) countEl.textContent = entries.length + ' Case' + (entries.length !== 1 ? 's' : '');
        if(emptyEl) { if(entries.length === 0) emptyEl.classList.remove('hidden'); else emptyEl.classList.add('hidden'); }

        const statusMeta = {
            'Active':    { badge:'🔵 Active',    grad:'from-blue-600 to-indigo-700' },
            'Pending':   { badge:'⏳ Pending',   grad:'from-amber-500 to-orange-600' },
            'Processing':{ badge:'🔄 Processing',grad:'from-indigo-500 to-blue-700' },
            'Sanctioned':{ badge:'✔️ Sanctioned',grad:'from-teal-600 to-emerald-700' },
            'Disbursed': { badge:'✅ Disbursed', grad:'from-emerald-600 to-green-700' },
            'Rejected':  { badge:'❌ Rejected',  grad:'from-red-600 to-rose-700' },
            'Mortgage':  { badge:'📑 Mortgage',  grad:'from-purple-600 to-violet-700' },
        };

        entries.forEach(group => {
            const latestUpdate = [...group.updates].sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''))[0];
            // Use explicit status field if available, else detect from content
            const status = latestUpdate?.status || getStatus(latestUpdate?.content || '');
            const meta = statusMeta[status] || statusMeta['Active'];
            const sortedUpdates = [...group.updates].sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));

            // Info chips: only show if data exists
            const chips = [];
            if(group.mobile)  chips.push(`📱 ${group.mobile}`);
            if(group.account) chips.push(`🏦 ${group.account}`);
            if(group.address) chips.push(`📍 ${group.address}`);
            chips.push(`📋 ${group.updates.length} Update${group.updates.length>1?'s':''}`);
            chips.push(`🕐 ${fmtDateN(latestUpdate.timestamp)}`);

            const headerHTML = `
                <div class="bg-gradient-to-br ${meta.grad} px-5 py-4 relative overflow-hidden flex-shrink-0">
                    <div class="absolute -right-4 -top-4 w-20 h-20 bg-white/5 rounded-full"></div>
                    <div class="flex items-start justify-between gap-2 mb-2 relative">
                        <div>
                            <p class="text-white/40 text-[9px] font-black uppercase tracking-widest">📁 CLIENT CASE</p>
                            <h3 class="font-black text-white text-lg leading-tight">${group.displayTitle}</h3>
                        </div>
                        <span class="text-[9px] font-black px-2 py-1 rounded-full bg-white/20 text-white border border-white/20 shrink-0">${meta.badge}</span>
                    </div>
                    <div class="flex flex-wrap gap-1 text-[9px] font-bold relative">
                        ${chips.map(c=>`<span class="bg-white/10 border border-white/10 text-white/70 px-2 py-0.5 rounded-full">${c}</span>`).join('')}
                    </div>
                </div>`;

            const updatesHTML = sortedUpdates.map((u, idx) => {
                const isLatest = idx === 0;
                let displayContent = u.content || '';
                if(notesSearchQ) {
                    const rx = new RegExp('(' + notesSearchQ.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
                    displayContent = displayContent.replace(rx, '<mark class="bg-yellow-200 rounded px-0.5">$1</mark>');
                }
                return `<div class="px-4 py-3 border-b border-slate-50 last:border-0 ${isLatest ? 'bg-blue-50/30' : ''}">
                    <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span class="text-[9px] font-black px-2 py-0.5 rounded-full ${isLatest ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}">📅 ${fmtDateN(u.timestamp)} ⏰ ${fmtTimeN(u.timestamp)}</span>
                        ${isLatest ? '<span class="text-[8px] font-black text-white bg-blue-500 px-2 py-0.5 rounded-full">LATEST</span>' : ''}
                        <span class="text-[9px] text-slate-300 ml-auto">#${sortedUpdates.length - idx}</span>
                    </div>
                    <p class="text-slate-700 text-sm leading-relaxed font-medium whitespace-pre-wrap devanagari">${displayContent}</p>
                </div>`;
            }).join('');

            const card = document.createElement('div');
            card.className = 'bg-white rounded-2xl shadow-sm hover:shadow-lg border border-slate-100 overflow-hidden transition-all duration-200 flex flex-col';
            card.innerHTML = headerHTML + `<div class="overflow-y-auto max-h-[280px] client-updates-scroll divide-y divide-slate-50">${updatesHTML}</div>`;
            grid.appendChild(card);
        });
    }

    onSnapshot(notesQ, (snapshot) => {
        allSavedNotes = []; allGroupedNotes = {};
        const docs = [];
        snapshot.forEach(d => {
            const data = d.data();
            if(isAdminUser && data.userId && data.userId !== ADMIN_EMAIL) return;
            if(data.deleted) return;
            docs.push(data);
        });
        docs.sort((a,b) => (a.timestamp||'').localeCompare(b.timestamp||''));
        docs.forEach(note => {
            allSavedNotes.push(note);
            const key = (note.client || note.title || 'सामान्य').toUpperCase();
            const name = note.client || note.title || 'सामान्य';
            if(!allGroupedNotes[key]) allGroupedNotes[key] = { displayTitle: name, mobile: null, account: null, address: null, updates: [] };
            const g = allGroupedNotes[key];
            // Extract mobile if not set
            if(!g.mobile && note.mobile) g.mobile = note.mobile;
            if(!g.mobile) { const m = (note.content||'').match(/\b[6-9]\d{9}\b/); if(m) g.mobile = m[0]; }
            // Extract account number
            if(!g.account && note.account) g.account = note.account;
            if(!g.account) { const a = (note.content||'').match(/खाता\s*(?:संख्या)?[:：]?\s*([\d\/]+)/i); if(a) g.account = a[1]; }
            // Extract address
            if(!g.address && note.address) g.address = note.address;
            g.updates.push(note);
        });
        renderNotes();
    });

    // Notes search
    document.getElementById('notes-search')?.addEventListener('input', e => { notesSearchQ = e.target.value.toLowerCase(); renderNotes(); });
    // Notes sort
    document.getElementById('notes-sort')?.addEventListener('change', e => { notesSortQ = e.target.value; renderNotes(); });
    // Notes status filter
    document.getElementById('notes-status-filter')?.addEventListener('change', e => { notesStatusFilter = e.target.value; renderNotes(); });

    // TASKS — with search, filter, status toggle, priority, due date
    let taskCurrentFilter = 'all';
    let taskSearchQuery = '';

    function renderTasks() {
        const list = document.getElementById('tasks-list');
        const empty = document.getElementById('task-empty');
        const pendingCount = document.getElementById('task-pending-count');
        const doneCount = document.getElementById('task-done-count');
        const finishedCount = document.getElementById('task-finished-count');
        list.innerHTML = '';

        // Active tasks = not Finished
        const activeTasks = allTasks.filter(t => t.status !== 'Finished');
        const finishedTasks = allTasks.filter(t => t.status === 'Finished');

        let filtered;
        if(taskCurrentFilter === 'Finished') {
            filtered = finishedTasks.filter(t => {
                const matchSearch = !taskSearchQuery || (t.title||'').toLowerCase().includes(taskSearchQuery) ||
                    (t.client||'').toLowerCase().includes(taskSearchQuery);
                return matchSearch;
            });
        } else {
            filtered = activeTasks.filter(t => {
                const matchFilter = taskCurrentFilter === 'all' || t.status === taskCurrentFilter ||
                    (taskCurrentFilter === 'Urgent' && t.priority === 'Urgent');
                const matchSearch = !taskSearchQuery || (t.title||'').toLowerCase().includes(taskSearchQuery) ||
                    (t.client||'').toLowerCase().includes(taskSearchQuery);
                return matchFilter && matchSearch;
            });
        }

        const pending = activeTasks.filter(t => t.status !== 'Done').length;
        const done    = activeTasks.filter(t => t.status === 'Done').length;
        if(pendingCount) pendingCount.textContent = pending + ' Pending';
        if(doneCount) doneCount.textContent = done + ' Done';
        if(finishedCount) finishedCount.textContent = finishedTasks.length + ' Finished';

        if(filtered.length === 0) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        filtered.forEach((task, idx) => {
            const isDone = task.status === 'Done';
            const isFinished = task.status === 'Finished';
            const isUrgent = task.priority === 'Urgent';
            const now = new Date();
            const isOverdue = task.dueDate ? new Date(task.dueDate) < now && !isDone && !isFinished
                : task.timestamp ? new Date(task.timestamp) < now && !isDone && !isFinished
                : false;
            const d = new Date(task.timestamp);
            const dateStr = d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
            const timeStr = d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});

            let priorityBadge = '';
            if(isUrgent && !isFinished) priorityBadge = '<span class="text-[10px] font-black text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">🚨 URGENT</span>';

            let dueBadge = '';
            if(task.dueDate) {
                const due = new Date(task.dueDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
                dueBadge = `<span class="text-[10px] font-bold ${isOverdue ? 'text-red-600 bg-red-50' : 'text-slate-500 bg-slate-100'} px-2 py-0.5 rounded-full">📅 ${due}</span>`;
            }

            let statusBadge = '';
            if(isFinished)
                statusBadge = '<span class="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">🏆 Finished</span>';
            else if(isDone)
                statusBadge = '<span class="text-[10px] font-black text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">✅ Done</span>';
            else if(isOverdue)
                statusBadge = '<span class="text-[10px] font-black text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full animate-pulse">🔴 Overdue</span>';
            else
                statusBadge = '<span class="text-[10px] font-black text-orange-700 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-full">⏳ Pending</span>';

            // Finished date
            let finishedBadge = '';
            if(isFinished && task.finishedAt) {
                const fd = new Date(task.finishedAt);
                finishedBadge = `<span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">🏁 ${fd.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span>`;
            }

            const div = document.createElement('div');
            div.className = `bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all group ${isFinished ? 'opacity-70 border-emerald-200 bg-emerald-50/30' : isDone ? 'opacity-60 border-slate-100' : isOverdue ? 'border-red-200' : 'border-slate-100 hover:border-blue-200'}`;
            div.innerHTML = `
                <div class="p-4 flex items-start gap-4">
                    <!-- Checkbox -->
                    ${isFinished ? `<div class="mt-1 flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 border-2 border-emerald-500 flex items-center justify-center">
                        <svg class="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                    </div>` : `<button class="task-check-btn mt-1 flex-shrink-0 w-6 h-6 rounded-full border-2 ${isDone ? 'bg-green-500 border-green-500' : 'border-slate-300 hover:border-blue-400'} flex items-center justify-center transition-all" data-idx="${idx}">
                        ${isDone ? '<svg class="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>' : ''}
                    </button>`}
                    <!-- Content -->
                    <div class="flex-1 min-w-0">
                        <p class="font-semibold text-slate-800 text-base leading-snug devanagari ${isFinished ? 'line-through text-slate-400' : isDone ? 'line-through text-slate-400' : ''}">${task.title}</p>
                        <div class="flex flex-wrap gap-2 mt-2 items-center">
                            ${task.client ? `<span class="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">👤 ${task.client}</span>` : ''}
                            ${dueBadge}
                            ${priorityBadge}
                            ${finishedBadge}
                            <span class="text-[10px] text-slate-400 font-semibold ml-auto">🕐 ${dateStr} ${timeStr}</span>
                        </div>
                    </div>
                    <!-- Status badge -->
                    <div class="flex-shrink-0">${statusBadge}</div>
                </div>`;
            list.appendChild(div);
        });

        // Checkbox toggle — persist to Firestore
        list.querySelectorAll('.task-check-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const idx = parseInt(btn.dataset.idx);
                const task = filtered[idx];
                if(!task || !task._docId) return;
                const newStatus = task.status === 'Done' ? 'Pending' : 'Done';
                // Optimistic UI update
                task.status = newStatus;
                renderTasks();
                // Persist to Firestore
                try {
                    await updateDoc(doc(db, 'tasks', task._docId), { status: newStatus });
                } catch(err) {
                    console.error('Task status update error:', err);
                    task.status = newStatus === 'Done' ? 'Pending' : 'Done'; // revert
                    renderTasks();
                }
            });
        });
    }

    // ── TASKS ────────────────────────────────────────────────────────────
    const tasksQ = isAdminUser
        ? query(collection(db, "tasks"))
        : query(collection(db, "tasks"), where("userId", "==", uid));

    onSnapshot(tasksQ, (snapshot) => {
        allTasks = [];
        snapshot.forEach(d => {
            const data = d.data();
            if(isAdminUser && data.userId && data.userId !== ADMIN_EMAIL) return;
            if(data.deleted) return;
            allTasks.push({ ...data, _docId: d.id });
        });
        // Client-side sort: timestamp desc (newest first)
        allTasks.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
        renderTasks();
        // Update notif panel task counter
        const pendingForNotif = allTasks.filter(t => t.status !== 'Done' && t.status !== 'Finished').length;
        const tn = document.getElementById('np-task-num');
        if(tn) tn.textContent = pendingForNotif;
        // Notify overdue popup system that tasks are ready
        if(window._onTasksLoaded) window._onTasksLoaded();
    });

    // Task search
    document.getElementById('task-search')?.addEventListener('input', e => {
        taskSearchQuery = e.target.value.toLowerCase();
        renderTasks();
    });

    // Task filter buttons
    document.getElementById('task-filter-btns')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-filter]');
        if(!btn) return;
        taskCurrentFilter = btn.dataset.filter;
        document.querySelectorAll('.task-filter-btn').forEach(b => {
            b.className = b === btn
                ? 'task-filter-btn text-[11px] font-bold px-3 py-2 rounded-xl border bg-blue-600 text-white border-blue-600'
                : 'task-filter-btn text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200 text-slate-600 bg-slate-50';
        });
        renderTasks();
    });

    // REMINDERS — with search, filter, overdue detection, countdown
    let remCurrentFilter = 'all';
    let remSearchQuery = '';

    function parseRemDate(timeStr) {
        if(!timeStr || timeStr === 'Manual' || timeStr === 'जल्द') return null;
        const d = new Date(timeStr);
        return isNaN(d) ? null : d;
    }

    function renderReminders() {
        const list = document.getElementById('reminders-list');
        const empty = document.getElementById('rem-empty');
        const upcomingEl = document.getElementById('rem-upcoming-count');
        const overdueEl = document.getElementById('rem-overdue-count');
        const closedEl = document.getElementById('rem-closed-count');
        list.innerHTML = '';
        const now = new Date();

        // Separate active and closed reminders
        const activeReminders = allReminders.filter(r => r.status !== 'Closed');
        const closedReminders = allReminders.filter(r => r.status === 'Closed');

        let filtered;
        if(remCurrentFilter === 'closed') {
            filtered = closedReminders.filter(r => {
                const matchSearch = !remSearchQuery || (r.title||'').toLowerCase().includes(remSearchQuery) ||
                    (r.client||'').toLowerCase().includes(remSearchQuery);
                return matchSearch;
            });
        } else {
            filtered = activeReminders.filter(r => {
                const d = parseRemDate(r.time);
                const isOverdue = d && d < now;
                const isToday = d && d.toDateString() === now.toDateString();
                const matchFilter = remCurrentFilter === 'all' ||
                    (remCurrentFilter === 'today' && isToday) ||
                    (remCurrentFilter === 'overdue' && isOverdue) ||
                    (remCurrentFilter === 'upcoming' && d && d >= now);
                const matchSearch = !remSearchQuery || (r.title||'').toLowerCase().includes(remSearchQuery) ||
                    (r.client||'').toLowerCase().includes(remSearchQuery);
                return matchFilter && matchSearch;
            });
        }

        const upcoming = activeReminders.filter(r => { const d=parseRemDate(r.time); return d && d >= now; }).length;
        const overdue  = activeReminders.filter(r => { const d=parseRemDate(r.time); return d && d < now; }).length;
        if(upcomingEl) upcomingEl.textContent = upcoming + ' Upcoming';
        if(overdueEl)  overdueEl.textContent  = overdue  + ' Overdue';
        if(closedEl)   closedEl.textContent   = closedReminders.length + ' Closed';

        if(filtered.length === 0) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        filtered.forEach(rem => {
            const remDate = parseRemDate(rem.time);
            const isClosed = rem.status === 'Closed';
            const isOverdue = !isClosed && remDate && remDate < now;
            const isToday   = !isClosed && remDate && remDate.toDateString() === now.toDateString();
            const isManual  = !remDate;

            let cardColor, dotColor, timeLabel;
            if(isClosed)        { cardColor = 'from-emerald-50 to-green-50 border-emerald-200'; dotColor = 'bg-emerald-500'; timeLabel = '🏁 Closed'; }
            else if(isOverdue)  { cardColor = 'from-red-50 to-red-100 border-red-200'; dotColor = 'bg-red-500'; timeLabel = '🔴 Overdue'; }
            else if(isToday)    { cardColor = 'from-orange-50 to-amber-50 border-amber-200'; dotColor = 'bg-amber-500'; timeLabel = '🟠 Today'; }
            else if(isManual)   { cardColor = 'from-slate-50 to-slate-100 border-slate-200'; dotColor = 'bg-slate-400'; timeLabel = '📌 Manual'; }
            else                { cardColor = 'from-blue-50 to-indigo-50 border-blue-200'; dotColor = 'bg-blue-500'; timeLabel = '🟢 Upcoming'; }

            let formattedTime = rem.time;
            if(remDate) {
                formattedTime = remDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
                if(remDate.getHours() || remDate.getMinutes())
                    formattedTime += ' — ' + remDate.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
            }

            // Days countdown
            let countdownBadge = '';
            if(isClosed && rem.finishedAt) {
                const fd = new Date(rem.finishedAt);
                countdownBadge = `<span class="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">🏁 ${fd.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span>`;
            } else if(remDate && !isOverdue) {
                const diff = Math.ceil((remDate - now) / (1000*60*60*24));
                countdownBadge = diff === 0
                    ? '<span class="text-[10px] font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full animate-pulse">Today!</span>'
                    : `<span class="text-[10px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">in ${diff}d</span>`;
            } else if(isOverdue) {
                const diff = Math.ceil((now - remDate) / (1000*60*60*24));
                countdownBadge = `<span class="text-[10px] font-black text-red-700 bg-red-100 px-2 py-0.5 rounded-full">${diff}d ago</span>`;
            }

            const div = document.createElement('div');
            div.className = `bg-gradient-to-br ${cardColor} border p-5 rounded-2xl shadow-sm flex flex-col gap-3 relative overflow-hidden hover:shadow-md transition-all ${isClosed ? 'opacity-70' : ''}`;
            div.innerHTML = `
                <div class="absolute -right-3 -top-3 text-5xl opacity-[0.07] select-none">${isClosed ? '🏁' : '⏰'}</div>
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full ${dotColor} ${isOverdue||isToday ? 'animate-pulse' : ''}"></span>
                        <span class="text-xs font-black text-slate-600 uppercase tracking-wide">${timeLabel}</span>
                    </div>
                    ${countdownBadge}
                </div>
                <p class="font-bold ${isClosed ? 'text-slate-400 line-through' : 'text-slate-800'} text-base leading-snug devanagari">${rem.title}</p>
                <div class="flex flex-wrap gap-2 items-center mt-1">
                    <span class="text-[11px] font-bold text-slate-500 bg-white/60 px-2 py-0.5 rounded-lg">📅 ${formattedTime}</span>
                    ${rem.client ? `<span class="text-[10px] font-bold text-blue-600 bg-white/60 px-2 py-0.5 rounded-lg">👤 ${rem.client}</span>` : ''}
                </div>`;
            list.appendChild(div);
        });
    }

    // ── REMINDERS ────────────────────────────────────────────────────────
    const remindersQ = isAdminUser
        ? query(collection(db, "reminders"))
        : query(collection(db, "reminders"), where("userId", "==", uid));

    onSnapshot(remindersQ, (snapshot) => {
        allReminders = [];
        snapshot.forEach(d => {
            const data = d.data();
            if(isAdminUser && data.userId && data.userId !== ADMIN_EMAIL) return;
            if(data.deleted) return;
            allReminders.push({ ...data, _docId: d.id });
        });
        // Client-side sort: timestamp desc
        allReminders.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
        renderReminders();
        // Schedule browser push for all upcoming reminders on load
        allReminders.forEach(rem => { if(window.scheduleReminder) scheduleReminder(rem); });
        // Update reminder count in notif panel
        const upcomingCount = allReminders.filter(r => {
            const d = new Date(r.time); return !isNaN(d) && d >= new Date();
        }).length;
        const rn = document.getElementById('np-rem-num');
        if(rn) rn.textContent = upcomingCount;
        // Notify overdue popup system that reminders are ready
        if(window._onRemindersLoaded) window._onRemindersLoaded();
    });

    // Reminders search
    document.getElementById('rem-search')?.addEventListener('input', e => {
        remSearchQuery = e.target.value.toLowerCase();
        renderReminders();
    });

    // Reminders filter buttons
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

    // NOTEBOOK — grouped by client, search, sort, filter, grid/list toggle
    let nbSearchQuery = '';
    let nbSort = 'new';
    let nbFilterClient = 'all';
    let nbViewGrid = true;

    function renderNotebook() {
        const grid = document.getElementById('notebook-grid');
        const empty = document.getElementById('nb-empty');
        const countEl = document.getElementById('nb-count');
        grid.innerHTML = '';

        // Group by client
        let grouped = {};
        let allClientNames = new Set();
        allNotebooks.forEach(page => {
            const key = (page.client || page.title || 'सामान्य').toUpperCase();
            const name = page.client || page.title || 'सामान्य';
            allClientNames.add(name);
            if(!grouped[key]) grouped[key] = { displayName: name, updates: [] };
            grouped[key].updates.push(page);
        });

        // Populate client filter dropdown
        const filterEl = document.getElementById('nb-filter');
        if(filterEl && filterEl.options.length <= 1) {
            allClientNames.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name; opt.textContent = '👤 ' + name;
                filterEl.appendChild(opt);
            });
        }

        // Filter by client
        let entries = Object.values(grouped).filter(g => {
            if(nbFilterClient !== 'all' && g.displayName !== nbFilterClient) return false;
            if(!nbSearchQuery) return true;
            return g.displayName.toLowerCase().includes(nbSearchQuery) ||
                g.updates.some(u => (u.content||'').toLowerCase().includes(nbSearchQuery));
        });

        // Sort
        entries.sort((a, b) => {
            const aLatest = Math.max(...a.updates.map(u => new Date(u.timestamp)));
            const bLatest = Math.max(...b.updates.map(u => new Date(u.timestamp)));
            if(nbSort === 'new') return bLatest - aLatest;
            if(nbSort === 'old') return aLatest - bLatest;
            if(nbSort === 'az')  return a.displayName.localeCompare(b.displayName);
            return 0;
        });

        if(countEl) countEl.textContent = allNotebooks.length + ' notes';
        grid.className = nbViewGrid
            ? 'grid grid-cols-1 xl:grid-cols-2 gap-6 pb-20 items-start'
            : 'flex flex-col gap-4 pb-20';

        if(entries.length === 0) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        entries.forEach(group => {
            const card = document.createElement('div');
            card.className = "bg-white rounded-[1.5rem] shadow-sm hover:shadow-xl border border-l-[8px] border-yellow-400 border-slate-200 relative transition-all duration-300 overflow-hidden group";

            const sortedUpdates = [...group.updates].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
            const latest = sortedUpdates[0];

            function fmtDate(ts) { return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
            function fmtTime(ts) { return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }

            const headerHTML = `
                <div class="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
                    <div>
                        <div class="text-[10px] text-yellow-400 font-black uppercase tracking-widest mb-0.5">📋 क्लाइंट नोट</div>
                        <h3 class="font-black text-xl tracking-tight">${group.displayName}</h3>
                    </div>
                    <div class="text-right">
                        <div class="text-[10px] text-slate-400 mb-0.5">कुल अपडेट</div>
                        <div class="text-yellow-400 text-2xl font-black">${group.updates.length}</div>
                    </div>
                </div>`;

            const updatesHTML = sortedUpdates.map((page, idx) => {
                let displayContent = page.content || '';
                if(nbSearchQuery) {
                    const regex = new RegExp('(' + nbSearchQuery + ')', 'gi');
                    displayContent = displayContent.replace(regex, '<mark class="bg-yellow-200 rounded px-0.5">$1</mark>');
                }
                const isLatest = idx === 0;
                const dDate = new Date(page.timestamp).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
                const dTime = new Date(page.timestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
                const updateNum = group.updates.length - idx;
                const badgeClass = isLatest ? 'bg-yellow-400 text-slate-900 font-black' : 'bg-slate-100 text-slate-400';
                return '<div class="px-6 py-4 border-b border-slate-50 last:border-b-0 ' + (isLatest ? 'bg-yellow-50/30' : '') + '">' +
                    '<div class="flex items-center gap-2 mb-2 flex-wrap">' +
                    '<span class="text-[10px] font-black px-2 py-0.5 rounded-full ' + (isLatest ? 'bg-yellow-100 text-yellow-800' : 'bg-slate-100 text-slate-500') + '">📅 ' + dDate + '</span>' +
                    '<span class="text-[10px] font-bold text-slate-400">⏰ ' + dTime + '</span>' +
                    '<span class="text-[9px] font-bold px-2 py-0.5 rounded-full ml-auto ' + badgeClass + '">#' + updateNum + '</span>' +
                    '</div>' +
                    '<div class="text-slate-700 text-sm leading-relaxed devanagari font-medium whitespace-pre-wrap">' + displayContent + '</div>' +
                    '</div>';
            }).join('');

            card.innerHTML = headerHTML + `<div class="divide-y divide-slate-50 max-h-[300px] overflow-y-auto client-updates-scroll">${updatesHTML}</div>`;
            grid.appendChild(card);
        });
    }

    // ── NOTEBOOKS ────────────────────────────────────────────────────────
    const notebooksQ = isAdminUser
        ? query(collection(db, "notebooks"))
        : query(collection(db, "notebooks"), where("userId", "==", uid));

    onSnapshot(notebooksQ, (snapshot) => {
        allNotebooks = [];
        snapshot.forEach(d => {
            const data = d.data();
            if(isAdminUser && data.userId && data.userId !== ADMIN_EMAIL) return;
            if(data.deleted) return;
            allNotebooks.push(data);
        });
        // Client-side sort: timestamp desc
        allNotebooks.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
        renderNotebook();
    });

    // Notebook search
    document.getElementById('nb-search')?.addEventListener('input', e => {
        nbSearchQuery = e.target.value.toLowerCase();
        renderNotebook();
    });

    // Notebook sort
    document.getElementById('nb-sort')?.addEventListener('change', e => {
        nbSort = e.target.value;
        renderNotebook();
    });

    // Notebook filter
    document.getElementById('nb-filter')?.addEventListener('change', e => {
        nbFilterClient = e.target.value;
        renderNotebook();
    });

    // Notebook grid/list toggle
    document.getElementById('nb-view-toggle')?.addEventListener('click', () => {
        nbViewGrid = !nbViewGrid;
        document.getElementById('nb-view-toggle').textContent = nbViewGrid ? '⊞ Grid' : '☰ List';
        renderNotebook();
    });
}


function renderMessage(role, content) {
    const div = document.createElement('div');
    div.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'} w-full`;
    const bubble = document.createElement('div');
    if(role === 'user') {
        bubble.className = "p-4 md:p-5 rounded-2xl max-w-[85%] text-sm md:text-base leading-relaxed bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md rounded-tr-sm";
    } else {
        bubble.className = "p-4 md:p-5 rounded-2xl max-w-[85%] text-sm md:text-base leading-relaxed bg-white border border-slate-200 text-slate-700 shadow-sm rounded-tl-sm";
    }
    bubble.textContent = content;
    div.appendChild(bubble);
    ui.chatBox.appendChild(div);
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
let isRecording = false;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'hi-IN';

    recognition.onstart = () => { isRecording = true; ui.micBtn.classList.add('recording'); ui.userInput.placeholder = "Listening..."; };
    recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) ui.userInput.value += event.results[i][0].transcript + ' ';
            else interimTranscript += event.results[i][0].transcript;
        }
    };
    recognition.onend = () => { isRecording = false; ui.micBtn.classList.remove('recording'); ui.userInput.placeholder = "Type a command or tap mic..."; };
    ui.micBtn.addEventListener('click', () => { if (isRecording) recognition.stop(); else recognition.start(); });
} else { ui.micBtn.style.display = 'none'; }

let isProcessing = false;

// ═══════════════════════════════════════════════════════════════
//  REAL AI ENGINE — OpenAI GPT-4o powered sendMessage
// ═══════════════════════════════════════════════════════════════
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

    await addDoc(collection(db, "chats"), {
        role: "user", content: text, timestamp: new Date().toISOString(),
        userId: currentUserEmail
    });

    // Loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.className = "flex justify-start w-full";
    loadingDiv.innerHTML = `<div class="p-4 rounded-2xl bg-white border border-slate-200 text-blue-500 text-sm font-bold animate-pulse shadow-sm flex items-center gap-2"><span class="text-xl">🤖</span> AI सोच रहा है...</div>`;
    ui.chatBox.appendChild(loadingDiv);
    ui.chatBox.scrollTop = ui.chatBox.scrollHeight;

    try {
        // ── 1. FETCH DATA FROM FIREBASE FOR AI CONTEXT ──────────────────
        // Admin = saara data, User = sirf apna
        const ctxQuery = (col) => currentUserRole === 'admin'
            ? getDocs(collection(db, col))
            : getDocs(query(collection(db, col), where("userId", "==", currentUserEmail)));

        const [notebooksSnap, notesSnap, tasksSnap, remindersSnap] = await Promise.all([
            ctxQuery("notebooks"),
            ctxQuery("notes"),
            ctxQuery("tasks"),
            ctxQuery("reminders")
        ]);

        const notebookData = notebooksSnap.docs.map(d => d.data());
        const casesData    = notesSnap.docs.map(d => d.data());
        const tasksData    = tasksSnap.docs.map(d => d.data());
        const remindersData= remindersSnap.docs.map(d => d.data());

        // Summarise saved data for AI context
        function summarize(arr, fields) {
            return arr.slice(-30).map(item =>
                fields.map(f => `${f}: ${item[f] || ''}`).join(' | ')
            ).join('\n');
        }

        const savedContext = `
=== SAVED NOTEBOOKS (last 30) ===
${summarize(notebookData, ['client','content','timestamp'])}

=== CLIENT CASES (last 30) ===
${summarize(casesData, ['client','content','mobile','account','address','timestamp'])}

=== TASKS (last 30) ===
${summarize(tasksData, ['title','status','client','timestamp'])}

=== REMINDERS (last 30) ===
${summarize(remindersData, ['title','time','client','timestamp'])}
        `.trim();

        // ── 2. SYSTEM PROMPT — Smart update, no repetition ──────────────
        const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

        // Group existing notes by client for AI context
        const existingClients = {};
        [...casesData, ...notebookData].forEach(item => {
            const key = (item.client || '').toUpperCase();
            if(key) {
                if(!existingClients[key]) existingClients[key] = { name: item.client, updates: [] };
                existingClients[key].updates.push({ ts: item.timestamp, content: item.content });
            }
        });
        const clientSummary = Object.values(existingClients).map(c => {
            const sorted = c.updates.sort((a,b) => (b.ts||'').localeCompare(a.ts||''));
            return `CLIENT: ${c.name}\nLATEST UPDATE: ${sorted[0]?.content?.substring(0,200)||''}\nTOTAL UPDATES: ${sorted.length}`;
        }).join('\n---\n');

        const systemPrompt = `You are CaseDesk AI — a smart, conversational personal banking assistant and case manager. Think and talk like a real helpful coworker, NOT like a bot. Today: ${today}
User: ${currentUserEmail}

YOUR PERSONALITY:
- Talk like a warm, smart coworker — natural Hinglish (Hindi + English mix)
- Be conversational — ask follow-up questions, suggest things, give opinions
- Be proactive — if you see something useful in data, mention it
- Use emojis naturally but don't overdo it
- NEVER write code, JSON, or technical content in reply field
- Give proper greetings for hi/hello/namaste/good morning/kya haal etc

USER'S SAVED DATA — Search this carefully for every query:
=== CLIENT CASES ===
${clientSummary || 'Koi case data nahi abhi tak'}

=== TASKS ===
${tasksData.filter(t=>!t.deleted).map(t=>`[${t.status||'Pending'}] ${t.title} | Client: ${t.client||'-'} | Due: ${t.dueDate||t.timestamp||'-'}`).join('\n') || 'Koi task nahi'}

=== REMINDERS ===
${remindersData.filter(r=>!r.deleted).map(r=>`[${r.status||'Active'}] ${r.title} | Time: ${r.time} | Client: ${r.client||'-'}`).join('\n') || 'Koi reminder nahi'}

=== NOTEBOOKS ===
${notebookData.filter(n=>!n.deleted).slice(-20).map(n=>`Client: ${n.client||'-'} | ${(n.content||'').substring(0,200)}`).join('\n') || 'Koi notebook entry nahi'}

CONVERSATION RULES — Follow these STRICTLY:

1. NOTES & CLIENT CASES → AUTO-SAVE (bina puche) — PROFESSIONAL BANKING SECRETARY:
   You are a professional banking secretary assistant. When user gives any client note, info, or update, AUTOMATICALLY process it and structure it.

   ═══ NOTE PROCESSING FORMAT ═══
   When saving case.content, structure it EXACTLY like this:

   📋 [CLIENT NAME] — Secretary Draft

   🏢 CLIENT INFORMATION
   Client Name: [extracted name]
   Contact Person(s): [extracted person names with श्री/जी honorifics]
   Account No: [CC/account number if mentioned]
   Mobile: [phone number if mentioned]
   Address: [location if mentioned]
   Status: [current case status — Active/Pending/Processing/Sanctioned/Disbursed/Rejected]

   📝 SECRETARY DRAFT NOTE
   Rewrite the raw note in FORMAL HINDI (Devanagari script), date-wise chronological order.
   Each entry: दिनांक: [DD माह YYYY] | समय: [HH:MM AM/PM]
   Then formal summary using professional secretary language.

   ✅ TASKS
   List ALL actionable tasks extracted from the note as numbered items.
   Each task = clear and actionable (e.g. "1. Updated CMA प्राप्त करें — Pravin Patidar के CA से")

   🔔 REMINDERS
   List time-sensitive items: ⏰ [Date, Time] — [Action required]
   (e.g. "⏰ आज — 10 Mar 2026, दोपहर 2:00 बजे — Pravin Patidar जी से telephonic follow-up")

   ⏳ PENDING
   List items awaiting response/documents/confirmation from external parties.
   (e.g. "* CA से final profit projection confirmation")

   ═══ WRITING RULES ═══
   - FORMAL SARKARI HINDI: "सूचित किया जाता है", "कार्यवाही प्रारंभ की जाएगी", "अनुमोदन प्रतीक्षित है"
   - Banking/system terms in ENGLISH: CMA, Balance Sheet, P&L, Sanction, Disbursement, Mortgage, CC Account, Tejas, CIBIL
   - Names with RESPECT: "श्री [Name] जी", "[Name] महोदय"
   - Communication: "दूरभाष पर चर्चा संपन्न हुई", "telephonic follow-up किया गया"
   - If date/time missing from note entry → write "Date/Time not specified"
   - DO NOT add any information not present in original note
   - Keep secretary draft FORMAL and CONCISE
   - If multiple date entries exist → process each separately in chronological order
   - Each update = SELF-CONTAINED and readable on its own

   ═══ EXAMPLE OUTPUT (follow this exact style) ═══
   "📋 Paawan Bio Energy — Secretary Draft\n\n🏢 CLIENT INFORMATION\nClient Name: Paawan Bio Energy\nContact Person: श्री Pravin Patidar जी\nCC Account No: 389005/614\nCA Status: Final confirmation pending\n\n📝 SECRETARY DRAFT NOTE\nदिनांक: 28 फरवरी 2026 | समय: 12:28 PM\nमॉर्गेज दस्तावेज़ीकरण कार्य सम्पन्न किया गया एवं ऋण स्वीकृति संबंधित आवश्यक कार्यवाही पूर्ण की गई।\n\nदिनांक: 10 मार्च 2026 | समय: 10:33 AM\nPaawan Bio Energy के संदर्भ में सूचित किया जाता है कि CMA verification हेतु प्रस्तुति भेजी जा चुकी है। श्री Pravin Patidar जी से दूरभाष पर प्रारंभिक चर्चा संपन्न हुई है, तथापि उनके CA द्वारा अंतिम अनुमोदन अभी प्रतीक्षित है। CA महोदय के अनुसार आगामी वर्षों में लाभ में उल्लेखनीय वृद्धि अपेक्षित है, जिसके परिणामस्वरूप कर देयता में भी वृद्धि होगी।\n\nUpdated CMA, Estimated Balance Sheet एवं P&L Statement प्राप्त होते ही CC Account सं. 389005/614 हेतु Tejas प्रणाली में स्वीकृति की कार्यवाही प्रारंभ की जाएगी।\n\n✅ TASKS\n1. Updated CMA प्राप्त करें — Pravin Patidar के CA से\n2. Estimated Balance Sheet & P&L प्राप्त करें — CA confirmation के बाद\n3. Tejas में Sanction Process करें — दस्तावेज़ मिलते ही (CC A/c 389005/614)\n\n🔔 REMINDERS\n⏰ आज — 10 Mar 2026, दोपहर 2:00 बजे — Pravin Patidar जी से telephonic follow-up — CA confirmation status\n\n⏳ PENDING\n* CA से final profit projection confirmation\n* Updated CMA / Balance Sheet / P&L documents"

   ═══ FIELD EXTRACTION (CRITICAL) ═══
   • case.client = client/company name (ALWAYS fill — e.g. "Paawan Bio Energy")
   • case.mobile = 10-digit phone number (e.g. "9753332926")
   • case.account = CC/account number (e.g. "389005/614")
   • case.address = address/location (if available)
   • case.status = EXACTLY ONE of: "Active" / "Pending" / "Processing" / "Sanctioned" / "Disbursed" / "Rejected" / "Mortgage"
     → Extract from user's words: "Active hai", "Pending hai", "Sanctioned ho gaya", "Disburse ho gaya" etc.
     → If user mentions "Active" → "Active"; "Pending" → "Pending"; default = "Active"
     → NEVER leave blank — always set one of the 7 values above

   ═══ ALSO AUTO-EXTRACT TASKS & REMINDERS ═══
   - Jab case save karo, content mein se tasks/reminders EXTRACT karo:
     → Action items (document lana, follow-up, process karna) → task.save = true bhi set karo
     → Time-bound items (kal 2 baje call, next week meeting) → reminder.save = true bhi set karo
   - Ek message mein case + task + reminder TEENO simultaneously save ho sakte hain!

   ═══ NOTEBOOK vs CASE ═══
   - Client personal info + banking/loan updates → case.save = true
   - General notes/observations/non-client content → notebook.save = true
   - BOTH can be true simultaneously

   ═══ AFTER SAVING ═══
   - Reply mein structured summary do in Hinglish (NOT the full draft — just key points)
   - Confirm: "Save ho gaya! ✅"
   - Mention extracted tasks & reminders in reply
   - Agar same client ki pehle se entry hai, naya update add karo (purana mat hatao)

2. TASKS → PEHLE PUCHO, PHIR SAVE KARO:
   - Jab user koi kaam bataye ya information se task ban sakta ho → PEHLE pucho:
     "Yeh task bana doon? 📋 [task title] — Client: [name] — Deadline: [suggested date]. Haan ya nahi?"
   - task.save = false rakhna jab tak user confirm na kare
   - Jab user "haan/yes/bana do/kar do/ok/theek hai" bole → TAB task.save = true karo
   - Suggest a realistic dueDate based on context (agar user ne date nahi batai)
   - Agar user explicitly bole "task bana do" ya "task save karo" → directly save (no need to ask)

3. REMINDERS → SMART SAVE:
   - Agar user EXPLICITLY bole "reminder set karo" / "yaad dila dena" / "remind karo" / "reminder bana do" / "reminder add karo" → DIRECTLY save (reminder.save = true), puche bina!
   - Agar user ne time bhi bataya hai (jaise "2 baje", "kal subah", "15 March ko") → ISO 8601 format mein convert karke reminder.time mein daalo
   - Agar user ne time nahi bataya → time = "Manual" set karo, but STILL save karo
   - Sirf jab information se INDIRECTLY reminder ban sakta ho (user ne nahi bola) → TAB pucho:
     "Iska reminder set karun? ⏰ [title] — Time: [suggested time]. Haan ya nahi?"
   - Jab user confirm kare ("haan/yes/ok/theek hai") → TAB reminder.save = true karo
   - IMPORTANT: reminder.time MUST be valid ISO 8601 (e.g. "2026-03-15T14:00:00") ya "Manual"

4. UPDATE EXISTING DATA:
   - Jab user bole "task update karo / status change karo / timeline badh do / reminder ka time badal do":
     → update.action = true set karo
     → update.collection = "tasks" / "reminders" / "notes" / "notebooks"
     → update.matchTitle = exact title or closest match from saved data
     → update.matchClient = client name to find the right document
     → update.fields = { only fields that need to change }
       For tasks: { status, title, dueDate, priority, client }
       For reminders: { title, time, client, status }
       For notes/notebooks: { content, client, mobile, account, address }
   - After update, confirm: "Update ho gaya! ✅"

5. DELETE REQUEST:
   - Jab user bole "hatao / delete karo / remove karo / band karo":
     → softDelete.action = true
   - Confirm: "Hata diya! 🗑️"

6. FINISH TASK / CLOSE REMINDER:
   - "Task finish karo / complete karo" → update task status to "Finished"
   - "Reminder band karo / close karo" → update reminder status to "Closed"
   - Use update.action for these (NOT softDelete)

7. SEARCH & ANSWER:
   - Jab user puche "kya pending hai / client kahan hai / kya status hai / kitne task hain":
     → Search saved data carefully, give COMPLETE detailed answer
     → Mention overdue items proactively
     → If asked about timelines, calculate from dates in data

8. OUT OF SCOPE:
   - Coding/poem/math/translate/non-banking topics:
     → Reply: "Maafi chahta hoon 🙏 Yeh meri expertise se bahar hai. Main aapka case manager hoon — client cases, tasks, reminders mein madad kar sakta hoon. Kaise help karun? 😊"
     → All save flags = false

9. UPDATES — ALWAYS SAVE AS NEW ENTRY:
   - Jab bhi user kisi existing client ke baare mein NEW information deta hai → ALWAYS case.save = true karo
   - Har update ek ALAG naya document hota hai Firestore mein — purana delete ya merge NAHI hota
   - "Same client ka data already hai" — yeh save karne se NAHI rokta
   - Sirf exact same sentence repeat hone par (copy-paste) hi save mat karo
   - Har naya update: alag timestamp, alag content, same client name → case.save = true HAMESHA
   - Example: Ramesh Patidar ka pehle case bana → ab uska CIBIL score bata rahe ho → PHIR BHI case.save = true

RESPONSE FORMAT — ALWAYS valid JSON only, NO backticks, NO extra text outside JSON:
{
  "reply": "Warm Hinglish response. When saving: give structured summary (client, key update, tasks extracted, reminders set). Confirm with Save ho gaya ✅. Min 2 sentences. NEVER write code/JSON/markdown tables here.",
  "softDelete": { "action": false, "collection": "", "clientName": "", "title": "" },
  "update": { "action": false, "collection": "", "matchTitle": "", "matchClient": "", "fields": {} },
  "notebook": { "save": false, "client": "", "content": "" },
  "case": { "save": false, "client": "", "mobile": null, "account": null, "address": null, "status": "", "content": "" },
  "task": { "save": false, "client": "", "title": "", "dueDate": "", "priority": "" },
  "reminder": { "save": false, "client": "", "title": "", "time": "" }
}

softDelete.collection = "notes" / "tasks" / "reminders" / "notebooks"
update.collection = "tasks" / "reminders" / "notes" / "notebooks"
update.fields = only include fields that changed
task.dueDate = ISO 8601 format (e.g. "2026-03-15T00:00:00")
task.priority = "Urgent" or "" (empty for normal)
reminder.time = ISO 8601 format or "Manual" or "जल्द"`.trim();

        // ── 3. CALL OPENAI GPT-4o ───────────────────────────────────
        const messages = [
            { role: "system", content: systemPrompt },
            ...chatHistory.slice(-16) // last 16 messages for better conversation context
        ];

        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${DYNAMIC_OPENAI_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: messages,
                temperature: 0.4,
                max_tokens: 1500
            })
        });

        if (!openaiRes.ok) {
            const errData = await openaiRes.json();
            throw new Error(errData.error?.message || "OpenAI API Error");
        }

        const openaiData = await openaiRes.json();
        const rawContent = openaiData.choices[0].message.content.trim();

        // ── 4. PARSE AI RESPONSE ────────────────────────────────────
        let aiResponse;
        try {
            // Strip code fences if any
            const clean = rawContent.replace(/```json|```/g, '').trim();
            aiResponse = JSON.parse(clean);
        } catch(e) {
            // If AI returned plain text (not JSON), show it directly
            aiResponse = { reply: rawContent, notebook: { save: false }, case: { save: false }, task: { save: false }, reminder: { save: false }, update: { action: false }, softDelete: { action: false } };
        }

        const replyText = aiResponse.reply || "कार्य सम्पन्न हुआ।";
        chatHistory.push({ role: 'assistant', content: replyText });

        // ── 5. SAVE TO FIREBASE BASED ON AI DECISION ───────────────
        const now = new Date().toISOString();
        const savePromises = [];

        if (aiResponse.notebook?.save && aiResponse.notebook?.content) {
            savePromises.push(addDoc(collection(db, "notebooks"), {
                title: aiResponse.notebook.client || "सामान्य",
                content: aiResponse.notebook.content,
                client: aiResponse.notebook.client || "सामान्य",
                timestamp: now,
                userId: currentUserEmail          // ← User isolation
            }));
            if(window.addActivity) addActivity('📓', 'Notebook updated: ' + (aiResponse.notebook.client || 'General'), '#4f46e5');
            addNotif('notebook', '📓 Notebook saved — ' + (aiResponse.notebook.client || 'General'), 'AI ne automatically save kiya');
            if(window.registerUpdate) registerUpdate('notebook', aiResponse.notebook.client || '');
        }

        if (aiResponse.case?.save && aiResponse.case?.content) {
            savePromises.push(addDoc(collection(db, "notes"), {
                title: aiResponse.case.client || "सामान्य",
                content: aiResponse.case.content,
                client: aiResponse.case.client || "सामान्य",
                mobile: aiResponse.case.mobile || null,
                account: aiResponse.case.account || null,
                address: aiResponse.case.address || null,
                status: aiResponse.case.status || null,   // ← explicit status field
                timestamp: now,
                userId: currentUserEmail          // ← User isolation
            }));
            if(window.addActivity) addActivity('📂', 'Client case saved: ' + (aiResponse.case.client || 'General'), '#0891b2');
            addNotif('case', '📂 Client Case updated — ' + (aiResponse.case.client || 'General'), aiResponse.case.mobile ? '📱 ' + aiResponse.case.mobile : 'Case record saved');
            if(window.registerUpdate) registerUpdate('case', aiResponse.case.client || '');
        }

        if (aiResponse.task?.save && aiResponse.task?.title) {
            const taskObj = {
                title: aiResponse.task.title,
                status: "Pending",
                client: aiResponse.task.client || "सामान्य",
                timestamp: now,
                userId: currentUserEmail
            };
            if(aiResponse.task.dueDate) taskObj.dueDate = aiResponse.task.dueDate;
            if(aiResponse.task.priority) taskObj.priority = aiResponse.task.priority;
            const taskDocRef = addDoc(collection(db, "tasks"), taskObj);
            savePromises.push(taskDocRef);
            // Optimistic local push — onSnapshot will sync shortly
            allTasks.unshift({ ...taskObj, _docId: '_pending_' + now });
            if(typeof renderTasks === 'function') renderTasks();
            if(window.addActivity) addActivity('✅', 'Task created: ' + aiResponse.task.title.substring(0,30), '#d97706');
            addNotif('task', '✅ New Task — ' + aiResponse.task.title.substring(0,45), 'Client: ' + (aiResponse.task.client || 'General'));
            if(window.registerUpdate) registerUpdate('task', aiResponse.task.client || '');
        }

        if (aiResponse.reminder?.save && aiResponse.reminder?.title) {
            const remObj = {
                title: aiResponse.reminder.title,
                time: aiResponse.reminder.time || "जल्द",
                client: aiResponse.reminder.client || "सामान्य",
                timestamp: now,
                userId: currentUserEmail
            };
            savePromises.push(addDoc(collection(db, "reminders"), remObj));
            // Optimistic local push — onSnapshot will sync shortly
            allReminders.unshift({ ...remObj, _docId: '_pending_' + now });
            if(typeof renderReminders === 'function') renderReminders();
            if(window.addActivity) addActivity('⏰', 'Reminder set: ' + aiResponse.reminder.title.substring(0,30), '#dc2626');
            addNotif('reminder', '⏰ Reminder set — ' + aiResponse.reminder.title.substring(0,40), '📅 ' + (aiResponse.reminder.time || 'जल्द'));
            scheduleReminder(remObj);
            if(window.registerUpdate) registerUpdate('reminder', aiResponse.reminder.client || '');
        }

        // ── UPDATE HANDLER — Update existing tasks/reminders/notes/notebooks ─
        if (aiResponse.update?.action) {
            const upd = aiResponse.update;
            const colName = upd.collection || '';
            const matchTitle = (upd.matchTitle || '').toLowerCase().trim();
            const matchClient = (upd.matchClient || '').toLowerCase().trim();
            if (colName && (matchTitle || matchClient)) {
                try {
                    const qSnap = await getDocs(query(
                        collection(db, colName),
                        where("userId", "==", currentUserEmail)
                    ));
                    let bestMatch = null;
                    let bestScore = 0;
                    qSnap.forEach(d => {
                        const data = d.data();
                        if(data.deleted) return;
                        const docTitle = (data.title || '').toLowerCase().trim();
                        const docClient = (data.client || '').toLowerCase().trim();
                        let score = 0;
                        if(matchTitle && (docTitle.includes(matchTitle) || matchTitle.includes(docTitle))) score += 2;
                        if(matchClient && (docClient.includes(matchClient) || matchClient.includes(docClient))) score += 1;
                        if(score > bestScore) { bestScore = score; bestMatch = d; }
                    });
                    if(bestMatch && upd.fields && Object.keys(upd.fields).length > 0) {
                        await updateDoc(doc(db, colName, bestMatch.id), upd.fields);
                        if(window.addActivity) addActivity('📝', 'Updated: ' + (matchTitle || matchClient), '#2563eb');
                        addNotif('task', '📝 Updated — ' + (matchTitle || matchClient), 'AI ne update kiya');
                    }
                } catch(err) {
                    console.error('Update error:', err);
                    if(window.addNotif) addNotif('error', '❌ Update failed', err.message || 'Update mein error aaya');
                }
            }
        }

        // ── SOFT DELETE HANDLER ──────────────────────────────────────────
        if (aiResponse.softDelete?.action) {
            const sd = aiResponse.softDelete;
            const colName = sd.collection || '';
            const matchName = (sd.clientName || sd.title || '').toLowerCase().trim();
            if (colName && matchName) {
                try {
                    const qSnap = await getDocs(query(
                        collection(db, colName),
                        where("userId", "==", currentUserEmail)
                    ));
                    const updateJobs = [];
                    qSnap.forEach(d => {
                        const data = d.data();
                        if(data.deleted) return;
                        const nameField = (data.client || data.title || '').toLowerCase().trim();
                        if (nameField.includes(matchName) || matchName.includes(nameField)) {
                            updateJobs.push(
                                updateDoc(doc(db, colName, d.id), { deleted: true, deletedAt: new Date().toISOString() })
                            );
                        }
                    });
                    if (updateJobs.length > 0) {
                        await Promise.all(updateJobs);
                        if(window.addActivity) addActivity('🗑️', 'Removed: ' + matchName, '#ef4444');
                        addNotif('case', '🗑️ Removed — ' + matchName, 'Restore ke liye AI se bolo');
                    }
                } catch(err) {
                    console.error('Soft delete error:', err);
                    if(window.addNotif) addNotif('error', '❌ Delete failed', err.message || 'Delete mein error aaya');
                }
            }
        }

        // Save AI reply to chat
        savePromises.push(addDoc(collection(db, "chats"), {
            role: "assistant", content: replyText, timestamp: now,
            userId: currentUserEmail              // ← User isolation
        }));

        await Promise.all(savePromises);

        // ── 6. RENDER AI REPLY — onSnapshot se automatically render hoga
        loadingDiv.remove();
        ui.chatBox.scrollTop = ui.chatBox.scrollHeight;

    } catch (err) {
        loadingDiv.remove();
        const errMsg = `❌ त्रुटि: ${err.message}`;
        await addDoc(collection(db, "chats"), {
            role: "assistant", content: errMsg, timestamp: new Date().toISOString(),
            userId: currentUserEmail
        });
    } finally {
        isProcessing = false;
        ui.userInput.disabled = false;
        sendBtn.disabled = false;
        sendBtn.classList.remove('opacity-50');
        ui.userInput.focus();
    }
}

document.getElementById('send-btn').addEventListener('click', sendMessage);
ui.userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });





// ╔══════════════════════════════════════════════════════════════╗
// ║  PAGE VISIT BADGE CLEARING (Update Panel Removed)            ║
// ╚══════════════════════════════════════════════════════════════╝

const PAGE_MAP = {
    notebook: 'notebook',
    case:     'notes',
    task:     'tasks',
    reminder: 'reminders'
};

// Stub — AI save code calls this, keep as no-op
window.registerUpdate = function() {};
window.toggleUpdPanel = function() {};
window.goToPage = function(page) { if(window.switchView) switchView(page); };
window.clearAllUpdates = function() {};

// Notification type mapping: page → notification types
const PAGE_TO_NOTIF = {
    notebook:  ['notebook'],
    notes:     ['case'],
    tasks:     ['task'],
    reminders: ['reminder']
};

// Mark notifications as read when visiting a page
function markPageNotifsRead(page) {
    const types = PAGE_TO_NOTIF[page];
    if(!types || typeof NS === 'undefined') return;
    let changed = false;
    NS.items.forEach(item => {
        if(types.includes(item.type) && !item.read) {
            item.read = true;
            changed = true;
        }
    });
    if(changed) {
        NS.unread = NS.items.filter(i => !i.read).length;
        refreshBadges();
        renderNotifList();
    }
}

// Wrap switchView to clear badges on page visit
const _baseSwitchViewUP = switchView;
window.switchView = function(targetView) {
    _baseSwitchViewUP(targetView);
    markPageNotifsRead(targetView);
};

// Also hook tab clicks to mark as read
['notebook','notes','tasks','reminders'].forEach(v => {
    ['desk','mob'].forEach(suffix => {
        const btn = document.getElementById('tab-' + v + '-' + suffix);
        if(btn) btn.addEventListener('click', () => markPageNotifsRead(v));
    });
});

// ╔══════════════════════════════════════════════════════════════╗
// ║          CASEDESK AI — NOTIFICATION ENGINE                  ║
// ╚══════════════════════════════════════════════════════════════╝

const NS = {
    items: [],          // { id, type, title, sub, time, read, ts }
    unread: 0,
    filter: 'all',
    pushOK: false,
    scheduledKeys: new Set(),   // reminder keys already scheduled
    savedToday: 0
};

// ─── Panel open / close ──────────────────────────────────────────
window.openNotifPanel = function() {
    document.getElementById('notif-panel').classList.add('open');
    document.getElementById('notif-overlay').classList.add('open');
    // Mark all as read when panel opens
    NS.items.forEach(i => i.read = true);
    NS.unread = 0;
    refreshBadges();
    renderNotifList();
}
window.closeNotifPanel = function() {
    document.getElementById('notif-panel').classList.remove('open');
    document.getElementById('notif-overlay').classList.remove('open');
}
window.markAllRead = function() {
    NS.items.forEach(i => i.read = true);
    NS.unread = 0;
    refreshBadges();
    renderNotifList();
}

document.getElementById('notif-bell-btn').addEventListener('click', openNotifPanel);
document.getElementById('notif-bell-mob')?.addEventListener('click', openNotifPanel);

// ─── Filter tabs ─────────────────────────────────────────────────
document.querySelectorAll('.nf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        NS.filter = btn.dataset.nf;
        document.querySelectorAll('.nf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderNotifList();
    });
});

// ─── Refresh all badges ──────────────────────────────────────────
function refreshBadges() {
    const taskUnread = NS.items.filter(i => i.type === 'task' && !i.read).length;
    const remUnread  = NS.items.filter(i => i.type === 'reminder' && !i.read).length;
    const total      = NS.items.filter(i => !i.read).length;

    // Bell badge (sidebar + mobile)
    ['bell-badge','bell-badge-mob'].forEach(id => {
        const el = document.getElementById(id);
        if(!el) return;
        if(total > 0) { el.textContent = total > 9 ? '9+' : total; el.style.display = 'flex'; }
        else el.style.display = 'none';
    });
    // Bell dot SVG
    const dot = document.getElementById('bell-dot');
    if(dot) dot.style.display = total > 0 ? '' : 'none';

    // Task badge on sidebar — only unread task notifications
    const tb = document.getElementById('task-badge');
    if(tb) {
        if(taskUnread > 0) { tb.textContent = taskUnread>9?'9+':taskUnread; tb.style.display='flex'; }
        else tb.style.display='none';
    }
    // Reminder badge on sidebar — only unread reminder notifications
    const rb = document.getElementById('rem-badge');
    if(rb) {
        if(remUnread > 0) { rb.textContent = remUnread>9?'9+':remUnread; rb.style.display='flex'; }
        else rb.style.display='none';
    }
    // Panel header unread badge
    const ub = document.getElementById('np-unread-badge');
    if(ub) { if(total>0){ub.textContent=total;ub.style.display='';} else ub.style.display='none'; }
}

// ─── Refresh summary counters in panel header ────────────────────
function refreshCounters() {
    const now = new Date();
    // Count pending tasks in NS
    const taskCount = NS.items.filter(i=>i.type==='task').length;
    // Count upcoming reminders from NS
    const remCount  = NS.items.filter(i=>i.type==='reminder').length;

    const tn = document.getElementById('np-task-num');
    const rn = document.getElementById('np-rem-num');
    const sn = document.getElementById('np-saved-num');
    if(tn) tn.textContent = taskCount;
    if(rn) rn.textContent = remCount;
    if(sn) sn.textContent = NS.savedToday;
}

// ─── Render notification list ────────────────────────────────────
function renderNotifList() {
    const list  = document.getElementById('notif-list');
    const empty = document.getElementById('notif-empty');
    refreshCounters();

    const show = NS.filter === 'all'
        ? NS.items
        : NS.items.filter(i => i.type === NS.filter);

    if(show.length === 0) {
        list.innerHTML = '';
        list.appendChild(empty);
        empty.style.display = 'block';
        return;
    }
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
        d.onclick = () => { item.read = true; NS.unread = Math.max(0, NS.unread-1); refreshBadges(); renderNotifList(); };
        list.appendChild(d);
    });
}

// ─── Add notification (called everywhere) ────────────────────────
window.addNotif = function(type, title, sub) {
    const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
    NS.items.push({ id: Date.now(), type, title, sub: sub||'', time: now, read: false });
    if(type==='notebook'||type==='case') NS.savedToday++;
    NS.unread++;
    refreshBadges();
    refreshCounters();
    renderNotifList();
    // In-app toast
    showToast(type, title, sub);
    // Browser push (if tab in background)
    if(NS.pushOK && document.hidden) browserPush(type, title, sub);
};

// ─── In-app toast ─────────────────────────────────────────────────
function showToast(type, title, sub) {
    const wrap = document.getElementById('toast-wrap');
    if(!wrap) return; // null guard
    const t = document.createElement('div');
    t.className = 'toast t-' + type;
    const icons = {task:'✅',reminder:'⏰',notebook:'📓',case:'📂'};
    const colors = {task:'#f59e0b',reminder:'#ef4444',notebook:'#6366f1',case:'#0891b2'};
    t.innerHTML =
        '<div style="width:28px;height:28px;border-radius:8px;background:' + (colors[type]||'#6366f1') + ';display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">' + (icons[type]||'🔔') + '</div>' +
        '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:12px;font-weight:700;color:#fff;line-height:1.3;">' + title + '</div>' +
            (sub ? '<div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + sub + '</div>' : '') +
        '</div>' +
        '<button onclick="this.closest(\'.toast\').remove()" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:13px;padding:0;flex-shrink:0;">✕</button>';
    wrap.appendChild(t);
    setTimeout(() => {
        t.style.animation = 'toastOut .3s ease forwards';
        setTimeout(() => t.remove(), 300);
    }, 5000);
}

// ─── Browser push notification ────────────────────────────────────
function browserPush(type, title, body) {
    try {
        const labels = {task:'Task',reminder:'Reminder',notebook:'Notebook',case:'Case'};
        new Notification('CaseDesk AI — ' + (labels[type]||'Update'), {
            body: title + (body ? '\n' + body : ''),
            icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' rx='11' fill='%236366f1'/><rect x='10' y='8' width='20' height='26' rx='4' fill='white' fill-opacity='0.25' stroke='white' stroke-width='1.5'/><path d='M14 16h12M14 21h12M14 26h8' stroke='white' stroke-width='2' stroke-linecap='round'/></svg>",
            tag: 'casedesk-' + type,
            requireInteraction: type === 'reminder'
        });
    } catch(e) {}
}

// ─── Enable push permission ───────────────────────────────────────
async function enablePush() {
    if(!('Notification' in window)) {
        document.getElementById('push-bar-text').textContent = 'Ye browser notifications support nahi karta.';
        document.getElementById('enable-push-btn').style.display = 'none';
        return;
    }
    const p = await Notification.requestPermission();
    const bar = document.getElementById('push-bar');
    if(p === 'granted') {
        NS.pushOK = true;
        bar.style.background = '#f0fdf4'; bar.style.borderColor = '#bbf7d0';
        bar.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#16a34a" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg><span style="flex:1;font-size:11px;font-weight:700;color:#15803d;">✨ PC/Mobile notifications enabled! Ab app band ho tab bhi alert milega.</span>';
        // Test notification
        setTimeout(() => browserPush('notebook', 'CaseDesk AI connected!', 'Ab har task/reminder ka alert milega.'), 500);
    } else {
        document.getElementById('push-bar-text').textContent = 'Permission denied. Browser settings se allow karein.';
        document.getElementById('push-bar-text').style.color = '#ef4444';
        document.getElementById('enable-push-btn').style.display = 'none';
    }
}
document.getElementById('enable-push-btn').addEventListener('click', enablePush);

// Auto-check permission on load
if('Notification' in window) {
    if(Notification.permission === 'granted') {
        NS.pushOK = true;
        document.getElementById('push-bar').style.display = 'none';
    } else if(Notification.permission === 'denied') {
        document.getElementById('push-bar-text').textContent = 'Notifications blocked. Browser settings > Allow karein.';
        document.getElementById('push-bar-text').style.color = '#ef4444';
        document.getElementById('enable-push-btn').style.display = 'none';
    }
}

// ─── REMINDER SCHEDULER — fires browser push at exact set time ───
window.scheduleReminder = function(rem) {
    if(!rem.time || rem.time === 'Manual' || rem.time === 'जल्द') return;
    const fireAt = new Date(rem.time);
    if(isNaN(fireAt)) {
        console.warn('[CaseDesk] Invalid reminder time:', rem.time, 'for:', rem.title);
        if(window.addNotif) addNotif('reminder', '⚠️ Reminder time invalid: ' + (rem.title||'').substring(0,30), 'Time "' + rem.time + '" parse nahi ho paya');
        return;
    }
    const key = rem.title + '|' + rem.time;
    if(NS.scheduledKeys.has(key)) return;
    NS.scheduledKeys.add(key);

    const msLeft = fireAt - Date.now();
    if(msLeft > 0 && msLeft < 7 * 24 * 3600 * 1000) {
        // In-app notification at exact time
        setTimeout(() => {
            addNotif('reminder', '⏰ ' + rem.title, rem.client ? 'Client: ' + rem.client : 'Reminder time!');
            // Force browser push even if tab open
            if(NS.pushOK) browserPush('reminder', rem.title, rem.client || 'Reminder!');
        }, msLeft);
        console.log('[CaseDesk] Reminder scheduled:', rem.title, 'in', Math.round(msLeft/60000), 'min');
    } else if(msLeft <= 0 && msLeft > -3600000) {
        // Just missed (within last hour) — show overdue once
        addNotif('reminder', '🔴 Overdue: ' + rem.title, rem.client || '');
    }
};



// ═══════════════════════════════════════════════════════
//  OVERDUE POPUP — Show overdue tasks/reminders on login
// ═══════════════════════════════════════════════════════
window.overduePopupShown = false;

function showOverduePopup() {
    if(window.overduePopupShown) return;
    const now = new Date();

    // Collect overdue tasks: Pending status + (dueDate OR timestamp) is in the past
    const overdueTasks = allTasks.filter(t => {
        if(t.status === 'Done' || t.status === 'Finished') return false;
        const dateToCheck = t.dueDate ? new Date(t.dueDate) : (t.timestamp ? new Date(t.timestamp) : null);
        return dateToCheck && dateToCheck < now;
    }).map(t => ({
        type: 'task',
        title: t.title,
        client: t.client || '',
        dueDate: t.dueDate || t.timestamp,
        priority: t.priority,
        _docId: t._docId,
        collection: 'tasks'
    }));

    // Collect overdue reminders (past time, valid date only, not already Closed)
    const overdueReminders = allReminders.filter(r => {
        if(r.status === 'Closed') return false;
        if(!r.time || r.time === 'Manual' || r.time === 'जल्द') return false;
        const d = new Date(r.time);
        return !isNaN(d) && d < now;
    }).map(r => ({
        type: 'reminder',
        title: r.title,
        client: r.client || '',
        dueDate: r.time,
        _docId: r._docId,
        collection: 'reminders'
    }));

    // Merge and sort (oldest overdue first)
    const overdueItems = [...overdueTasks, ...overdueReminders].sort((a,b) =>
        new Date(a.dueDate) - new Date(b.dueDate)
    );

    if(overdueItems.length === 0) return;

    window.overduePopupShown = true;
    let currentIndex = 0;

    const popup = document.getElementById('overdue-popup');
    const itemArea = document.getElementById('overdue-item-area');
    const progressBar = document.getElementById('overdue-progress-bar');
    const counter = document.getElementById('overdue-counter');
    const skipBtn = document.getElementById('overdue-skip-btn');
    const finishBtn = document.getElementById('overdue-finish-btn');
    const allDoneEl = document.getElementById('overdue-alldone');
    const closeBtn = document.getElementById('overdue-close-btn');
    const actionBtns = skipBtn.parentElement;

    function renderCurrentItem() {
        if(currentIndex >= overdueItems.length) {
            itemArea.classList.add('hidden');
            actionBtns.classList.add('hidden');
            allDoneEl.classList.remove('hidden');
            progressBar.style.width = '100%';
            counter.textContent = overdueItems.length + '/' + overdueItems.length;
            return;
        }

        itemArea.classList.remove('hidden');
        actionBtns.classList.remove('hidden');
        allDoneEl.classList.add('hidden');

        const item = overdueItems[currentIndex];
        const dueDate = new Date(item.dueDate);
        const daysAgo = Math.max(1, Math.ceil((now - dueDate) / (1000*60*60*24)));
        const dateStr = dueDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
        const timeStr = dueDate.getHours() || dueDate.getMinutes()
            ? ' — ' + dueDate.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})
            : '';

        const isTask = item.type === 'task';
        const typeBadgeClass = isTask ? 'task' : 'reminder';
        const typeIcon = isTask ? '📋' : '⏰';
        const typeLabel = isTask ? 'Task' : 'Reminder';
        const borderClass = isTask ? '' : 'type-reminder';

        const priorityHtml = item.priority === 'Urgent'
            ? '<span style="background:#fef2f2;color:#dc2626;">🚨 Urgent</span>'
            : '';

        itemArea.innerHTML = `
            <div class="overdue-item-card ${borderClass}">
                <div class="absolute -right-3 -top-3 text-5xl opacity-[0.05] select-none">${typeIcon}</div>
                <div class="flex items-center justify-between gap-2">
                    <span class="overdue-type-badge ${typeBadgeClass}">${typeIcon} ${typeLabel}</span>
                    <span class="overdue-days-badge">🔴 ${daysAgo}d overdue</span>
                </div>
                <div class="overdue-title">${item.title}</div>
                <div class="overdue-meta">
                    <span>📅 ${dateStr}${timeStr}</span>
                    ${item.client ? `<span>👤 ${item.client}</span>` : ''}
                    ${priorityHtml}
                </div>
            </div>`;

        const progress = Math.round((currentIndex / overdueItems.length) * 100);
        progressBar.style.width = progress + '%';
        counter.textContent = (currentIndex + 1) + '/' + overdueItems.length;
    }

    function animateNext() {
        const card = itemArea.querySelector('.overdue-item-card');
        if(card) {
            card.style.animation = 'overdueFadeOut .25s ease forwards';
            setTimeout(() => { currentIndex++; renderCurrentItem(); }, 250);
        } else {
            currentIndex++;
            renderCurrentItem();
        }
    }

    // Skip — move to next item
    const skipHandler = () => animateNext();

    // Finish — mark as Finished/Closed in Firestore (NOT delete)
    const finishHandler = async () => {
        const item = overdueItems[currentIndex];
        if(item && item._docId) {
            finishBtn.disabled = true;
            finishBtn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Finishing...';
            try {
                const newStatus = item.type === 'task' ? 'Finished' : 'Closed';
                await updateDoc(doc(db, item.collection, item._docId), {
                    status: newStatus,
                    finishedAt: new Date().toISOString(),
                    completedViaOverduePopup: true
                });
                if(window.showToast) showToast(item.type, '✅ ' + newStatus, item.title);
            } catch(err) {
                console.error('Overdue finish error:', err);
            }
            finishBtn.disabled = false;
            finishBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Finish';
        }
        animateNext();
    };

    // Close popup
    const closeHandler = () => {
        popup.classList.add('hidden');
        popup.classList.remove('show');
        skipBtn.removeEventListener('click', skipHandler);
        finishBtn.removeEventListener('click', finishHandler);
        closeBtn.removeEventListener('click', closeHandler);
    };

    skipBtn.addEventListener('click', skipHandler);
    finishBtn.addEventListener('click', finishHandler);
    closeBtn.addEventListener('click', closeHandler);

    // Show popup
    popup.classList.remove('hidden');
    popup.classList.add('show');
    renderCurrentItem();
}

// Trigger overdue popup after data loads
window._overdueTasksReady = false;
window._overdueRemReady = false;

function _checkOverdueReady() {
    if(window._overdueTasksReady && window._overdueRemReady && !window.overduePopupShown) {
        setTimeout(() => showOverduePopup(), 800);
    }
}

window._onTasksLoaded = function() { window._overdueTasksReady = true; _checkOverdueReady(); };
window._onRemindersLoaded = function() { window._overdueRemReady = true; _checkOverdueReady(); };

// ═══════════════════════════════════════════════════════
//  ADMIN PANEL — User Management
// ═══════════════════════════════════════════════════════
function setupAdminPanel() {
    const adminPanelBtn = document.getElementById('admin-panel-btn');
    const adminScreen   = document.getElementById('admin-screen');
    const adminCloseBtn = document.getElementById('admin-close-btn');
    const addUserBtn    = document.getElementById('admin-add-user-btn');
    const refreshBtn    = document.getElementById('admin-refresh-btn');

    if (!adminPanelBtn) return;

    adminPanelBtn.addEventListener('click', () => {
        adminScreen.classList.remove('hidden');
        loadAdminUsers();
    });
    adminCloseBtn.addEventListener('click', () => {
        adminScreen.classList.add('hidden');
    });
    refreshBtn?.addEventListener('click', loadAdminUsers);
    addUserBtn?.addEventListener('click', handleAddUser);
}

async function loadAdminUsers() {
    const listEl = document.getElementById('admin-users-list');
    const countEl = document.getElementById('admin-user-count');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px;"><span style="animation:pulse 1.5s infinite;display:inline-block;">⏳ Loading...</span></div>';
    try {
        const snap = await getDocs(collection(db, "allowed_users"));
        const users = [];
        snap.forEach(d => users.push({ id: d.id, ...d.data() }));
        if (countEl) countEl.textContent = users.length;

        if (users.length === 0) {
            listEl.innerHTML = '<div style="text-align:center;padding:30px;color:#94a3b8;">Koi user nahi mila.</div>';
            return;
        }

        listEl.innerHTML = '';
        users.forEach(u => {
            const isAdminUser = (u.email === ADMIN_EMAIL);
            const addedDate = u.addedAt ? new Date(u.addedAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}) : '—';

            const card = document.createElement('div');
            card.style.cssText = 'display:flex;align-items:center;gap:14px;padding:14px;border:1.5px solid #f1f5f9;border-radius:16px;transition:all .2s;background:#fafafa;';
            card.onmouseenter = () => card.style.borderColor = '#e0e7ff';
            card.onmouseleave = () => card.style.borderColor = '#f1f5f9';

            const roleChip = isAdminUser
                ? `<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#8b5cf622;color:#8b5cf6;">⚙️ Admin (You)</span>`
                : `<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#3b82f622;color:#3b82f6;">👤 User</span>`;

            card.innerHTML = `
                <div style="width:42px;height:42px;border-radius:14px;background:${isAdminUser?'linear-gradient(135deg,#8b5cf622,#8b5cf644)':'linear-gradient(135deg,#3b82f622,#3b82f644)'};border:2px solid ${isAdminUser?'#8b5cf633':'#3b82f633'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${isAdminUser?'⚙️':'👤'}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:800;font-size:13px;color:#1e293b;">${u.name || 'Unknown'}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.email}</div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">
                        ${roleChip}
                        <span style="font-size:9px;font-weight:700;color:#94a3b8;background:#f1f5f9;padding:2px 8px;border-radius:6px;">📅 ${addedDate}</span>
                        <span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#fef3c7;color:#92400e;">🔑 PIN: ${u.pin || '—'}</span>
                    </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button onclick="editUserPin('${u.id}','${u.pin||''}','${u.name||''}','${u.email}')" style="padding:7px 12px;background:#eef2ff;border:none;border-radius:10px;color:#6366f1;font-size:11px;font-weight:700;cursor:pointer;" title="PIN Change Karein">✏️ PIN</button>
                    ${!isAdminUser ? `<button onclick="deleteUser('${u.id}','${u.name||u.email}')" style="padding:7px 12px;background:#fef2f2;border:none;border-radius:10px;color:#ef4444;font-size:11px;font-weight:700;cursor:pointer;" title="User Delete Karein">🗑️</button>` : '<span style="font-size:10px;color:#94a3b8;padding:7px 8px;">Protected</span>'}
                </div>`;
            listEl.appendChild(card);
        });
    } catch(err) {
        listEl.innerHTML = '<div style="color:#ef4444;padding:16px;font-size:12px;">❌ Error loading users: ' + err.message + '</div>';
    }
}

async function handleAddUser() {
    const nameEl  = document.getElementById('admin-new-name');
    const emailEl = document.getElementById('admin-new-email');
    const pinEl   = document.getElementById('admin-new-pin');
    const msgEl   = document.getElementById('admin-msg');

    const name  = nameEl.value.trim();
    const email = emailEl.value.trim().toLowerCase();
    const pin   = pinEl.value.trim();
    const role  = "user"; // Users are ALWAYS "user" — no exceptions

    if (!name || !email || !pin) {
        showAdminMsg('⚠️ Sab fields fill karein — Name, Email aur PIN zaroori hai', '#fef3c7', '#92400e');
        return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
        showAdminMsg('⚠️ Valid Gmail address dalein', '#fef3c7', '#92400e'); return;
    }
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        showAdminMsg('⚠️ PIN exactly 4 numbers hona chahiye (e.g. 1234)', '#fef3c7', '#92400e'); return;
    }
    if (email === ADMIN_EMAIL) {
        showAdminMsg('⚠️ Admin email ko user ke roop mein add nahi kar sakte', '#fef3c7', '#92400e'); return;
    }

    const btn = document.getElementById('admin-add-user-btn');
    btn.disabled = true; btn.textContent = '⏳ Adding...';

    try {
        // Check if email already exists
        const existing = await getDocs(query(collection(db, "allowed_users"), where("email", "==", email)));
        if (!existing.empty) {
            showAdminMsg('⚠️ Yeh email already registered hai. PIN change karne ke liye ✏️ button use karein.', '#fef3c7', '#92400e');
            btn.disabled = false;
            btn.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg> User Add Karein';
            return;
        }

        await addDoc(collection(db, "allowed_users"), {
            email, name, pin, role,
            addedAt: new Date().toISOString(),
            addedBy: ADMIN_EMAIL
        });

        showAdminMsg(`✅ "${name}" (${email}) add ho gaya! PIN: ${pin}`, '#f0fdf4', '#15803d');
        nameEl.value = ''; emailEl.value = ''; pinEl.value = '';
        loadAdminUsers();
    } catch(err) {
        showAdminMsg('❌ Error: ' + err.message, '#fef2f2', '#991b1b');
    }
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg> User Add Karein';
}

window.deleteUser = async function(docId, userName) {
    if (!confirm(`"${userName}" ko delete karna chahte hain? Yeh action undo nahi ho sakta.`)) return;
    try {
        const { deleteDoc, doc: docRef } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        await deleteDoc(docRef(db, "allowed_users", docId));
        showAdminMsg(`🗑️ "${userName}" delete ho gaya.`, '#f0fdf4', '#15803d');
        loadAdminUsers();
    } catch(err) {
        showAdminMsg('❌ Delete failed: ' + err.message, '#fef2f2', '#991b1b');
    }
};

window.editUserPin = async function(docId, currentPin, userName, userEmail) {
    const newPin = prompt(`"${userName}" (${userEmail}) ka naya PIN enter karein (4 digits):`, '');
    if (newPin === null) return; // Cancelled
    if (!/^\d{4}$/.test(newPin)) { alert('PIN exactly 4 digits hona chahiye!'); return; }
    try {
        const { updateDoc, doc: docRef } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        await updateDoc(docRef(db, "allowed_users", docId), { pin: newPin });
        showAdminMsg(`✅ "${userName}" ka PIN update ho gaya.`, '#f0fdf4', '#15803d');
        loadAdminUsers();
    } catch(err) {
        showAdminMsg('❌ PIN update failed: ' + err.message, '#fef2f2', '#991b1b');
    }
};

function showAdminMsg(text, bg, color) {
    const el = document.getElementById('admin-msg');
    if (!el) return;
    el.style.display = 'block';
    el.style.background = bg; el.style.color = color;
    el.textContent = text;
    setTimeout(() => { el.style.display = 'none'; }, 5000);
}
