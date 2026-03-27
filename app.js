import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, signInWithCredential, GoogleAuthProvider, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, sendPasswordResetEmail, updatePassword, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
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
// Persistent login: auth state localStorage mein save hoga (Android WebView + browser dono)
setPersistence(auth, browserLocalPersistence).catch(() => {});
const provider = new GoogleAuthProvider();
const db = getFirestore(app);

let chatHistory = [];
let allSavedNotes = [];
let allTasks = [];
let allReminders = [];
let allNotebooks = [];
let allGroupedNotes = {}; // global — needed for client popup

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

const views = ['notebook', 'notes', 'tasks', 'reminders', 'vault'];

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
let _vaultTabReady = false;
views.forEach(v => {
    const handler = () => {
        switchView(v);
        if (v === 'vault') {
            if (!_vaultTabReady) {
                _vaultTabReady = true;
                if (window.initVault) window.initVault();
            } else {
                // Re-check lock state on each visit
                if (window._vaultCheckLock) window._vaultCheckLock();
            }
        }
    };
    document.getElementById(`tab-${v}-desk`)?.addEventListener('click', handler);
    document.getElementById(`tab-${v}-mob`)?.addEventListener('click', handler);
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
    const isMobile = vw < 768;

    let pw, ph, right, bottom, left, borderRadius;
    if (isMobile) {
        // Mobile: full-width panel above bottom nav (65px) + FAB area (80px)
        pw = vw - 16;          // 8px each side margin
        ph = vh - 160;         // top header + bottom nav + some padding
        right = '8px';
        bottom = '80px';       // above bottom nav (65px) + some gap
        left = 'auto';
        borderRadius = '16px';
    } else {
        // Desktop: floating panel
        pw = Math.min(390, vw - 40);
        ph = Math.min(580, vh - 120);
        right = '20px';
        bottom = Math.min(100, vh - ph - 20) + 'px';
        left = 'auto';
        borderRadius = '20px';
    }

    chatPanel.style.width = pw + 'px';
    chatPanel.style.height = ph + 'px';
    chatPanel.style.right = right;
    chatPanel.style.bottom = bottom;
    chatPanel.style.left = left;
    chatPanel.style.top = 'auto';
    chatPanel.style.borderRadius = borderRadius;
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

    // Android WebView detection
    const isAndroid = window.AndroidBridge !== undefined;

    if (isAndroid) {
        // Native Android Sign-In use karo
        window.__androidSignIn = async (idToken, email) => {
            try {
                const credential = GoogleAuthProvider.credential(idToken);
                await signInWithCredential(auth, credential);
            } catch(e) {
                btn.innerHTML = originalHTML;
                console.error('Android sign-in error:', e);
            }
        };
        window.__androidSignInFailed = (code) => {
            btn.innerHTML = originalHTML;
            console.error('Android sign-in failed, code:', code);
        };
        window.AndroidBridge.signIn();
    } else {
        // Browser mein normal popup
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            btn.innerHTML = originalHTML;
            console.error('Sign-in error:', error.code);
        }
    }
});

// ── EMAIL AUTH HELPERS ────────────────────────────────────────────
window.switchLoginTab = function(tab) {
    const googlePanel = document.getElementById('login-panel-google');
    const emailPanel  = document.getElementById('login-panel-email');
    const tabGoogle   = document.getElementById('tab-google-login');
    const tabEmail    = document.getElementById('tab-email-login');
    if (tab === 'google') {
        googlePanel.classList.remove('hidden');
        emailPanel.classList.add('hidden');
        tabGoogle.style.cssText = 'background:white;color:#6366f1;box-shadow:0 2px 8px rgba(99,102,241,0.15);';
        tabEmail.style.cssText  = 'color:#94a3b8;background:transparent;box-shadow:none;';
    } else {
        googlePanel.classList.add('hidden');
        emailPanel.classList.remove('hidden');
        tabEmail.style.cssText  = 'background:white;color:#6366f1;box-shadow:0 2px 8px rgba(99,102,241,0.15);';
        tabGoogle.style.cssText = 'color:#94a3b8;background:transparent;box-shadow:none;';
        const errEl = document.getElementById('email-auth-error');
        const sucEl = document.getElementById('email-auth-success');
        if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
        if (sucEl) { sucEl.classList.add('hidden'); sucEl.textContent = ''; }
    }
};

window.switchEmailForm = function(form) {
    const signinForm = document.getElementById('email-signin-form');
    const signupForm = document.getElementById('email-signup-form');
    const errEl = document.getElementById('email-auth-error');
    const sucEl = document.getElementById('email-auth-success');
    if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
    if (sucEl) { sucEl.classList.add('hidden'); sucEl.textContent = ''; }
    if (form === 'signup') {
        signinForm.classList.add('hidden');
        signupForm.classList.remove('hidden');
    } else {
        signupForm.classList.add('hidden');
        signinForm.classList.remove('hidden');
    }
};

window.togglePwdVisibility = function(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const hiding = input.type === 'password';
    input.type = hiding ? 'text' : 'password';
    btn.innerHTML = hiding
        ? '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>'
        : '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';
};

function showEmailAuthError(msg) {
    const el = document.getElementById('email-auth-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    const sucEl = document.getElementById('email-auth-success');
    if (sucEl) sucEl.classList.add('hidden');
}

function showEmailAuthSuccess(msg) {
    const el = document.getElementById('email-auth-success');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    const errEl = document.getElementById('email-auth-error');
    if (errEl) errEl.classList.add('hidden');
}

// Email Sign-In handler
document.getElementById('email-signin-btn').addEventListener('click', async () => {
    const btn      = document.getElementById('email-signin-btn');
    const email    = document.getElementById('email-si-email').value.trim();
    const password = document.getElementById('email-si-password').value;
    if (!email || !password) { showEmailAuthError('Email aur password dono bharo.'); return; }
    const orig = btn.textContent;
    btn.textContent = 'Signing in...';
    btn.disabled = true;
    try {
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged handle karega aage ka flow
    } catch (err) {
        btn.textContent = orig;
        btn.disabled = false;
        const errMap = {
            'auth/user-not-found':     'Yeh email registered nahi hai.',
            'auth/wrong-password':     'Password galat hai.',
            'auth/invalid-credential': 'Email ya password galat hai.',
            'auth/invalid-email':      'Email format sahi nahi hai.',
            'auth/too-many-requests':  'Bahut zyada attempts. Thoda wait karo.',
            'auth/user-disabled':      'Account disabled kar diya gaya hai.'
        };
        showEmailAuthError(errMap[err.code] || 'Login failed: ' + err.message);
    }
});

// Email Sign-Up handler
document.getElementById('email-signup-btn').addEventListener('click', async () => {
    const btn      = document.getElementById('email-signup-btn');
    const name     = document.getElementById('email-su-name').value.trim();
    const email    = document.getElementById('email-su-email').value.trim();
    const password = document.getElementById('email-su-password').value;
    if (!name || !email || !password) { showEmailAuthError('Sabhi fields bharo.'); return; }
    if (password.length < 6) { showEmailAuthError('Password kam se kam 6 characters ka hona chahiye.'); return; }
    const orig = btn.textContent;
    btn.textContent = 'Creating account...';
    btn.disabled = true;
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        // onAuthStateChanged fire hoga — unauthorized screen dikhegi until admin approves
    } catch (err) {
        btn.textContent = orig;
        btn.disabled = false;
        const errMap = {
            'auth/email-already-in-use': 'Yeh email pehle se registered hai. Sign In karein.',
            'auth/invalid-email':        'Email format sahi nahi hai.',
            'auth/weak-password':        'Password bahut weak hai. Minimum 6 characters use karein.'
        };
        showEmailAuthError(errMap[err.code] || 'Account create failed: ' + err.message);
    }
});

onAuthStateChanged(auth, async (user) => {
    // Loading overlay hatao (pehli baar auth state aane par)
    document.getElementById('auth-loading-overlay')?.remove();
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

                // Password reset ke baad force change check
                if (userData.mustChangePassword === true) {
                    hideAllStates();
                    showForceChangePasswordScreen(user, snap.docs[0].id);
                    return;
                }

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
            
            switchView('notebook');  // Notebook sabse pehle dikhega login ke baad
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

// ── Firestore reconnection helper for 503/network errors ─────────────
let _reconnectTimer = null;
let _reconnectIndicator = null;
function handleSnapshotError(err, retryFn) {
    console.error('Firestore onSnapshot error:', err);
    // Show reconnecting indicator after 5 seconds
    if (!_reconnectIndicator) {
        _reconnectTimer = setTimeout(() => {
            _reconnectIndicator = document.createElement('div');
            _reconnectIndicator.id = 'reconnect-indicator';
            _reconnectIndicator.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#fef3c7;color:#92400e;padding:6px 16px;border-radius:8px;font-size:12px;font-weight:700;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,0.1);';
            _reconnectIndicator.textContent = '🔄 Reconnecting...';
            document.body.appendChild(_reconnectIndicator);
        }, 5000);
    }
    // Retry after 2 seconds
    setTimeout(() => {
        if (_reconnectIndicator) { _reconnectIndicator.remove(); _reconnectIndicator = null; }
        if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
        if (typeof retryFn === 'function') retryFn();
    }, 2000);
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
        if(_reconnectIndicator) { _reconnectIndicator.remove(); _reconnectIndicator = null; }
        if(_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
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
    }, (err) => handleSnapshotError(err, loadAppListeners));

    // ── NOTES (Client Cases) ────────────────────────────────────────────
    // Admin: sirf apna data (userId==adminEmail) + purana data (no userId field)
    // User: sirf apna data (userId==email)
    const notesQ = isAdminUser
        ? query(collection(db, "notes"))
        : query(collection(db, "notes"), where("userId", "==", uid));

    // ── Notes state for search/sort/filter ──────────────────────────────
    let notesSearchQ = '', notesSortQ = 'new', notesStatusFilter = 'all';
    // allGroupedNotes is global (declared at top)

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

        if(countEl) countEl.textContent = entries.length + ' Profile' + (entries.length !== 1 ? 's' : '');
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

        entries.forEach((group, gIdx) => {
            const latestUpdate = [...group.updates].sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''))[0];
            // Use explicit status field if available, else detect from content
            const status = latestUpdate?.status || getStatus(latestUpdate?.content || '');
            const meta = statusMeta[status] || statusMeta['Active'];
            const sortedUpdates = [...group.updates].sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
            const pal = getCardPalette(group.displayTitle);

            // Avatar initials from client name
            const initials = group.displayTitle.split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2) || '?';

            // Build resume-style info rows
            const infoRows = [];
            if(group.mobile)  infoRows.push(`<div class="profile-info-row"><span class="profile-info-label">📱 ${t('mobile')}</span><span class="profile-info-val">${group.mobile}</span></div>`);
            if(group.account) infoRows.push(`<div class="profile-info-row"><span class="profile-info-label">🏦 ${t('account')}</span><span class="profile-info-val">${group.account}</span></div>`);
            if(group.address) infoRows.push(`<div class="profile-info-row"><span class="profile-info-label">📍 ${t('address')}</span><span class="profile-info-val">${group.address}</span></div>`);
            infoRows.push(`<div class="profile-info-row"><span class="profile-info-label">📊 ${t('status')}</span><span class="profile-info-val font-black" style="color:${pal.text};">${meta.badge}</span></div>`);
            infoRows.push(`<div class="profile-info-row"><span class="profile-info-label">📋 ${t('updates')}</span><span class="profile-info-val">${group.updates.length}</span></div>`);
            infoRows.push(`<div class="profile-info-row"><span class="profile-info-label">🕐 ${t('lastUpdated')}</span><span class="profile-info-val">${fmtDateN(latestUpdate.timestamp)}</span></div>`);

            const headerHTML = `
                <div class="profile-card-header relative overflow-hidden flex-shrink-0" style="background:${pal.grad};padding:16px 18px 14px;">
                    <div class="absolute -right-5 -top-5 w-20 h-20 rounded-full" style="background:rgba(255,255,255,0.08);"></div>
                    <div class="flex items-start gap-3 relative">
                        <div class="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg flex-shrink-0" style="background:rgba(255,255,255,0.22);color:white;border:1.5px solid rgba(255,255,255,0.3);">${initials}</div>
                        <div class="flex-1 min-w-0">
                            <div class="text-[9px] font-black uppercase tracking-widest mb-0.5" style="color:rgba(255,255,255,0.6);">👤 ${t('clientInfo')}</div>
                            <h3 class="font-black text-white text-base leading-tight" style="word-break:break-word;">${group.displayTitle}</h3>
                        </div>
                        <button onclick="deleteClientProfile('${group.displayTitle.replace(/'/g,"\\'")}');"
                            class="flex-shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full cursor-pointer transition-all hover:scale-105"
                            style="background:rgba(255,0,0,0.25);color:rgba(255,200,200,0.95);border:1px solid rgba(255,100,100,0.3);"
                            title="${t('deleteBtn')}">${t('deleteBtn')}</button>
                    </div>
                </div>
                <div class="profile-info-section" style="border-left:4px solid ${pal.border};">
                    ${infoRows.join('')}
                </div>`;

            const updatesHTML = sortedUpdates.map((u, idx) => {
                const isLatest = idx === 0;
                let displayContent = u.content || '';
                if(notesSearchQ) {
                    const rx = new RegExp('(' + notesSearchQ.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
                    displayContent = displayContent.replace(rx, '<mark class="bg-yellow-200 rounded px-0.5">$1</mark>');
                }
                return `<div class="px-4 py-3.5 border-b border-slate-50 last:border-0" style="${isLatest ? 'background:'+pal.light+'30;' : ''}">
                    <div class="flex items-center gap-2 mb-2 flex-wrap">
                        <span class="text-[9px] font-black px-2 py-0.5 rounded-full" style="${isLatest ? 'background:'+pal.light+';color:'+pal.text+';' : 'background:#f1f5f9;color:#64748b;'}">📅 ${fmtDateN(u.timestamp)} ⏰ ${fmtTimeN(u.timestamp)}</span>
                        ${isLatest ? `<span class="text-[8px] font-black text-white px-2 py-0.5 rounded-full" style="background:${pal.border};">${t('latest')}</span>` : ''}
                        <span class="text-[9px] text-slate-300 ml-auto">#${sortedUpdates.length - idx}</span>
                    </div>
                    <p class="text-slate-700 text-sm leading-relaxed font-medium whitespace-pre-wrap devanagari">${displayContent}</p>
                </div>`;
            }).join('');

            const card = document.createElement('div');
            card.className = 'profile-card bg-white rounded-2xl overflow-hidden transition-all duration-200 flex flex-col';
            card.style.cssText = `box-shadow:0 4px 20px rgba(0,0,0,0.09);border:1px solid #e2e8f0;cursor:pointer;`;
            card.innerHTML = headerHTML + `<div class="overflow-y-auto max-h-[280px] client-updates-scroll divide-y divide-slate-50">${updatesHTML}</div>`;
            card.addEventListener('click', (e) => {
                if(e.target.closest('button')) return; // skip button clicks inside card
                openFocusMode('client', group);
            });
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
            docs.push({ ...data, _docId: d.id });
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
        // If notification panel is open on Clients tab, refresh it
        if(NS.filter === 'case' && document.getElementById('notif-panel')?.classList.contains('open')) {
            renderNotifList();
        }
    }, (err) => handleSnapshotError(err, loadAppListeners));

    // Notes search
    document.getElementById('notes-search')?.addEventListener('input', e => { notesSearchQ = e.target.value.toLowerCase(); renderNotes(); });
    // Notes sort
    document.getElementById('notes-sort')?.addEventListener('change', e => { notesSortQ = e.target.value; renderNotes(); });
    // Notes status filter
    document.getElementById('notes-status-filter')?.addEventListener('change', e => { notesStatusFilter = e.target.value; renderNotes(); });

    // TASKS — with search, filter (pending/done/all), sort
    let taskCurrentFilter = 'pending'; // default: show overdue + today's tasks
    let taskSearchQuery = '';
    let taskSortOrder = 'new';

    function renderTasks() {
        const list = document.getElementById('tasks-list');
        const empty = document.getElementById('task-empty');
        const pendingCount = document.getElementById('task-pending-count');
        const doneCount = document.getElementById('task-done-count');
        const finishedCount = document.getElementById('task-finished-count');
        list.innerHTML = '';

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd   = new Date(todayStart.getTime() + 86400000);

        function taskEffectiveDate(t) {
            return t.dueDate ? new Date(t.dueDate) : new Date(t.timestamp);
        }
        function isIncomplete(t) { return t.status !== 'Done' && t.status !== 'Finished'; }

        let filtered;
        if(taskCurrentFilter === 'pending') {
            // Show all incomplete tasks (pending + overdue + future due)
            filtered = allTasks.filter(t => isIncomplete(t));
        } else if(taskCurrentFilter === 'done') {
            filtered = allTasks.filter(t => t.status === 'Done' || t.status === 'Finished');
        } else { // 'all'
            filtered = [...allTasks];
        }

        // Search
        if(taskSearchQuery) {
            filtered = filtered.filter(t =>
                (t.title||'').toLowerCase().includes(taskSearchQuery) ||
                (t.client||'').toLowerCase().includes(taskSearchQuery)
            );
        }

        // Sort
        filtered.sort((a, b) => {
            const aD = (a.dueDate || a.timestamp || '');
            const bD = (b.dueDate || b.timestamp || '');
            if(taskSortOrder === 'old') return aD.localeCompare(bD);
            if(taskSortOrder === 'due') {
                // Overdue first, then today, then no dueDate, then future
                const aE = taskEffectiveDate(a), bE = taskEffectiveDate(b);
                return aE - bE;
            }
            return bD.localeCompare(aD); // newest first (default)
        });

        // Badge counts
        const totalPending  = allTasks.filter(t => isIncomplete(t)).length;
        const totalOverdue  = allTasks.filter(t => isIncomplete(t) && taskEffectiveDate(t) < todayStart).length;
        const totalDone     = allTasks.filter(t => t.status === 'Done').length;
        const totalFinished = allTasks.filter(t => t.status === 'Finished').length;
        if(pendingCount) pendingCount.textContent = totalOverdue > 0 ? `${totalPending} Pending · ${totalOverdue} Overdue` : `${totalPending} Pending`;
        if(doneCount)    doneCount.textContent    = totalDone + ' Done';
        if(finishedCount) finishedCount.textContent = totalFinished + ' Finished';

        if(filtered.length === 0) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        filtered.forEach((task, idx) => {
            const isDone = task.status === 'Done';
            const isFinished = task.status === 'Finished';
            const isUrgent = task.priority === 'Urgent';
            const isOverdue = !isDone && !isFinished && taskEffectiveDate(task) < todayStart;
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
            div.addEventListener('click', (e) => {
                if(e.target.closest('.task-check-btn')) return;
                openFocusMode('task', task);
            });
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
        // Refresh live notification counters
        if(typeof refreshCounters === 'function') refreshCounters();
    }, (err) => handleSnapshotError(err, loadAppListeners));

    // Task search
    document.getElementById('task-search')?.addEventListener('input', e => {
        taskSearchQuery = e.target.value.toLowerCase();
        renderTasks();
    });

    // Task sort
    document.getElementById('task-sort')?.addEventListener('change', e => {
        taskSortOrder = e.target.value;
        renderTasks();
    });

    // Task filter buttons — Pending / Done / All
    function setTaskFilter(filterVal) {
        taskCurrentFilter = filterVal;
        const filterColors = {
            pending: 'bg-orange-500 text-white border-orange-500',
            done:    'bg-green-600 text-white border-green-600',
            all:     'bg-blue-600 text-white border-blue-600',
        };
        document.querySelectorAll('.task-filter-btn').forEach(b => {
            b.className = b.dataset.filter === filterVal
                ? 'task-filter-btn text-[11px] font-bold px-3 py-2 rounded-xl border ' + (filterColors[filterVal] || 'bg-blue-600 text-white border-blue-600')
                : 'task-filter-btn text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200 text-slate-600 bg-slate-50';
        });
        renderTasks();
    }

    document.getElementById('task-filter-btns')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-filter]');
        if(!btn) return;
        setTaskFilter(btn.dataset.filter);
    });

    // Reset to pending view when tasks tab is clicked
    window._resetTaskFilter = function() { setTaskFilter('pending'); };

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
                    <span class="text-[11px] font-bold text-slate-500 bg-white/60 px-2 py-0.5 rounded-lg">⏰ Deadline: ${formattedTime}</span>
                    ${rem.client ? `<span class="text-[10px] font-bold text-blue-600 bg-white/60 px-2 py-0.5 rounded-lg">👤 ${rem.client}</span>` : ''}
                </div>
                ${!isClosed ? `<div class="flex gap-2 mt-1">
                    <button class="rem-close-btn flex-1 text-[11px] font-black py-1.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white transition-all" data-docid="${rem._docId}">✅ Close Reminder</button>
                    ${isOverdue ? `<button class="rem-snooze-btn text-[11px] font-black py-1.5 px-3 rounded-xl bg-amber-400 hover:bg-amber-500 text-white transition-all" data-docid="${rem._docId}">⏩ Snooze 1 Day</button>` : ''}
                </div>` : `<div class="text-[10px] font-bold text-emerald-600 mt-1">🏁 Closed ${rem.finishedAt ? new Date(rem.finishedAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : ''}</div>`}`;
            div.style.cursor = 'pointer';
            div.addEventListener('click', (e) => {
                if(e.target.closest('button')) return;
                openFocusMode('reminder', rem);
            });
            // Close button handler
            const closeBtn = div.querySelector('.rem-close-btn');
            if(closeBtn) {
                closeBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const docId = closeBtn.dataset.docid;
                    if(!docId || docId.startsWith('_pending_')) return;
                    const finishedAt = new Date().toISOString();
                    rem.status = 'Closed';
                    rem.finishedAt = finishedAt;
                    renderReminders();
                    try {
                        await updateDoc(doc(db, 'reminders', docId), { status: 'Closed', finishedAt });
                    } catch(err) {
                        console.error('Reminder close error:', err);
                        rem.status = 'Active';
                        renderReminders();
                    }
                });
            }
            // Snooze button handler
            const snoozeBtn = div.querySelector('.rem-snooze-btn');
            if(snoozeBtn) {
                snoozeBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const docId = snoozeBtn.dataset.docid;
                    if(!docId || docId.startsWith('_pending_')) return;
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    tomorrow.setHours(9, 0, 0, 0);
                    const newTime = tomorrow.toISOString();
                    rem.time = newTime;
                    renderReminders();
                    try {
                        await updateDoc(doc(db, 'reminders', docId), { time: newTime });
                        if(window.scheduleReminder) scheduleReminder(rem);
                    } catch(err) {
                        console.error('Reminder snooze error:', err);
                        renderReminders();
                    }
                });
            }
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
        // Refresh live notification counters
        if(typeof refreshCounters === 'function') refreshCounters();
    }, (err) => handleSnapshotError(err, loadAppListeners));

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

    // ── CARD COLOR PALETTE ────────────────────────────────────────────────
    const CARD_PALETTES = [
        { grad: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: '#6366f1', light: '#ede9fe', text: '#4f46e5' },
        { grad: 'linear-gradient(135deg,#0891b2,#2563eb)', border: '#0891b2', light: '#cffafe', text: '#0e7490' },
        { grad: 'linear-gradient(135deg,#059669,#0d9488)', border: '#059669', light: '#d1fae5', text: '#047857' },
        { grad: 'linear-gradient(135deg,#dc2626,#db2777)', border: '#dc2626', light: '#fee2e2', text: '#b91c1c' },
        { grad: 'linear-gradient(135deg,#d97706,#f59e0b)', border: '#d97706', light: '#fef3c7', text: '#b45309' },
        { grad: 'linear-gradient(135deg,#7c3aed,#a855f7)', border: '#7c3aed', light: '#f3e8ff', text: '#6d28d9' },
        { grad: 'linear-gradient(135deg,#0f766e,#065f46)', border: '#0f766e', light: '#ccfbf1', text: '#0f766e' },
        { grad: 'linear-gradient(135deg,#be185d,#9d174d)', border: '#be185d', light: '#fce7f3', text: '#be185d' },
    ];
    function getCardPalette(name) {
        const hash = (name||'').split('').reduce((acc,c) => acc + c.charCodeAt(0), 0);
        return CARD_PALETTES[hash % CARD_PALETTES.length];
    }
    window._getCardPalette = getCardPalette;

    // ── LANGUAGE SUPPORT ─────────────────────────────────────────────────
    let currentLang = localStorage.getItem('casedesk_lang') || 'en';
    const L = {
        en: {
            notebook: 'My Notebook', notes: 'notes', clientProfiles: 'Client Profiles',
            profiles: 'Profiles', profile: 'Profile',
            secretaryDraft: 'Case Intake Note', totalUpdates: 'Total Updates',
            updates: 'Updates', update: 'Update', latest: 'LATEST',
            deleteBtn: '🗑️ Delete', confirmNb: 'Delete all notebook entries for',
            confirmProfile: 'Delete all records for client',
            clientInfo: 'CLIENT INFORMATION', draftNote: 'DRAFT NOTE',
            tasks: 'TASKS', reminders: 'REMINDERS', pending: 'PENDING',
            mobile: 'Mobile', account: 'Account', address: 'Address',
            status: 'Status', name: 'Name', lastUpdated: 'Last Updated',
        },
        hi: {
            notebook: 'मेरी नोटबुक', notes: 'नोट्स', clientProfiles: 'क्लाइंट प्रोफाइल',
            profiles: 'प्रोफाइल', profile: 'प्रोफाइल',
            secretaryDraft: 'केस इनटेक नोट', totalUpdates: 'कुल अपडेट',
            updates: 'अपडेट', update: 'अपडेट', latest: 'नवीनतम',
            deleteBtn: '🗑️ हटाएं', confirmNb: 'सभी नोट्स हटाएं:',
            confirmProfile: 'क्लाइंट का डेटा हटाएं:',
            clientInfo: 'क्लाइंट जानकारी', draftNote: 'ड्राफ्ट नोट',
            tasks: 'कार्य', reminders: 'अनुस्मारक', pending: 'लंबित',
            mobile: 'मोबाइल', account: 'खाता', address: 'पता',
            status: 'स्थिति', name: 'नाम', lastUpdated: 'अंतिम अपडेट',
        }
    };
    function t(key) { return (L[currentLang] || L['en'])[key] || key; }

    window.toggleLanguage = function() {
        currentLang = currentLang === 'en' ? 'hi' : 'en';
        localStorage.setItem('casedesk_lang', currentLang);
        const label = currentLang === 'en' ? 'हिं' : 'EN';
        ['lang-toggle-btn','lang-toggle-btn-desk'].forEach(id => {
            const btn = document.getElementById(id);
            if(btn) btn.textContent = label;
        });
        renderNotebook();
        renderNotes();
    };

    // ── DELETE HELPERS ────────────────────────────────────────────────────
    // Fetch all docs user can see — same logic as onSnapshot queries (handles old docs without userId)
    async function _fetchAllUserDocs(colName) {
        const q = isAdminUser
            ? query(collection(db, colName))
            : query(collection(db, colName), where("userId", "==", currentUserEmail));
        const snap = await getDocs(q);
        const results = [];
        snap.forEach(d => {
            const data = d.data();
            // Admin: skip other users' data but keep old docs without userId
            if(isAdminUser && data.userId && data.userId !== ADMIN_EMAIL) return;
            results.push({ id: d.id, data });
        });
        return results;
    }

    window.deleteNotebookClient = async function(clientName) {
        const msg = t('confirmNb') + ' "' + clientName + '"?\n\nThis will permanently remove all entries.';
        if(!confirm(msg)) return;
        try {
            const docs = await _fetchAllUserDocs("notebooks");
            const jobs = docs
                .filter(({ data }) => !data.deleted && (data.client || data.title || '').toUpperCase().trim() === clientName.toUpperCase().trim())
                .map(({ id }) => updateDoc(doc(db, "notebooks", id), { deleted: true, deletedAt: new Date().toISOString() }));
            await Promise.all(jobs);
        } catch(e) { alert('Delete failed: ' + e.message); }
    };

    window.deleteClientProfile = async function(clientName) {
        const msg = t('confirmProfile') + ' "' + clientName + '"?\n\nThis will permanently remove all records.';
        if(!confirm(msg)) return;
        try {
            const docs = await _fetchAllUserDocs("notes");
            const jobs = docs
                .filter(({ data }) => !data.deleted && (data.client || data.title || '').toUpperCase().trim() === clientName.toUpperCase().trim())
                .map(({ id }) => updateDoc(doc(db, "notes", id), { deleted: true, deletedAt: new Date().toISOString() }));
            await Promise.all(jobs);
        } catch(e) { alert('Delete failed: ' + e.message); }
    };

    // Set initial lang button text
    setTimeout(() => {
        const label = currentLang === 'en' ? 'हिं' : 'EN';
        ['lang-toggle-btn','lang-toggle-btn-desk'].forEach(id => {
            const btn = document.getElementById(id);
            if(btn) btn.textContent = label;
        });
    }, 100);

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
            const key = (page.client || page.title || 'General').toUpperCase();
            const name = page.client || page.title || 'General';
            allClientNames.add(name);
            if(!grouped[key]) grouped[key] = { displayName: name, updates: [] };
            grouped[key].updates.push(page);
        });

        // Populate client filter dropdown
        const filterEl = document.getElementById('nb-filter');
        if(filterEl) {
            // Rebuild dropdown to keep it up to date
            while(filterEl.options.length > 1) filterEl.remove(1);
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

        if(countEl) countEl.textContent = entries.length + ' ' + t('notes');
        grid.className = nbViewGrid
            ? 'grid grid-cols-1 xl:grid-cols-2 gap-6 pb-20 items-start'
            : 'flex flex-col gap-4 pb-20';

        if(entries.length === 0) { empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        function fmtDate(ts) { return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
        function fmtTime(ts) { return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }

        // Strip client-profile data block from notebook content — only show the actual diary/note text
        function extractNoteContent(raw) {
            // Extract everything after a "📝 …NOTE / DRAFT / DIARY" section header
            const noteMatch = raw.match(/📝[^\n]*(?:NOTE|DRAFT|DIARY|OBSERVATION|SUMMARY)[^\n]*\n([\s\S]*)/i);
            if(noteMatch) return noteMatch[1].trim();
            // Fallback: remove the 🏢 CLIENT INFORMATION block and known profile-field lines
            return raw
                .replace(/🏢[^\n]*\n?/gi, '')
                .replace(/📋[^\n]*(INTAKE|PROFILE|CASE)[^\n]*\n?/gi, '')
                .replace(/^(Client Name|Contact Person|Account No|Mobile|Address|Status|Loan A\/C|खाता|मोबाइल|संपर्क)[^\n]*\n?/gim, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        entries.forEach((group, gIdx) => {
            const pal = getCardPalette(group.displayName);
            const card = document.createElement('div');
            card.className = "nb-card bg-white rounded-2xl overflow-hidden flex flex-col transition-all duration-300";
            card.style.cssText = `box-shadow:0 4px 24px rgba(0,0,0,0.10);border:1px solid #e2e8f0;border-left:5px solid ${pal.border};`;

            const sortedUpdates = [...group.updates].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
            const latest = sortedUpdates[0];
            const initials = group.displayName.split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'?';

            // Detect profession/type from content
            let professionTag = t('secretaryDraft');
            const latestContent = (latest?.content || '').toLowerCase();
            if(/banking|bank|loan|cc|account|ऋण|खाता/.test(latestContent)) professionTag = 'Banking Case';
            else if(/insurance|bima|बीमा/.test(latestContent)) professionTag = 'Insurance';
            else if(/property|mortgage|मॉर्गेज|सम्पत्ति/.test(latestContent)) professionTag = 'Property / Mortgage';
            else if(/ca|audit|tax|gst|कर/.test(latestContent)) professionTag = 'CA / Tax';

            const hasProfile = typeof allGroupedNotes !== 'undefined' && !!allGroupedNotes[group.displayName.toUpperCase()];
            const safeClientName = group.displayName.replace(/'/g,"\\'").replace(/"/g,'&quot;');
            const headerHTML = `
                <div class="nb-card-header relative overflow-hidden flex-shrink-0" style="background:${pal.grad};padding:18px 20px 14px;">
                    <div class="absolute -right-5 -top-5 w-20 h-20 rounded-full" style="background:rgba(255,255,255,0.08);"></div>
                    <div class="absolute right-4 bottom-2 w-12 h-12 rounded-full" style="background:rgba(255,255,255,0.05);"></div>
                    <div class="flex items-start justify-between gap-3 relative">
                        <div class="flex items-center gap-3 flex-1 min-w-0">
                            <div class="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 font-black text-base" style="background:rgba(255,255,255,0.22);color:white;border:1.5px solid rgba(255,255,255,0.3);">${initials}</div>
                            <div class="flex-1 min-w-0">
                                <div class="text-[9px] font-black uppercase tracking-widest mb-0.5" style="color:rgba(255,255,255,0.65);">📋 ${professionTag}</div>
                                <h3 class="font-black text-white text-base leading-tight truncate">${group.displayName}</h3>
                                <div class="text-[9px] mt-0.5" style="color:rgba(255,255,255,0.6);">📅 ${fmtDate(latest.timestamp)} &nbsp;⏰ ${fmtTime(latest.timestamp)}</div>
                            </div>
                        </div>
                        <div class="flex flex-col items-end gap-2 flex-shrink-0">
                            <span class="text-[9px] font-black px-2 py-0.5 rounded-full" style="background:rgba(255,255,255,0.2);color:rgba(255,255,255,0.9);">
                                ${group.updates.length} ${group.updates.length > 1 ? t('updates') : t('update')}
                            </span>
                            <div class="flex items-center gap-1.5">
                                ${hasProfile ? `<button onclick="event.stopPropagation();showClientDetailPopup('${safeClientName}');"
                                    class="text-[9px] font-black px-2 py-0.5 rounded-full cursor-pointer transition-all hover:scale-105"
                                    style="background:rgba(255,255,255,0.25);color:white;border:1px solid rgba(255,255,255,0.45);"
                                    title="Client Profile">👤 Profile</button>` : ''}
                                <button onclick="deleteNotebookClient('${safeClientName}');"
                                    class="text-[9px] font-black px-2 py-0.5 rounded-full cursor-pointer transition-all hover:scale-105"
                                    style="background:rgba(255,0,0,0.25);color:rgba(255,200,200,0.95);border:1px solid rgba(255,100,100,0.3);"
                                    title="${t('deleteBtn')}">${t('deleteBtn')}</button>
                            </div>
                        </div>
                    </div>
                </div>`;

            const updatesHTML = sortedUpdates.map((page, idx) => {
                // Strip client-profile info block — show only the actual diary/note text
                let noteText = extractNoteContent(page.content || '');
                if(nbSearchQuery) {
                    const rx = new RegExp('(' + nbSearchQuery.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
                    noteText = noteText.replace(rx, '<mark class="bg-yellow-200 rounded px-0.5">$1</mark>');
                }
                const isLatest = idx === 0;
                const updateNum = group.updates.length - idx;
                return `<div class="px-5 py-3.5 border-b border-slate-50 last:border-b-0" style="${isLatest ? 'background:'+pal.light+'40;' : ''}">
                    <div class="flex items-center gap-2 mb-2 flex-wrap">
                        <span class="text-[9px] font-black px-2 py-0.5 rounded-full" style="${isLatest ? 'background:'+pal.light+';color:'+pal.text+';' : 'background:#f1f5f9;color:#64748b;'}">📅 ${fmtDate(page.timestamp)} ⏰ ${fmtTime(page.timestamp)}</span>
                        ${isLatest ? `<span class="text-[8px] font-black text-white px-2 py-0.5 rounded-full" style="background:${pal.border};">${t('latest')}</span>` : ''}
                        <span class="text-[9px] text-slate-300 ml-auto">#${updateNum}</span>
                    </div>
                    <div class="text-slate-700 text-sm leading-relaxed devanagari font-medium whitespace-pre-wrap nb-note-content">${noteText || '<span class="text-slate-400 text-xs italic">Note content here...</span>'}</div>
                </div>`;
            }).join('');

            card.innerHTML = headerHTML + `<div class="divide-y divide-slate-50 max-h-[320px] overflow-y-auto client-updates-scroll">${updatesHTML}</div>`;
            card.style.cursor = 'pointer';
            card.addEventListener('click', (e) => {
                if(e.target.closest('button')) return;
                openFocusMode('notebook', group);
            });
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
            allNotebooks.push({ ...data, _docId: d.id });
        });
        // Client-side sort: timestamp desc
        allNotebooks.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
        renderNotebook();
    }, (err) => handleSnapshotError(err, loadAppListeners));

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

   📋 [CLIENT NAME] — Case Intake Note

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
   STOP HERE — do NOT add tasks list, reminders list, or pending list inside note content.
   Tasks and reminders must be created as SEPARATE tool calls, NOT written inside this note.

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

   ═══ EXAMPLE NOTE CONTENT (create_note tool — content field only) ═══
   "📋 Paawan Bio Energy — Case Intake Note\n\n🏢 CLIENT INFORMATION\nClient Name: Paawan Bio Energy\nContact Person: श्री Pravin Patidar जी\nCC Account No: 389005/614\nCA Status: Final confirmation pending\n\n📝 SECRETARY DRAFT NOTE\nदिनांक: 28 फरवरी 2026 | समय: 12:28 PM\nमॉर्गेज दस्तावेज़ीकरण कार्य सम्पन्न किया गया एवं ऋण स्वीकृति संबंधित आवश्यक कार्यवाही पूर्ण की गई।\n\nदिनांक: 10 मार्च 2026 | समय: 10:33 AM\nPaawan Bio Energy के संदर्भ में सूचित किया जाता है कि CMA verification हेतु प्रस्तुति भेजी जा चुकी है। Updated CMA एवं Balance Sheet प्राप्त होते ही Tejas प्रणाली में स्वीकृति की कार्यवाही प्रारंभ की जाएगी।"
   ← NOTE: No TASKS section, no REMINDERS section, no PENDING section in note content.
      Those are separate create_task and create_reminder tool calls (see below).

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

   ═══ TOOL CALLING — CRITICAL STRICT RULES ═══

   RULE 1 — create_note: Call ONCE per case.
     • content field = ONLY brief case summary (CLIENT INFORMATION block + SECRETARY DRAFT NOTE paragraph)
     • DO NOT write any task list, reminder list, or pending list inside content
     • WRONG: content has "✅ TASKS\n1. NOC lena\n2. Documents..."
     • CORRECT: content has only "📋 Ramesh Patel — Case Intake Note\n\n🏢 CLIENT INFORMATION\n..."

   RULE 2 — create_task: Call SEPARATELY for EACH individual task.
     • If there are 4 tasks → make 4 separate create_task tool calls
     • Each call has ONE task title only
     • NEVER combine tasks into a single call or write them inside note content
     • WRONG: create_note content = "...TASKS: 1. NOC lena 2. Documents..."
     • CORRECT: create_task(title="SBI se NOC prapt karen"), create_task(title="Documents verify karna"), etc.

   RULE 3 — create_reminder: Call SEPARATELY for EACH deadline/followup.
     • If there are 2 reminders → make 2 separate create_reminder tool calls
     • NEVER write reminders inside note content

   RULE 4 — create_client_profile: Call ONCE with all extracted client details.

   EXECUTION: When user gives raw banking case info → call ALL relevant tools automatically, no permission needed.
   CONFIRMATION: After tool execution, reply: "✅ Case processed! Note save hua, profile create hua, X tasks aur Y reminders set ho gaye."
   SIMPLE QUERIES: For greetings, questions, searches — no tool calls needed, respond via JSON format.

   ═══ NOTEBOOK vs CASE ═══
   - Client personal info + banking/loan updates → case.save = true
   - General notes/observations/non-client content → notebook.save = true
   - BOTH can be true simultaneously

   ═══ AFTER SAVING ═══
   - Reply mein structured summary do in Hinglish (NOT the full draft — just key points)
   - Confirm: "Save ho gaya! ✅"
   - Mention extracted tasks & reminders in reply
   - Agar same client ki pehle se entry hai, naya update add karo (purana mat hatao)

2. TASKS → AUTO-SAVE (bina puche):
   ═══ TASK KYA HOTA HAI? ═══
   - Task = Koi KAAM jo user ko KARNA hai — action item, to-do, checklist item
   - Task mein STATUS hota hai: Pending → Done → Finished
   - Task time-bound bhi ho sakta hai (dueDate), lekin MAIN cheez hai KAM KARNA
   - Examples: "NOC lena", "Documents verify karna", "Client ko call karna", "Form fill karna"
   - Task ka pura hona = user ne kaam kar diya (checkbox tick kiya)

   - Jab user koi kaam bataye ya raw banking info se tasks ban sakte hain → AUTOMATICALLY task.save = true karo
   - Har actionable item ke liye SEPARATE task banao — ek message mein MULTIPLE tasks allowed hain
   - Agar multiple tasks hain → "tasks" array use karo (see JSON format below)
   - Suggest a realistic dueDate based on context (agar user ne date nahi batai)
   - Permission ya confirmation KABHI mat maango — seedha save karo
   - IMPORTANT: task.dueDate MUST be valid ISO 8601 (e.g. "2026-03-15T00:00:00")

3. REMINDERS → AUTO-SAVE (bina puche):
   ═══ REMINDER KYA HOTA HAI? ═══
   - Reminder = Koi YAAD DILAANA — time-bound alert jab koi cheez HONI hai ya YAAD aani chahiye
   - Reminder mein TIME/DEADLINE hota hai — yahi uski main pehchaan hai
   - Reminder ka STATUS hai: Active → Closed (user dismiss kare tab)
   - Examples: "15 March ko court date hai", "Kal 2 baje meeting hai", "Next week tak response chahiye"
   - Reminder app AUTOMATICALLY notification bhejta hai jab deadline aati hai

   ═══ TASK vs REMINDER — CLEAR DISTINCTION ═══
   - "Document lana hai" → TASK (kaam karna hai)
   - "15 March ko document submit karna hai" → TASK + REMINDER dono (kaam bhi + deadline bhi)
   - "Kal 2 baje call karna" → REMINDER (time-bound event/alert)
   - "Follow-up karna" → TASK (kaam)
   - "Next week tak follow-up karna" → REMINDER (specific deadline ke saath)
   - "KCC ka inspection karna" → TASK (action)
   - "30 March ko KCC inspection ki deadline hai" → REMINDER (deadline alert)

   RULE: Agar user ne SPECIFIC DATE/TIME bataya hai → REMINDER bhi banao
         Agar action karna hai bina specific date ke → TASK banao
         Dono ek saath ban sakte hain ek hi message se!

   - Jab user information deta hai jismein date/time-bound actions hain → AUTOMATICALLY reminder.save = true karo
   - Har deadline/follow-up ke liye SEPARATE reminder banao — ek message mein MULTIPLE reminders allowed hain
   - Agar multiple reminders hain → "reminders" array use karo (see JSON format below)
   - Agar user ne time bhi bataya hai (jaise "2 baje", "kal subah", "15 March ko") → ISO 8601 format mein convert karke reminder.time mein daalo
   - Agar user ne time nahi bataya lekin deadline implied hai → reasonable time estimate lagao (e.g., din ki shaam 6 baje)
   - Agar koi time context nahi → time = "Manual" set karo, but STILL save karo
   - Permission ya confirmation KABHI mat maango — seedha save karo
   - IMPORTANT: reminder.time MUST be valid ISO 8601 (e.g. "2026-03-15T14:00:00") ya "Manual"
   - IMPORTANT: NEVER set reminder.time to a date in the past — hamesha future date use karo

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
  "reminder": { "save": false, "client": "", "title": "", "time": "" },
  "tasks": [],
  "reminders": []
}

MULTIPLE TASKS/REMINDERS:
- For SINGLE task → use "task" field as before
- For MULTIPLE tasks → use "tasks" array: [{"save":true,"client":"Name","title":"Task 1","dueDate":"ISO","priority":"Urgent"},{"save":true,...}]
- For SINGLE reminder → use "reminder" field as before
- For MULTIPLE reminders → use "reminders" array: [{"save":true,"client":"Name","title":"Reminder 1","time":"ISO"},{"save":true,...}]
- When raw banking info comes → ALWAYS use arrays for tasks and reminders (usually 3-6 tasks and 1-3 reminders per case)
- EVERY item in tasks/reminders array MUST have save:true

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

        // Helper: convert relative date terms to ISO string
        function resolveDueDate(dateStr) {
            if (!dateStr) return null;
            const s = dateStr.toString().toLowerCase().trim();
            const base = new Date();
            base.setHours(0, 0, 0, 0);
            if (s === 'aaj' || s === 'today') return base.toISOString();
            if (s === 'kal' || s === 'tomorrow') { base.setDate(base.getDate() + 1); return base.toISOString(); }
            if (s.includes('agle hafte') || s.includes('next week')) { base.setDate(base.getDate() + 7); return base.toISOString(); }
            if (s.includes('is week') || s.includes('this week')) {
                const day = base.getDay(); // 0=Sun
                base.setDate(base.getDate() + (7 - day) % 7);
                return base.toISOString();
            }
            const dinMatch = s.match(/(\d+)\s*din/);
            if (dinMatch) { base.setDate(base.getDate() + parseInt(dinMatch[1])); return base.toISOString(); }
            const dayMatch = s.match(/(\d+)\s*day/);
            if (dayMatch) { base.setDate(base.getDate() + parseInt(dayMatch[1])); return base.toISOString(); }
            // If it looks like an ISO date already, return as-is
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return dateStr;
            // Try parsing as a natural date
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) return parsed.toISOString();
            return null;
        }

        // Tool definitions for automatic Firestore writes
        const toolDefinitions = [
            {
                type: "function",
                function: {
                    name: "create_note",
                    description: "Save a structured banking case note to Notebook",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            content: { type: "string", description: "Full structured case summary in Hinglish" },
                            client_name: { type: "string" },
                            product: { type: "string", description: "KCC/TL/CC/AIF/OD etc" },
                            tags: { type: "array", items: { type: "string" } }
                        },
                        required: ["title", "content", "client_name"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "create_client_profile",
                    description: "Create or update a client profile with banking case details",
                    parameters: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            mobile: { type: "string" },
                            address: { type: "string" },
                            product: { type: "string" },
                            limit_amount: { type: "string" },
                            cibil_score: { type: "number" },
                            co_applicant: { type: "string" },
                            land_details: { type: "string" },
                            dob: { type: "string" },
                            status: { type: "string", enum: ["Active", "Pending", "Processing", "Sanctioned", "Disbursed", "Rejected", "Mortgage"] }
                        },
                        required: ["name", "product"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "create_task",
                    description: "Create a single actionable task. Call this ONCE per task — for multiple tasks, call multiple times.",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            client_name: { type: "string" },
                            priority: { type: "string", enum: ["Urgent", "High", "Medium", "Low"] },
                            due_date: { type: "string", description: "ISO 8601 date string" },
                            category: { type: "string", enum: ["document", "inspection", "followup", "sanction", "disbursement", "other"] }
                        },
                        required: ["title", "client_name", "priority"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "create_reminder",
                    description: "Create a dated reminder for follow-up or deadline. Call ONCE per reminder.",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            client_name: { type: "string" },
                            reminder_date: { type: "string", description: "ISO 8601 date string" },
                            type: { type: "string", enum: ["document", "deadline", "followup", "inspection"] }
                        },
                        required: ["title", "client_name", "reminder_date"]
                    }
                }
            }
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
                max_tokens: 2500,
                tools: toolDefinitions,
                tool_choice: "auto"
            })
        });

        if (!openaiRes.ok) {
            const errData = await openaiRes.json();
            throw new Error(errData.error?.message || "OpenAI API Error");
        }

        const openaiData = await openaiRes.json();
        const assistantMessage = openaiData.choices[0].message;
        const toolCalls = assistantMessage.tool_calls || [];
        const rawContent = (assistantMessage.content || '').trim();

        // ── 4. PROCESS TOOL CALLS (if any) ────────────────────────────
        const now = new Date().toISOString();
        const savePromises = [];
        let toolCallResults = [];
        let toolSummary = { notes: 0, profiles: 0, tasks: 0, reminders: 0 };

        if (toolCalls.length > 0) {
            for (const tc of toolCalls) {
                let args;
                try { args = JSON.parse(tc.function.arguments); } catch(e) { continue; }
                const fnName = tc.function.name;
                let result = "done";

                if (fnName === 'create_note') {
                    savePromises.push(addDoc(collection(db, "notebooks"), {
                        title: args.client_name || "सामान्य",
                        content: args.content,
                        client: args.client_name || "सामान्य",
                        product: args.product || null,
                        tags: args.tags || [],
                        timestamp: now,
                        userId: currentUserEmail
                    }));
                    toolSummary.notes++;
                    if(window.addActivity) addActivity('📓', 'Notebook saved: ' + (args.client_name || 'General'), '#4f46e5');
                    addNotif('notebook', '📓 Notebook saved — ' + (args.client_name || 'General'), 'AI ne automatically save kiya');
                    if(window.registerUpdate) registerUpdate('notebook', args.client_name || '');
                    result = "Note saved for " + args.client_name;
                }
                else if (fnName === 'create_client_profile') {
                    const profileContent = `📋 ${args.name} — Case Intake Note\n\n🏢 CLIENT INFORMATION\nClient Name: ${args.name}\nProduct: ${args.product || '-'}\nMobile: ${args.mobile || '-'}\nAddress: ${args.address || '-'}\nLimit: ${args.limit_amount || '-'}\nCIBIL: ${args.cibil_score || '-'}\nCo-Applicant: ${args.co_applicant || '-'}\nLand Details: ${args.land_details || '-'}`;
                    savePromises.push(addDoc(collection(db, "notes"), {
                        title: args.name,
                        content: profileContent,
                        client: args.name,
                        mobile: args.mobile || null,
                        account: null,
                        address: args.address || null,
                        status: args.status || "Active",
                        timestamp: now,
                        userId: currentUserEmail
                    }));
                    toolSummary.profiles++;
                    if(window.addActivity) addActivity('📂', 'Client profile saved: ' + args.name, '#0891b2');
                    addNotif('case', '📂 Client Profile — ' + args.name, args.mobile ? '📱 ' + args.mobile : 'Profile saved');
                    if(window.registerUpdate) registerUpdate('case', args.name || '');
                    result = "Profile created for " + args.name;
                }
                else if (fnName === 'create_task') {
                    const taskObj = {
                        title: args.title,
                        status: "Pending",
                        client: args.client_name || "सामान्य",
                        timestamp: now,
                        userId: currentUserEmail
                    };
                    const resolvedDue = resolveDueDate(args.due_date);
                    if(resolvedDue) taskObj.dueDate = resolvedDue;
                    if(args.priority) taskObj.priority = args.priority;
                    if(args.category) taskObj.category = args.category;
                    savePromises.push(addDoc(collection(db, "tasks"), taskObj));
                    allTasks.unshift({ ...taskObj, _docId: '_pending_' + now + '_' + toolSummary.tasks });
                    toolSummary.tasks++;
                    if(window.addActivity) addActivity('✅', 'Task created: ' + args.title.substring(0,30), '#d97706');
                    addNotif('task', '✅ New Task — ' + args.title.substring(0,45), 'Client: ' + (args.client_name || 'General'));
                    if(window.registerUpdate) registerUpdate('task', args.client_name || '');
                    result = "Task created: " + args.title;
                }
                else if (fnName === 'create_reminder') {
                    const remObj = {
                        title: args.title,
                        time: args.reminder_date || "Manual",
                        client: args.client_name || "सामान्य",
                        type: args.type || "followup",
                        timestamp: now,
                        userId: currentUserEmail
                    };
                    savePromises.push(addDoc(collection(db, "reminders"), remObj));
                    allReminders.unshift({ ...remObj, _docId: '_pending_' + now + '_' + toolSummary.reminders });
                    toolSummary.reminders++;
                    if(window.addActivity) addActivity('⏰', 'Reminder set: ' + args.title.substring(0,30), '#dc2626');
                    addNotif('reminder', '⏰ Reminder set — ' + args.title.substring(0,40), '📅 ' + (args.reminder_date || 'Manual'));
                    if(typeof scheduleReminder === 'function') scheduleReminder(remObj);
                    if(window.registerUpdate) registerUpdate('reminder', args.client_name || '');
                    result = "Reminder set: " + args.title;
                }

                toolCallResults.push({ tool_call_id: tc.id, role: "tool", content: result });
            }

            // Re-render UI after tool calls
            if(toolSummary.tasks > 0 && typeof renderTasks === 'function') renderTasks();
            if(toolSummary.reminders > 0 && typeof renderReminders === 'function') renderReminders();
        }

        // ── 4b. GET FINAL TEXT RESPONSE ────────────────────────────
        let replyText;
        if (toolCalls.length > 0 && toolCallResults.length > 0) {
            // Send tool results back to get a final conversational reply
            const followUpMessages = [
                ...messages,
                assistantMessage,
                ...toolCallResults
            ];
            try {
                const followUpRes = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${DYNAMIC_OPENAI_KEY}` },
                    body: JSON.stringify({ model: OPENAI_MODEL, messages: followUpMessages, temperature: 0.4, max_tokens: 800 })
                });
                if (followUpRes.ok) {
                    const followUpData = await followUpRes.json();
                    const followUpContent = (followUpData.choices[0].message.content || '').trim();
                    // Try parsing as JSON (existing format), else use as plain text
                    try {
                        const clean = followUpContent.replace(/```json|```/g, '').trim();
                        const parsed = JSON.parse(clean);
                        replyText = parsed.reply || followUpContent;
                    } catch(e) {
                        replyText = followUpContent;
                    }
                } else {
                    // Fallback confirmation
                    const parts = [];
                    if(toolSummary.notes > 0) parts.push(`${toolSummary.notes} note saved`);
                    if(toolSummary.profiles > 0) parts.push(`${toolSummary.profiles} profile created`);
                    if(toolSummary.tasks > 0) parts.push(`${toolSummary.tasks} tasks created`);
                    if(toolSummary.reminders > 0) parts.push(`${toolSummary.reminders} reminders set`);
                    replyText = `✅ Case processed: ${parts.join(', ')}`;
                }
            } catch(e) {
                const parts = [];
                if(toolSummary.notes > 0) parts.push(`${toolSummary.notes} note saved`);
                if(toolSummary.profiles > 0) parts.push(`${toolSummary.profiles} profile created`);
                if(toolSummary.tasks > 0) parts.push(`${toolSummary.tasks} tasks created`);
                if(toolSummary.reminders > 0) parts.push(`${toolSummary.reminders} reminders set`);
                replyText = `✅ Case processed: ${parts.join(', ')}`;
            }
        } else {
            // No tool calls — parse JSON response as before
            let aiResponse;
            try {
                const clean = rawContent.replace(/```json|```/g, '').trim();
                aiResponse = JSON.parse(clean);
            } catch(e) {
                aiResponse = { reply: rawContent, notebook: { save: false }, case: { save: false }, task: { save: false }, reminder: { save: false }, tasks: [], reminders: [], update: { action: false }, softDelete: { action: false } };
            }
            replyText = aiResponse.reply || "कार्य सम्पन्न हुआ।";

            // ── 5. SAVE TO FIREBASE BASED ON AI JSON DECISION ───────────────

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
            allReminders.unshift({ ...remObj, _docId: '_pending_' + now });
            if(typeof renderReminders === 'function') renderReminders();
            if(window.addActivity) addActivity('⏰', 'Reminder set: ' + aiResponse.reminder.title.substring(0,30), '#dc2626');
            addNotif('reminder', '⏰ Reminder set — ' + aiResponse.reminder.title.substring(0,40), '📅 ' + (aiResponse.reminder.time || 'जल्द'));
            scheduleReminder(remObj);
            if(window.registerUpdate) registerUpdate('reminder', aiResponse.reminder.client || '');
        }

        // ── MULTIPLE TASKS ARRAY HANDLER ─────────────────────────────────
        if (Array.isArray(aiResponse.tasks) && aiResponse.tasks.length > 0) {
            aiResponse.tasks.forEach((t, idx) => {
                if(!t.save || !t.title) return;
                const taskObj = {
                    title: t.title,
                    status: "Pending",
                    client: t.client || "सामान्य",
                    timestamp: now,
                    userId: currentUserEmail
                };
                const resolvedTDue = resolveDueDate(t.dueDate);
                if(resolvedTDue) taskObj.dueDate = resolvedTDue;
                if(t.priority) taskObj.priority = t.priority;
                savePromises.push(addDoc(collection(db, "tasks"), taskObj));
                allTasks.unshift({ ...taskObj, _docId: '_pending_' + now + '_' + idx });
                if(window.addActivity) addActivity('✅', 'Task created: ' + t.title.substring(0,30), '#d97706');
                addNotif('task', '✅ New Task — ' + t.title.substring(0,45), 'Client: ' + (t.client || 'General'));
                if(window.registerUpdate) registerUpdate('task', t.client || '');
            });
            if(typeof renderTasks === 'function') renderTasks();
        }

        // ── MULTIPLE REMINDERS ARRAY HANDLER ─────────────────────────────
        if (Array.isArray(aiResponse.reminders) && aiResponse.reminders.length > 0) {
            aiResponse.reminders.forEach((r, idx) => {
                if(!r.save || !r.title) return;
                const remObj = {
                    title: r.title,
                    time: r.time || "Manual",
                    client: r.client || "सामान्य",
                    timestamp: now,
                    userId: currentUserEmail
                };
                savePromises.push(addDoc(collection(db, "reminders"), remObj));
                allReminders.unshift({ ...remObj, _docId: '_pending_' + now + '_' + idx });
                if(window.addActivity) addActivity('⏰', 'Reminder set: ' + r.title.substring(0,30), '#dc2626');
                addNotif('reminder', '⏰ Reminder set — ' + r.title.substring(0,40), '📅 ' + (r.time || 'Manual'));
                if(typeof scheduleReminder === 'function') scheduleReminder(remObj);
                if(window.registerUpdate) registerUpdate('reminder', r.client || '');
            });
            if(typeof renderReminders === 'function') renderReminders();
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

        } // ← close else block (no tool calls — JSON path)

        chatHistory.push({ role: 'assistant', content: replyText });

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
ui.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
    // Shift+Enter = default behavior (newline in textarea)
});
// Auto-resize textarea as user types
ui.userInput.addEventListener('input', () => {
    ui.userInput.style.height = 'auto';
    ui.userInput.style.height = Math.min(ui.userInput.scrollHeight, 80) + 'px';
});





// ╔══════════════════════════════════════════════════════════════╗
// ║  TASK / REMINDER DETAIL POPUP                                ║
// ╚══════════════════════════════════════════════════════════════╝

window.closeItemDetailPopup = function() {
    document.getElementById('item-detail-popup').classList.add('hidden');
};

window.showItemDetailPopup = function(item, type) {
    const popup  = document.getElementById('item-detail-popup');
    const header = document.getElementById('item-detail-header');
    const body   = document.getElementById('item-detail-body');
    const actions= document.getElementById('item-detail-actions');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isTask = type === 'task';

    const isOverdue = isTask
        ? (item.dueDate ? new Date(item.dueDate) : new Date(item.timestamp)) < todayStart && item.status !== 'Done' && item.status !== 'Finished'
        : (item.time && item.time !== 'Manual' && item.time !== 'जल्द' && new Date(item.time) < now && item.status !== 'Closed');

    const grad = isTask
        ? (isOverdue ? 'linear-gradient(135deg,#dc2626,#ef4444)' : 'linear-gradient(135deg,#f59e0b,#f97316)')
        : (isOverdue ? 'linear-gradient(135deg,#dc2626,#ef4444)' : 'linear-gradient(135deg,#7c3aed,#6366f1)');

    const icon = isTask ? '✅' : '⏰';
    const typeLabel = isTask ? 'Task' : 'Reminder';
    const statusBadge = isTask
        ? (item.status === 'Done' ? '✅ Done' : item.status === 'Finished' ? '🏆 Finished' : isOverdue ? '🔴 Overdue' : '⏳ Pending')
        : (item.status === 'Closed' ? '✅ Closed' : isOverdue ? '🔴 Overdue' : '🟢 Active');

    header.style.cssText = 'background:' + grad + ';padding:20px;position:relative;overflow:hidden;';
    header.innerHTML = `
        <div style="position:absolute;right:-16px;top:-16px;width:70px;height:70px;background:rgba(255,255,255,0.08);border-radius:50%;"></div>
        <div style="display:flex;align-items:flex-start;gap:12px;position:relative;">
            <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${icon}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:9px;font-weight:900;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">${typeLabel}</div>
                <div style="font-weight:900;font-size:16px;color:white;line-height:1.3;">${item.title || 'Untitled'}</div>
                <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:9px;font-weight:900;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,0.2);color:white;">${statusBadge}</span>
                    ${item.client ? '<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.9);">👤 '+item.client+'</span>' : ''}
                </div>
            </div>
            <button onclick="closeItemDetailPopup()" style="width:28px;height:28px;background:rgba(255,255,255,0.15);border:none;border-radius:8px;cursor:pointer;color:white;font-size:14px;flex-shrink:0;">✕</button>
        </div>`;

    // Body details
    const rows = [];
    if(isTask) {
        if(item.dueDate) rows.push(['📅 Due Date', new Date(item.dueDate).toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'long',year:'numeric'})]);
        if(item.priority) rows.push(['🚨 Priority', item.priority]);
        rows.push(['📋 Status', item.status || 'Pending']);
        rows.push(['🕐 Created', new Date(item.timestamp).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})]);
    } else {
        if(item.time && item.time !== 'Manual' && item.time !== 'जल्द') {
            const d = new Date(item.time);
            rows.push(['⏰ Scheduled', isNaN(d) ? item.time : d.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'long'}) + ' · ' + d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})]);
        } else {
            rows.push(['⏰ Time', item.time || 'Not set']);
        }
        rows.push(['📋 Status', item.status || 'Active']);
        rows.push(['🕐 Created', new Date(item.timestamp||Date.now()).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})]);
    }

    body.innerHTML = rows.map(([label, val]) =>
        `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:11px;font-weight:700;color:#94a3b8;min-width:100px;">${label}</span>
            <span style="font-size:12px;font-weight:600;color:#334155;">${val}</span>
        </div>`
    ).join('');

    // Action buttons
    actions.innerHTML = '';
    if(isTask && item._docId && item.status !== 'Done' && item.status !== 'Finished') {
        const doneBtn = document.createElement('button');
        doneBtn.style.cssText = 'flex:1;padding:12px;border-radius:14px;background:linear-gradient(135deg,#10b981,#059669);color:white;font-weight:800;font-size:13px;border:none;cursor:pointer;';
        doneBtn.textContent = '✅ Mark Done';
        doneBtn.onclick = async () => {
            item.status = 'Done';
            try { await updateDoc(doc(db, 'tasks', item._docId), { status: 'Done' }); } catch(e) {}
            closeItemDetailPopup();
        };
        actions.appendChild(doneBtn);
    }
    if(!isTask && item._docId && item.status !== 'Closed') {
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'flex:1;padding:12px;border-radius:14px;background:linear-gradient(135deg,#10b981,#059669);color:white;font-weight:800;font-size:13px;border:none;cursor:pointer;';
        closeBtn.textContent = '✅ Mark Closed';
        closeBtn.onclick = async () => {
            item.status = 'Closed';
            try { await updateDoc(doc(db, 'reminders', item._docId), { status: 'Closed' }); } catch(e) {}
            closeItemDetailPopup();
        };
        actions.appendChild(closeBtn);
    }
    const dismissBtn = document.createElement('button');
    dismissBtn.style.cssText = 'flex:1;padding:12px;border-radius:14px;background:#f1f5f9;color:#475569;font-weight:700;font-size:13px;border:none;cursor:pointer;';
    dismissBtn.textContent = '✕ Dismiss';
    dismissBtn.onclick = closeItemDetailPopup;
    actions.appendChild(dismissBtn);

    popup.classList.remove('hidden');
};

// ╔══════════════════════════════════════════════════════════════╗
// ║  CLIENT DETAIL POPUP + CLIENT LIST                           ║
// ╚══════════════════════════════════════════════════════════════╝

window.closeClientDetailPopup = function() {
    document.getElementById('client-detail-popup').classList.add('hidden');
};

window.showClientDetailPopup = function(clientName) {
    const popup   = document.getElementById('client-detail-popup');
    const content = document.getElementById('client-detail-content');
    const key = clientName.toUpperCase();
    const group = allGroupedNotes[key];
    if(!group) return;

    const pal = (window._getCardPalette || (n => ({ grad:'linear-gradient(135deg,#6366f1,#3b82f6)', border:'#6366f1', light:'#ede9fe', text:'#4f46e5' })))(group.displayTitle);
    const sortedUpdates = [...group.updates].sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
    const latestUpdate = sortedUpdates[0];
    const initials = group.displayTitle.split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'?';

    function fmtD(ts) { return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
    function fmtT(ts) { return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }

    const infoRows = [];
    if(group.mobile)  infoRows.push(['📱 Mobile',  group.mobile]);
    if(group.account) infoRows.push(['🏦 Account', group.account]);
    if(group.address) infoRows.push(['📍 Address', group.address]);
    infoRows.push(['📋 Updates', group.updates.length]);
    infoRows.push(['🕐 Last Updated', fmtD(latestUpdate.timestamp)]);

    const updatesHTML = sortedUpdates.map((u,idx) => {
        const isLatest = idx === 0;
        return `<div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;last-child:border-bottom:none;${isLatest?'background:'+pal.light+'30;':''}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
                <span style="font-size:9px;font-weight:900;padding:2px 8px;border-radius:20px;${isLatest?'background:'+pal.light+';color:'+pal.text+';':'background:#f1f5f9;color:#64748b;'}">📅 ${fmtD(u.timestamp)} ⏰ ${fmtT(u.timestamp)}</span>
                ${isLatest ? '<span style="font-size:8px;font-weight:900;color:white;padding:2px 8px;border-radius:20px;background:'+pal.border+';">LATEST</span>' : ''}
                <span style="font-size:9px;color:#cbd5e1;margin-left:auto;">#${sortedUpdates.length-idx}</span>
            </div>
            <p style="font-size:13px;color:#334155;font-weight:500;white-space:pre-wrap;margin:0;line-height:1.6;" class="devanagari">${u.content||''}</p>
        </div>`;
    }).join('');

    content.innerHTML = `
        <div style="background:${pal.grad};padding:18px 20px 14px;position:relative;overflow:hidden;flex-shrink:0;">
            <div style="position:absolute;right:-20px;top:-20px;width:80px;height:80px;background:rgba(255,255,255,0.08);border-radius:50%;"></div>
            <div style="display:flex;align-items:flex-start;gap:12px;position:relative;">
                <div style="width:48px;height:48px;background:rgba(255,255,255,0.22);border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;color:white;border:1.5px solid rgba(255,255,255,0.3);flex-shrink:0;">${initials}</div>
                <div style="flex:1;">
                    <div style="font-size:9px;font-weight:900;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">👤 CLIENT PROFILE</div>
                    <div style="font-weight:900;font-size:18px;color:white;line-height:1.2;">${group.displayTitle}</div>
                </div>
                <button onclick="closeClientDetailPopup()" style="width:30px;height:30px;background:rgba(255,255,255,0.15);border:none;border-radius:9px;cursor:pointer;color:white;font-size:15px;flex-shrink:0;">✕</button>
            </div>
        </div>
        <div style="background:#f8fafc;border-left:4px solid ${pal.border};padding:10px 16px;">
            ${infoRows.map(([l,v])=>`<div style="display:flex;align-items:center;gap:10px;padding:4px 0;border-bottom:1px solid #f1f5f9;"><span style="font-size:10px;font-weight:700;color:#94a3b8;min-width:110px;">${l}</span><span style="font-size:11px;font-weight:600;color:#334155;">${v}</span></div>`).join('')}
        </div>
        <div style="overflow-y:auto;max-height:50vh;">${updatesHTML}</div>`;
    popup.classList.remove('hidden');
};

window.openClientListPopup = function() {
    const popup = document.getElementById('client-list-popup');
    const body  = document.getElementById('client-list-body');
    const count = document.getElementById('client-list-count');
    const entries = Object.values(allGroupedNotes);
    if(count) count.textContent = entries.length + ' client' + (entries.length !== 1 ? 's' : '');
    renderClientList(entries, body);
    popup.classList.remove('hidden');
};

window.closeClientListPopup = function() {
    document.getElementById('client-list-popup').classList.add('hidden');
};

function renderClientList(entries, body) {
    body.innerHTML = '';
    if(entries.length === 0) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">No clients found</div>';
        return;
    }
    const sorted = [...entries].sort((a,b) => {
        const aT = Math.max(...a.updates.map(u => new Date(u.timestamp)));
        const bT = Math.max(...b.updates.map(u => new Date(u.timestamp)));
        return bT - aT;
    });
    sorted.forEach((group, idx) => {
        const pal = (window._getCardPalette || (n => ({ border:'#6366f1', light:'#ede9fe', text:'#4f46e5' })))(group.displayTitle);
        const initials = group.displayTitle.split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'?';
        const latest = [...group.updates].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''))[0];
        const latestDate = new Date(latest?.timestamp||Date.now()).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 8px;border-radius:12px;cursor:pointer;transition:background 0.15s;border-bottom:1px solid #f8fafc;';
        row.innerHTML = `
            <div style="width:38px;height:38px;border-radius:12px;background:${pal.light};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;color:${pal.text};border:2px solid ${pal.border}20;flex-shrink:0;">${initials}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:800;font-size:13px;color:#0f172a;margin-bottom:2px;">${group.displayTitle}</div>
                <div style="font-size:10px;color:#94a3b8;font-weight:600;">${group.updates.length} update${group.updates.length>1?'s':''} · ${latestDate}</div>
            </div>
            ${group.mobile ? '<div style="font-size:10px;font-weight:700;color:#64748b;">📱 '+group.mobile+'</div>' : ''}
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#cbd5e1" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`;
        row.onmouseenter = () => row.style.background = '#f8fafc';
        row.onmouseleave = () => row.style.background = '';
        row.onclick = () => {
            closeClientListPopup();
            setTimeout(() => showClientDetailPopup(group.displayTitle), 100);
        };
        body.appendChild(row);
    });
}

window.filterClientList = function(q) {
    const entries = Object.values(allGroupedNotes).filter(g =>
        g.displayTitle.toLowerCase().includes(q.toLowerCase()) ||
        (g.mobile||'').includes(q)
    );
    renderClientList(entries, document.getElementById('client-list-body'));
};

// ╔══════════════════════════════════════════════════════════════╗
// ║  FOCUS MODE — Full-screen read popup for any card            ║
// ╚══════════════════════════════════════════════════════════════╝

window.openFocusMode = function(type, data) {
    const popup   = document.getElementById('focus-popup');
    const body    = document.getElementById('focus-body');
    if(!popup || !body) return;

    const PALETTES = [
        { grad:'linear-gradient(135deg,#6366f1,#8b5cf6)', border:'#6366f1', light:'#ede9fe', text:'#4f46e5' },
        { grad:'linear-gradient(135deg,#0891b2,#2563eb)', border:'#0891b2', light:'#cffafe', text:'#0e7490' },
        { grad:'linear-gradient(135deg,#059669,#0d9488)', border:'#059669', light:'#d1fae5', text:'#047857' },
        { grad:'linear-gradient(135deg,#dc2626,#db2777)', border:'#dc2626', light:'#fee2e2', text:'#b91c1c' },
        { grad:'linear-gradient(135deg,#d97706,#f59e0b)', border:'#d97706', light:'#fef3c7', text:'#b45309' },
        { grad:'linear-gradient(135deg,#7c3aed,#a855f7)', border:'#7c3aed', light:'#f3e8ff', text:'#6d28d9' },
        { grad:'linear-gradient(135deg,#0f766e,#065f46)', border:'#0f766e', light:'#ccfbf1', text:'#0f766e' },
        { grad:'linear-gradient(135deg,#be185d,#9d174d)', border:'#be185d', light:'#fce7f3', text:'#be185d' },
    ];
    function getPal(name) {
        const h = (name||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0);
        return PALETTES[h % PALETTES.length];
    }
    function fmt(ts) {
        if(!ts) return '';
        const d = new Date(ts);
        return isNaN(d) ? ts : d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) + ' ' + d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
    }
    function esc(str) {
        const div = document.createElement('div'); div.textContent = str||''; return div.innerHTML;
    }

    body.innerHTML = '';
    let html = '';

    if(type === 'client') {
        // data = group object { displayTitle, mobile, account, address, updates[] }
        const pal = getPal(data.displayTitle);
        const words = (data.displayTitle||'').trim().split(/\s+/);
        const initials = ((words[0]?.[0]||'') + (words[1]?.[0]||'')).toUpperCase();
        const sorted = [...(data.updates||[])].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
        html = `
        <div style="background:${pal.grad};padding:24px 24px 20px;position:relative;overflow:hidden;">
            <div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.07);"></div>
            <div style="display:flex;align-items:center;gap:14px;">
                <div style="width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.22);border:2px solid rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff;flex-shrink:0;">${esc(initials)||'?'}</div>
                <div>
                    <div style="font-size:10px;font-weight:800;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">👤 CLIENT PROFILE</div>
                    <div style="font-size:20px;font-weight:900;color:#fff;">${esc(data.displayTitle)}</div>
                    ${data.mobile ? `<div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:3px;">📞 ${esc(data.mobile)}</div>` : ''}
                </div>
            </div>
            ${data.account ? `<div style="margin-top:10px;font-size:11px;font-weight:700;color:rgba(255,255,255,.7);">🏦 Account: ${esc(data.account)}</div>` : ''}
            ${data.address ? `<div style="margin-top:4px;font-size:11px;font-weight:700;color:rgba(255,255,255,.7);">📍 ${esc(data.address)}</div>` : ''}
        </div>
        <div style="padding:16px 20px;background:#f8fafc;">
            <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">📋 All Updates (${sorted.length})</div>
            ${sorted.map((u,i) => `
                <div style="background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:8px;border-left:3px solid ${pal.border};box-shadow:0 1px 6px rgba(0,0,0,.05);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                        <span style="font-size:9px;font-weight:900;background:${pal.light};color:${pal.text};padding:2px 8px;border-radius:6px;">${i===0?'✨ Latest':'#'+(sorted.length-i)}</span>
                        <span style="font-size:10px;color:#94a3b8;">${fmt(u.timestamp)}</span>
                    </div>
                    <div style="font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;word-break:break-word;">${esc(u.content||u.info||u.updates||'')}</div>
                </div>`).join('')}
        </div>`;

    } else if(type === 'task') {
        // data = task object
        const isDone = data.status === 'Done' || data.status === 'Finished';
        const grad = isDone ? 'linear-gradient(135deg,#059669,#0d9488)' : data.priority === 'Urgent' ? 'linear-gradient(135deg,#dc2626,#db2777)' : 'linear-gradient(135deg,#f59e0b,#d97706)';
        const d = new Date(data.timestamp);
        const dateStr = isNaN(d) ? '' : d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
        const timeStr = isNaN(d) ? '' : d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
        html = `
        <div style="background:${grad};padding:24px 24px 20px;position:relative;overflow:hidden;">
            <div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.07);"></div>
            <div style="font-size:10px;font-weight:800;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">✅ TASK</div>
            <div style="font-size:20px;font-weight:900;color:#fff;line-height:1.35;">${esc(data.title)}</div>
            <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">
                <span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">${isDone ? '✅ '+data.status : '⏳ '+data.status}</span>
                ${data.priority === 'Urgent' ? '<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">🚨 URGENT</span>' : ''}
                ${data.dueDate ? `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">📅 Due: ${new Date(data.dueDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span>` : ''}
            </div>
        </div>
        <div style="padding:20px 24px;">
            ${data.client ? `<div style="margin-bottom:14px;padding:12px 16px;background:#eff6ff;border-radius:12px;border-left:3px solid #3b82f6;"><span style="font-size:11px;font-weight:700;color:#1d4ed8;">👤 Client: ${esc(data.client)}</span></div>` : ''}
            ${data.notes ? `<div style="margin-bottom:14px;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📝 Notes</div><div style="font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;">${esc(data.notes)}</div></div>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                <span style="font-size:11px;color:#94a3b8;">🕐 Created: ${dateStr} ${timeStr}</span>
                ${data.finishedAt ? `<span style="font-size:11px;color:#059669;">🏁 Finished: ${fmt(data.finishedAt)}</span>` : ''}
            </div>
        </div>`;

    } else if(type === 'reminder') {
        // data = reminder object
        const remDate = data.time && data.time !== 'Manual' && data.time !== 'जल्द' ? new Date(data.time) : null;
        const isClosed = data.status === 'Closed';
        const isOverdue = !isClosed && remDate && remDate < new Date();
        const isToday = !isClosed && remDate && remDate.toDateString() === new Date().toDateString();
        const grad = isClosed ? 'linear-gradient(135deg,#059669,#0d9488)' : isOverdue ? 'linear-gradient(135deg,#dc2626,#db2777)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)';
        const timeLabel = isClosed ? '🏁 Closed' : isOverdue ? '🔴 Overdue' : isToday ? '🟠 Today' : '⏰ Upcoming';
        let daysInfo = '';
        if(remDate && !isClosed) {
            const diff = Math.ceil((remDate - new Date()) / (1000*60*60*24));
            if(isOverdue) daysInfo = `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">${Math.abs(diff)}d overdue</span>`;
            else if(diff === 0) daysInfo = `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">Due Today!</span>`;
            else daysInfo = `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">in ${diff} day${diff!==1?'s':''}</span>`;
        }
        const remDocId = data._docId || '';
        html = `
        <div style="background:${grad};padding:24px 24px 20px;position:relative;overflow:hidden;">
            <div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.07);"></div>
            <div style="font-size:10px;font-weight:800;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">⏰ REMINDER</div>
            <div style="font-size:20px;font-weight:900;color:#fff;line-height:1.35;">${esc(data.title)}</div>
            <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">
                <span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">${timeLabel}</span>
                ${remDate && !isNaN(remDate) ? `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">⏰ Deadline: ${remDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}${remDate.getHours()||remDate.getMinutes() ? ' · '+remDate.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}) : ''}</span>` : ''}
                ${daysInfo}
            </div>
        </div>
        <div style="padding:20px 24px;">
            ${data.client ? `<div style="margin-bottom:14px;padding:12px 16px;background:#eff6ff;border-radius:12px;border-left:3px solid #3b82f6;"><span style="font-size:11px;font-weight:700;color:#1d4ed8;">👤 Client: ${esc(data.client)}</span></div>` : ''}
            ${data.type ? `<div style="margin-bottom:10px;"><span style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;">Type: </span><span style="font-size:11px;font-weight:700;color:#334155;">${esc(data.type)}</span></div>` : ''}
            ${data.description||data.notes ? `<div style="margin-bottom:14px;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📝 Details</div><div style="font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;">${esc(data.description||data.notes)}</div></div>` : ''}
            ${data.finishedAt ? `<div style="font-size:11px;color:#059669;margin-bottom:8px;">🏁 Closed: ${fmt(data.finishedAt)}</div>` : ''}
            <div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">🕐 Created: ${fmt(data.timestamp)}</div>
            ${!isClosed ? `<div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button id="fm-close-rem-btn" style="flex:1;min-width:120px;padding:12px 16px;border-radius:14px;background:linear-gradient(135deg,#10b981,#059669);color:white;font-weight:800;font-size:13px;border:none;cursor:pointer;">✅ Close Reminder</button>
                ${isOverdue ? `<button id="fm-snooze-rem-btn" style="flex:1;min-width:120px;padding:12px 16px;border-radius:14px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;font-weight:800;font-size:13px;border:none;cursor:pointer;">⏩ Snooze 1 Day</button>` : ''}
            </div>` : ''}
        </div>`;

    } else if(type === 'notebook') {
        // data = notebook group { displayName, updates[] }
        const pal = getPal(data.displayName);
        const sorted = [...(data.updates||[])].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
        html = `
        <div style="background:${pal.grad};padding:24px 24px 20px;position:relative;overflow:hidden;">
            <div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.07);"></div>
            <div style="font-size:10px;font-weight:800;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">📓 NOTEBOOK</div>
            <div style="font-size:20px;font-weight:900;color:#fff;">${esc(data.displayName)}</div>
            <div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,.7);">${sorted.length} page${sorted.length!==1?'s':''}</div>
        </div>
        <div style="padding:16px 20px;background:#f8fafc;">
            ${sorted.map((u,i) => `
                <div style="background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:8px;border-left:3px solid ${pal.border};box-shadow:0 1px 6px rgba(0,0,0,.05);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <span style="font-size:9px;font-weight:900;background:${pal.light};color:${pal.text};padding:2px 8px;border-radius:6px;">${i===0?'✨ Latest':'Page '+(sorted.length-i)}</span>
                        <span style="font-size:10px;color:#94a3b8;">${fmt(u.timestamp)}</span>
                    </div>
                    <div style="font-size:13px;color:#374151;line-height:1.75;white-space:pre-wrap;word-break:break-word;">${esc(u.content||u.info||'')}</div>
                </div>`).join('')}
        </div>`;
    }

    body.innerHTML = html;
    popup.classList.remove('hidden');
    document.addEventListener('keydown', _focusEscHandler);

    // Focus mode reminder action buttons
    const fmCloseBtn = document.getElementById('fm-close-rem-btn');
    if(fmCloseBtn && type === 'reminder' && data._docId && !data._docId.startsWith('_pending_')) {
        fmCloseBtn.addEventListener('click', async () => {
            const finishedAt = new Date().toISOString();
            data.status = 'Closed';
            data.finishedAt = finishedAt;
            closeFocusMode();
            renderReminders();
            try { await updateDoc(doc(db, 'reminders', data._docId), { status: 'Closed', finishedAt }); } catch(e) {}
        });
    }
    const fmSnoozeBtn = document.getElementById('fm-snooze-rem-btn');
    if(fmSnoozeBtn && type === 'reminder' && data._docId && !data._docId.startsWith('_pending_')) {
        fmSnoozeBtn.addEventListener('click', async () => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            const newTime = tomorrow.toISOString();
            data.time = newTime;
            closeFocusMode();
            renderReminders();
            try {
                await updateDoc(doc(db, 'reminders', data._docId), { time: newTime });
                if(window.scheduleReminder) scheduleReminder(data);
            } catch(e) {}
        });
    }
};

function _focusEscHandler(e) {
    if(e.key === 'Escape') closeFocusMode();
}

window.closeFocusMode = function() {
    document.getElementById('focus-popup')?.classList.add('hidden');
    document.removeEventListener('keydown', _focusEscHandler);
};

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

// Track task/reminder IDs seen on last page visit — badge shows only NEW items added after
let _seenTaskIds = null;   // null = page never visited this session
let _seenRemIds  = null;

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
    // Snapshot current IDs so badge shows 0 until new items arrive
    if(page === 'tasks') {
        _seenTaskIds = new Set(
            (typeof allTasks !== 'undefined' ? allTasks : [])
                .filter(t => !t.deleted && t.status !== 'Done' && t.status !== 'Finished')
                .map(t => t._docId)
        );
        changed = true;
    }
    if(page === 'reminders') {
        _seenRemIds = new Set(
            (typeof allReminders !== 'undefined' ? allReminders : [])
                .filter(r => r.status !== 'Closed' && r.status !== 'Done')
                .map(r => r._docId)
        );
        changed = true;
    }
    if(changed) {
        NS.unread = NS.items.filter(i => !i.read).length;
        refreshBadges();
        renderNotifList();
    }
}

// Wrap switchView to clear badges on page visit + reset task filter
const _baseSwitchViewUP = switchView;
window.switchView = function(targetView) {
    _baseSwitchViewUP(targetView);
    markPageNotifsRead(targetView);
    if(targetView === 'tasks' && window._resetTaskFilter) window._resetTaskFilter();
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

document.getElementById('notif-bell-btn')?.addEventListener('click', openNotifPanel);
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

    // Bell badge (sidebar + mobile + fixed top-right)
    ['bell-badge','bell-badge-mob','bell-badge-fixed'].forEach(id => {
        const el = document.getElementById(id);
        if(!el) return;
        if(total > 0) { el.textContent = total > 9 ? '9+' : total; el.style.display = 'flex'; }
        else el.style.display = 'none';
    });
    // Bell dot SVG
    const dot = document.getElementById('bell-dot');
    if(dot) dot.style.display = total > 0 ? '' : 'none';

    // Task badge on sidebar — show new tasks added since last visit (clears on page visit)
    const tb = document.getElementById('task-badge');
    if(tb) {
        const pendingTasks = (typeof allTasks !== 'undefined' ? allTasks : [])
            .filter(t => !t.deleted && t.status !== 'Done' && t.status !== 'Finished');
        const taskBadgeCount = _seenTaskIds === null
            ? pendingTasks.length
            : pendingTasks.filter(t => !_seenTaskIds.has(t._docId)).length;
        if(taskBadgeCount > 0) { tb.textContent = taskBadgeCount > 9 ? '9+' : taskBadgeCount; tb.style.display='flex'; }
        else tb.style.display='none';
    }
    // Reminder badge on sidebar — show new reminders added since last visit (clears on page visit)
    const rb = document.getElementById('rem-badge');
    if(rb) {
        const activeRems = (typeof allReminders !== 'undefined' ? allReminders : [])
            .filter(r => r.status !== 'Closed' && r.status !== 'Done');
        const remBadgeCount = _seenRemIds === null
            ? activeRems.length
            : activeRems.filter(r => !_seenRemIds.has(r._docId)).length;
        if(remBadgeCount > 0) { rb.textContent = remBadgeCount > 9 ? '9+' : remBadgeCount; rb.style.display='flex'; }
        else rb.style.display='none';
    }
    // Panel header unread badge
    const ub = document.getElementById('np-unread-badge');
    if(ub) { if(total>0){ub.textContent=total;ub.style.display='';} else ub.style.display='none'; }
}

// ─── Refresh summary counters in panel header — uses live data ──
function refreshCounters() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Live counts from global arrays
    const pendingTasks  = allTasks.filter(t => t.status !== 'Done' && t.status !== 'Finished').length;
    const overdueCount  = allTasks.filter(t => {
        if(t.status === 'Done' || t.status === 'Finished') return false;
        const d = t.dueDate ? new Date(t.dueDate) : new Date(t.timestamp);
        return d < todayStart;
    }).length;
    const activeRem = allReminders.filter(r => r.status !== 'Closed').length;

    const tn = document.getElementById('np-task-num');
    const rn = document.getElementById('np-rem-num');
    const sn = document.getElementById('np-saved-num');
    if(tn) { tn.textContent = pendingTasks; tn.title = overdueCount > 0 ? overdueCount + ' overdue' : ''; tn.style.color = overdueCount > 0 ? '#ef4444' : '#fbbf24'; }
    if(rn) rn.textContent = activeRem;
    if(sn) sn.textContent = NS.savedToday;
}

// Cache notif-empty element ONCE — prevents null after list.innerHTML='' removes it
const _notifEmpty = document.getElementById('notif-empty');

// ─── Render notification list ─────────────────────────────────────
function renderNotifList() {
    const list  = document.getElementById('notif-list');
    const empty = _notifEmpty;  // use cached reference — never null
    refreshCounters();
    list.innerHTML = '';  // removes children including #notif-empty, but 'empty' ref stays valid

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // ── LIVE PENDING SECTION ─────────────────────────────────────
    const showLive = NS.filter === 'all' || NS.filter === 'task' || NS.filter === 'reminder';
    if(showLive) {
        const pendingTasks = allTasks.filter(t => t.status !== 'Done' && t.status !== 'Finished');
        const activeRem    = allReminders.filter(r => r.status !== 'Closed');

        if(pendingTasks.length > 0 || activeRem.length > 0) {
            const sec = document.createElement('div');
            sec.style.cssText = 'margin-bottom:8px;';
            sec.innerHTML = '<div style="font-size:9px;font-weight:900;color:#6366f1;text-transform:uppercase;letter-spacing:1px;padding:6px 4px 4px;">⚡ Live Pending</div>';

            const showItems = [
                ...(NS.filter !== 'reminder' ? pendingTasks.slice(0, 5) : []).map(t => ({ ...t, _liveType: 'task' })),
                ...(NS.filter !== 'task'     ? activeRem.slice(0, 5)   : []).map(r => ({ ...r, _liveType: 'reminder' }))
            ];

            showItems.forEach(item => {
                const isOverdue = item._liveType === 'task'
                    ? (item.dueDate ? new Date(item.dueDate) : new Date(item.timestamp)) < todayStart
                    : (item.time && item.time !== 'Manual' && item.time !== 'जल्द' && new Date(item.time) < now);
                const row = document.createElement('div');
                row.className = 'nitem unread';
                row.style.cssText = isOverdue ? 'background:#fef2f2;border-color:#fecaca;cursor:pointer;' : 'cursor:pointer;';
                const icon = item._liveType === 'task' ? '✅' : '⏰';
                const iconBg = item._liveType === 'task' ? '#fbbf24' : '#ef4444';
                const titleText = item.title || item.client || 'Untitled';
                const subText   = item.client ? '👤 ' + item.client : '';
                const timeInfo  = item.dueDate ? '📅 ' + new Date(item.dueDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) :
                                  item.time && item.time !== 'Manual' ? '⏰ ' + item.time.substring(0,16) : '';
                row.innerHTML =
                    '<div class="nicon" style="background:' + iconBg + '20;color:' + iconBg + ';font-size:15px;">' + icon + '</div>' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div class="ntitle">' + titleText + (isOverdue ? ' <span style="color:#ef4444;font-size:9px;font-weight:900;">OVERDUE</span>' : '') + '</div>' +
                        (subText ? '<div class="nsub">' + subText + '</div>' : '') +
                        (timeInfo ? '<div class="ntime">' + timeInfo + '</div>' : '') +
                    '</div>' +
                    '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#94a3b8" stroke-width="2" style="flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';
                row.onclick = () => showItemDetailPopup(item, item._liveType);
                sec.appendChild(row);
            });
            list.appendChild(sec);
            // Divider
            const divider = document.createElement('div');
            divider.style.cssText = 'font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;padding:6px 4px 4px;border-top:1px solid #f1f5f9;margin-bottom:4px;';
            divider.textContent = '📋 Recent Activity';
            list.appendChild(divider);
        }
    }

    // ── CLIENTS TAB ───────────────────────────────────────────────
    if(NS.filter === 'case') {
        // Use allGroupedNotes (has account extracted already); fallback to rebuilding from allSavedNotes
        let grpObj = allGroupedNotes;
        if(!grpObj || Object.keys(grpObj).length === 0) {
            grpObj = {};
            (allSavedNotes || []).forEach(note => {
                const key = (note.client || note.title || 'सामान्य').toUpperCase();
                const name = note.client || note.title || 'सामान्य';
                if(!grpObj[key]) grpObj[key] = { displayTitle: name, mobile: null, account: null, updates: [] };
                const g = grpObj[key];
                if(!g.mobile && note.mobile) g.mobile = note.mobile;
                if(!g.mobile) { const m = (note.content||'').match(/\b[6-9]\d{9}\b/); if(m) g.mobile = m[0]; }
                if(!g.account && note.account) g.account = note.account;
                if(!g.account) { const a = (note.content||'').match(/(?:account|acc|खाता)[^\d]*(\d[\d\s\-\/]{5,20}\d)/i); if(a) g.account = a[1].trim(); }
                g.updates.push(note);
            });
        }
        const entries = Object.values(grpObj).sort((a,b) => (a.displayTitle||'').localeCompare(b.displayTitle||''));

        // Hide/show empty state
        if(empty) empty.style.display = 'none';

        if(entries.length === 0) {
            // Show a friendly empty message directly in list
            const msg = document.createElement('div');
            msg.style.cssText = 'text-align:center;padding:40px 20px;color:#94a3b8;';
            msg.innerHTML = '<div style="font-size:32px;margin-bottom:8px;">👤</div><div style="font-weight:700;font-size:13px;">Koi client nahi mila</div>';
            list.appendChild(msg);
            return;
        }

        // Header
        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:10px;font-weight:900;color:#0891b2;text-transform:uppercase;letter-spacing:1px;padding:8px 6px 10px;border-bottom:1px solid #e0f2fe;margin-bottom:4px;';
        hdr.textContent = '👥 Total Clients: ' + entries.length;
        list.appendChild(hdr);

        const PALETTES = [
            { border:'#6366f1', light:'#ede9fe', text:'#4f46e5' },
            { border:'#0891b2', light:'#cffafe', text:'#0e7490' },
            { border:'#059669', light:'#d1fae5', text:'#047857' },
            { border:'#dc2626', light:'#fee2e2', text:'#b91c1c' },
            { border:'#d97706', light:'#fef3c7', text:'#b45309' },
            { border:'#7c3aed', light:'#f3e8ff', text:'#6d28d9' },
            { border:'#be185d', light:'#fce7f3', text:'#be185d' },
        ];

        entries.forEach((group, idx) => {
            const name = group.displayTitle || '';
            const hash = name.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
            const pal  = PALETTES[hash % PALETTES.length];
            const words = name.trim().split(/\s+/);
            const initials = ((words[0]||'')[0]||'').toUpperCase() + ((words[1]||'')[0]||'').toUpperCase();

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 8px;border-bottom:1px solid #f1f5f9;cursor:pointer;transition:background .15s;';
            row.onmouseenter = () => row.style.background = '#f8fafc';
            row.onmouseleave = () => row.style.background = '';

            // SL + Avatar
            const sl = document.createElement('div');
            sl.style.cssText = 'width:34px;height:34px;border-radius:10px;background:' + pal.light + ';border:1.5px solid ' + pal.border + ';display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;';
            const slNum = document.createElement('div');
            slNum.style.cssText = 'font-size:8px;font-weight:900;color:' + pal.text + ';line-height:1;';
            slNum.textContent = String(idx + 1).padStart(2, '0');
            const slInit = document.createElement('div');
            slInit.style.cssText = 'font-size:11px;font-weight:900;color:' + pal.text + ';line-height:1;margin-top:1px;';
            slInit.textContent = initials || '?';
            sl.appendChild(slNum);
            sl.appendChild(slInit);

            // Info block
            const info = document.createElement('div');
            info.style.cssText = 'flex:1;min-width:0;';

            const nameEl = document.createElement('div');
            nameEl.style.cssText = 'font-size:13px;font-weight:800;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            nameEl.textContent = name;
            info.appendChild(nameEl);

            const detailRow = document.createElement('div');
            detailRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:3px;';

            if(group.mobile) {
                const mob = document.createElement('span');
                mob.style.cssText = 'font-size:10px;font-weight:700;color:#0891b2;background:#e0f2fe;padding:1px 6px;border-radius:5px;';
                mob.textContent = '📞 ' + group.mobile;
                detailRow.appendChild(mob);
            }
            if(group.account) {
                const acc = document.createElement('span');
                acc.style.cssText = 'font-size:10px;font-weight:700;color:#059669;background:#d1fae5;padding:1px 6px;border-radius:5px;';
                acc.textContent = '🏦 ' + group.account;
                detailRow.appendChild(acc);
            }
            if(detailRow.children.length > 0) info.appendChild(detailRow);

            // Arrow
            const arr = document.createElement('div');
            arr.style.cssText = 'color:#cbd5e1;font-size:16px;flex-shrink:0;';
            arr.textContent = '›';

            row.appendChild(sl);
            row.appendChild(info);
            row.appendChild(arr);
            row.onclick = () => { closeNotifPanel(); setTimeout(() => showClientDetailPopup(name), 200); };
            list.appendChild(row);
        });
        return;
    }

    // ── NOTIFICATION HISTORY ────────────────────────────────────
    const cfg = {
        task:     { bg:'#fbbf24', icon:'✅', label:'Task' },
        reminder: { bg:'#ef4444', icon:'⏰', label:'Reminder' },
        notebook: { bg:'#6366f1', icon:'📓', label:'Notebook' },
        case:     { bg:'#0891b2', icon:'👤', label:'Client' },
    };
    const show = NS.filter === 'all' ? NS.items : NS.items.filter(i => i.type === NS.filter);

    if(show.length === 0 && list.childElementCount === 0) {
        list.appendChild(empty); empty.style.display = 'block'; return;
    }
    empty.style.display = 'none';

    [...show].reverse().forEach(item => {
        const c = cfg[item.type] || cfg.notebook;
        const d = document.createElement('div');
        d.className = 'nitem ' + (item.read ? 'read' : 'unread');
        d.innerHTML =
            '<div class="nicon" style="background:' + c.bg + '20;color:' + c.bg + ';font-size:15px;">' + c.icon + '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<div class="ntitle">' + item.title + '</div>' +
                (item.sub ? '<div class="nsub">' + item.sub + '</div>' : '') +
                '<div class="ntime">' + item.time + '</div>' +
            '</div>' +
            (!item.read ? '<div class="ndot"></div>' : '');
        d.onclick = () => { item.read = true; NS.unread = Math.max(0, NS.unread-1); refreshBadges(); renderNotifList(); };
        list.appendChild(d);
    });
    if(list.childElementCount === 0) { list.appendChild(empty); empty.style.display = 'block'; }
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
    const icons = {task:'✅',reminder:'⏰',notebook:'📓',case:'👤'};
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
        const labels = {task:'Task',reminder:'Reminder',notebook:'Notebook',case:'Client'};
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
        // Start daily summary schedule now that push is enabled
        scheduleDailySummaryNotifs();
        sendOverdueBrowserPush();
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
    if(rem.status === 'Closed') return;
    const fireAt = new Date(rem.time);
    if(isNaN(fireAt)) {
        console.warn('[CaseDesk] Invalid reminder time:', rem.time, 'for:', rem.title);
        return;
    }
    const key = rem.title + '|' + rem.time;
    if(NS.scheduledKeys.has(key)) return;
    NS.scheduledKeys.add(key);

    const msLeft = fireAt - Date.now();
    if(msLeft > 0 && msLeft < 7 * 24 * 3600 * 1000) {
        // In-app notification at exact time
        setTimeout(() => {
            if(rem.status === 'Closed') return; // Skip if closed by then
            addNotif('reminder', '⏰ ' + rem.title, rem.client ? 'Client: ' + rem.client : 'Reminder time!');
            if(NS.pushOK) browserPush('reminder', rem.title, rem.client || 'Reminder!');
        }, msLeft);
        console.log('[CaseDesk] Reminder scheduled:', rem.title, 'in', Math.round(msLeft/60000), 'min');
    } else if(msLeft > 0) {
        // Future beyond 7 days — still schedule for up to 30 days
        if(msLeft < 30 * 24 * 3600 * 1000) {
            setTimeout(() => {
                if(rem.status === 'Closed') return;
                addNotif('reminder', '⏰ ' + rem.title, rem.client ? 'Client: ' + rem.client : 'Reminder time!');
                if(NS.pushOK) browserPush('reminder', rem.title, rem.client || 'Reminder!');
            }, msLeft);
        }
    } else if(msLeft <= 0 && msLeft > -7 * 24 * 3600 * 1000) {
        // Overdue — show notification for reminders missed within last 7 days
        const daysMissed = Math.ceil(Math.abs(msLeft) / (1000*60*60*24));
        const overdueMsg = daysMissed <= 1 ? '(aaj miss hua)' : `(${daysMissed} din pehle)`;
        addNotif('reminder', '🔴 Overdue: ' + rem.title, (rem.client ? rem.client + ' — ' : '') + overdueMsg);
        if(NS.pushOK) browserPush('reminder', '🔴 Overdue: ' + rem.title, rem.client || overdueMsg);
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
        setTimeout(() => {
            showOverduePopup();
            sendOverdueBrowserPush();
            scheduleDailySummaryNotifs();
        }, 800);
    }
}

window._onTasksLoaded = function() { window._overdueTasksReady = true; _checkOverdueReady(); };
window._onRemindersLoaded = function() { window._overdueRemReady = true; _checkOverdueReady(); };

// ═══════════════════════════════════════════════════════
//  OVERDUE BROWSER PUSH — fires once on login if overdue items exist
// ═══════════════════════════════════════════════════════
window._overduePushSent = false;

function sendOverdueBrowserPush() {
    if(!NS.pushOK || window._overduePushSent) return;
    window._overduePushSent = true;

    const now        = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const overdueTaskCount = allTasks.filter(t => {
        if(t.status === 'Done' || t.status === 'Finished') return false;
        const d = t.dueDate ? new Date(t.dueDate) : (t.timestamp ? new Date(t.timestamp) : null);
        return d && d < todayStart;
    }).length;

    const overdueRemCount = allReminders.filter(r => {
        if(r.status === 'Closed') return false;
        if(!r.time || r.time === 'Manual' || r.time === 'जल्द') return false;
        const d = new Date(r.time);
        return !isNaN(d) && d < now;
    }).length;

    if(overdueTaskCount === 0 && overdueRemCount === 0) return;

    const parts = [];
    if(overdueTaskCount > 0) parts.push(overdueTaskCount + ' task' + (overdueTaskCount > 1 ? 's' : '') + ' overdue');
    if(overdueRemCount  > 0) parts.push(overdueRemCount  + ' reminder' + (overdueRemCount  > 1 ? 's' : '') + ' overdue');
    browserPush('task', '🔴 Overdue Alert — ' + parts.join(' + '), 'Abhi complete karein!');
}

// ═══════════════════════════════════════════════════════
//  DAILY SUMMARY — 3x per day: 9am, 1pm, 6pm
// ═══════════════════════════════════════════════════════
const _DAILY_SLOTS = [
    { hour: 9,  minute: 0, key: 'morning',   label: 'Subah Reminder' },
    { hour: 13, minute: 0, key: 'afternoon', label: 'Dopahar Reminder' },
    { hour: 18, minute: 0, key: 'evening',   label: 'Sham Reminder' }
];

let _summaryScheduled = false;

function scheduleDailySummaryNotifs() {
    if(!NS.pushOK || _summaryScheduled) return;
    _summaryScheduled = true;

    const now     = new Date();
    const dateStr = now.toDateString();
    const sentSlots = JSON.parse(localStorage.getItem('casedesk_summary_' + dateStr) || '[]');

    _DAILY_SLOTS.forEach(slot => {
        if(sentSlots.includes(slot.key)) return;
        const fireAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), slot.hour, slot.minute, 0);
        const msLeft = fireAt - now;
        if(msLeft > 0) {
            setTimeout(() => _sendDailySummary(slot.key, slot.label), msLeft);
        }
    });
}

function _sendDailySummary(slotKey, label) {
    const dateStr   = new Date().toDateString();
    const storageKey = 'casedesk_summary_' + dateStr;
    const sentSlots  = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if(sentSlots.includes(slotKey)) return; // guard against duplicate timeouts

    const pendingCount = allTasks.filter(t => !t.deleted && t.status !== 'Done' && t.status !== 'Finished').length;
    const remCount     = allReminders.filter(r => r.status !== 'Closed' && r.status !== 'Done').length;

    // Mark sent regardless so it doesn't re-fire
    sentSlots.push(slotKey);
    localStorage.setItem(storageKey, JSON.stringify(sentSlots));

    if(!NS.pushOK || (pendingCount === 0 && remCount === 0)) return;

    const parts = [];
    if(pendingCount > 0) parts.push(pendingCount + ' task' + (pendingCount > 1 ? 's' : '') + ' pending');
    if(remCount     > 0) parts.push(remCount     + ' reminder' + (remCount     > 1 ? 's' : '') + ' active');
    browserPush('task', '📋 ' + label + ' — CaseDesk AI', parts.join(' aur ') + ' hain, inhe finish karein! 💪');
}

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
                <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
                    <button onclick="editUserPin('${u.id}','${u.pin||''}','${u.name||''}','${u.email}')" style="padding:7px 12px;background:#eef2ff;border:none;border-radius:10px;color:#6366f1;font-size:11px;font-weight:700;cursor:pointer;" title="PIN Change Karein">✏️ PIN</button>
                    ${!isAdminUser ? `<button onclick="resetUserPassword('${u.email}','${u.name||u.email}','${u.id}')" style="padding:7px 12px;background:#fff7ed;border:none;border-radius:10px;color:#ea580c;font-size:11px;font-weight:700;cursor:pointer;" title="Password Reset Email Bhejo">📧 Reset Pwd</button>` : ''}
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

// ── ADMIN: Password Reset ──────────────────────────────────────
window.resetUserPassword = async function(email, userName, docId) {
    if (!confirm(`"${userName}" (${email}) ko password reset email bhejna chahte hain?\n\nUser ko email mein link milega jisse woh naya password set kar sake.`)) return;
    try {
        await sendPasswordResetEmail(auth, email);
        // Flag set karo ki login ke baad new password banana hoga
        const { updateDoc, doc: docRef2 } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        await updateDoc(docRef2(db, "allowed_users", docId), { mustChangePassword: true });
        showAdminMsg(`✅ "${userName}" ko password reset email bhej di! Unhe email check karne ko bolein.`, '#f0fdf4', '#15803d');
    } catch(err) {
        const errMap = {
            'auth/user-not-found': `"${userName}" ne abhi tak email se account nahi banaya hai. Pehle unhe "Create Account" se account banana hoga.`,
            'auth/invalid-email':  'Email format sahi nahi hai.',
        };
        showAdminMsg('❌ ' + (errMap[err.code] || err.message), '#fef2f2', '#991b1b');
    }
};

// ── Force Change Password Screen ──────────────────────────────
function showForceChangePasswordScreen(user, firestoreDocId) {
    ui.login.classList.remove('hidden');
    ui.login.classList.add('flex');
    const rightPanel = document.querySelector('#login-screen > div:last-child');
    if (!rightPanel) return;
    rightPanel.innerHTML = `
        <div class="absolute inset-0 opacity-[0.03]" style="background-image:radial-gradient(#6366f1 1px,transparent 1px);background-size:24px 24px;"></div>
        <div class="w-full max-w-sm relative z-10 text-center">
            <div class="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center text-3xl" style="background:rgba(99,102,241,0.1);border:2px solid rgba(99,102,241,0.3);">🔑</div>
            <div class="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1 mb-4">
                <span class="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></span>
                <span class="text-[11px] font-bold text-indigo-600 tracking-wide uppercase">Naya Password Zaroori</span>
            </div>
            <h3 class="text-2xl font-black text-slate-900 mb-2">Password Reset Karein</h3>
            <p class="text-slate-500 text-sm mb-6">Admin ne aapka password reset kiya hai.<br/>Aage badhne ke liye naya password set karein.</p>
            <div class="text-left space-y-3 mb-4">
                <div class="relative">
                    <input id="fcp-new-password" type="password" placeholder="Naya password (min 6 characters)" class="w-full px-4 py-3 rounded-xl text-sm font-medium text-slate-800 outline-none pr-11" style="background:white;border:1.5px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.04);" onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'"/>
                    <button type="button" onclick="window.togglePwdVisibility('fcp-new-password',this)" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" tabindex="-1">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    </button>
                </div>
                <div class="relative">
                    <input id="fcp-confirm-password" type="password" placeholder="Password confirm karein" class="w-full px-4 py-3 rounded-xl text-sm font-medium text-slate-800 outline-none pr-11" style="background:white;border:1.5px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.04);" onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#e2e8f0'"/>
                    <button type="button" onclick="window.togglePwdVisibility('fcp-confirm-password',this)" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" tabindex="-1">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    </button>
                </div>
                <div id="fcp-error" class="hidden bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 font-semibold"></div>
            </div>
            <button id="fcp-submit-btn" onclick="window.submitForceChangePassword('${firestoreDocId}')" class="w-full py-3.5 rounded-xl text-sm font-bold text-white transition-all" style="background:linear-gradient(135deg,#6366f1,#3b82f6);box-shadow:0 4px 15px rgba(99,102,241,0.35);">
                Naya Password Set Karein →
            </button>
            <div class="mt-4 text-xs text-slate-400">
                Logged in as: <span class="font-semibold text-slate-600">${user.email}</span>
            </div>
        </div>`;
}

window.submitForceChangePassword = async function(firestoreDocId) {
    const newPwd  = document.getElementById('fcp-new-password')?.value || '';
    const confPwd = document.getElementById('fcp-confirm-password')?.value || '';
    const errEl   = document.getElementById('fcp-error');
    const btn     = document.getElementById('fcp-submit-btn');

    const showErr = (msg) => { if(errEl){ errEl.textContent = msg; errEl.classList.remove('hidden'); } };

    if (newPwd.length < 6) { showErr('Password kam se kam 6 characters ka hona chahiye.'); return; }
    if (newPwd !== confPwd) { showErr('Dono passwords match nahi kar rahe.'); return; }

    btn.textContent = 'Saving...';
    btn.disabled = true;
    try {
        await updatePassword(auth.currentUser, newPwd);
        const { updateDoc, doc: docRef3 } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        await updateDoc(docRef3(db, "allowed_users", firestoreDocId), { mustChangePassword: false });
        // Re-trigger auth flow — PIN screen dikhega ab
        isPinVerified = false;
        location.reload();  // Page reload se fresh auth check hoga → PIN screen dikhega
    } catch(err) {
        btn.textContent = 'Naya Password Set Karein →';
        btn.disabled = false;
        showErr('Error: ' + (err.message || 'Dobara try karein.'));
    }
};


// ═══════════════════════════════════════════════════════════════
//  PASSWORD VAULT v2 — User-set PIN, daily login verify, AES-256
// ═══════════════════════════════════════════════════════════════
//
//  FLOW:
//  New day  → Panel: Login PIN → Panel: Vault PIN (or Setup if first time)
//  Same day → Panel: Vault PIN only (session keeps loginDone=true)
//  Reset    → Panel: Login PIN → Panel: Setup new Vault PIN
//
// ───────────────────────────────────────────────────────────────

// In-memory vault state
let _vKey          = null;   // CryptoKey (null = locked)
let _vEntries      = [];     // Decrypted entries
let _vEditId       = null;   // docId being edited
let _vSearch       = '';
let _vPinHash      = null;   // SHA-256 hex of current vault PIN (for verify)
let _vConfigDocId  = null;   // Firestore docId of the vault_config entry
let _vResetMode    = false;  // true = going through reset flow

// ── AES-256-GCM helpers ────────────────────────────────────────
async function _vDeriveKey(pin) {
    const enc  = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(currentUserEmail + '_vault_v2'), iterations: 120000, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function _vHashPin(pin) {
    const data = new TextEncoder().encode(pin + '|' + currentUserEmail + '|vault_verify_v2');
    const buf  = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _vEncrypt(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _vKey, new TextEncoder().encode(text));
    return btoa(String.fromCharCode(...iv)) + ':' + btoa(String.fromCharCode(...new Uint8Array(ct)));
}

async function _vDecrypt(enc) {
    if (!_vKey || !enc) return null;
    try {
        const [ivB64, ctB64] = enc.split(':');
        const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
        const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
        return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, _vKey, ct));
    } catch { return null; }
}

// ── State helper ───────────────────────────────────────────────
function _vShowPanel(name) {
    // name: 'login' | 'vaultpin' | 'setup'
    ['login', 'vaultpin', 'setup'].forEach(p => {
        document.getElementById('vault-panel-' + p)?.classList.toggle('hidden', p !== name);
    });
    document.getElementById('vault-lock-screen')?.classList.remove('hidden');
    const vcEl = document.getElementById('vault-content');
    if (vcEl) { vcEl.classList.add('hidden'); vcEl.classList.remove('flex'); }

    const labels = {
        login:    '🔑 Step 1 — Login PIN verify karein',
        vaultpin: '🔐 Vault PIN darj karein',
        setup:    '🆕 Naya Vault PIN set karein'
    };
    document.getElementById('vault-step-label').textContent = labels[name] || '';

    // Clear all PIN boxes & errors
    document.querySelectorAll('.vp-login-box,.vp-vault-box,.vp-new-box,.vp-confirm-box').forEach(b => { b.value = ''; });
    ['vault-login-error','vault-vaultpin-error','vault-setup-error'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
    });
    ['vault-login-verify-btn','vault-vaultpin-unlock-btn','vault-setup-save-btn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });

    // Focus first box
    const firstBox = { login: '.vp-login-box', vaultpin: '.vp-vault-box', setup: '.vp-new-box' };
    setTimeout(() => document.querySelector(firstBox[name])?.focus(), 150);
}

function _vShowContent() {
    document.getElementById('vault-lock-screen')?.classList.add('hidden');
    const vc = document.getElementById('vault-content');
    if (vc) { vc.classList.remove('hidden'); vc.classList.add('flex'); }
    // Mark session — preserve loginDone from current session
    const today = new Date().toISOString().slice(0, 10);
    const existingSess = (() => { try { return JSON.parse(sessionStorage.getItem('_vaultSess2')||'{}'); } catch{return{};} })();
    sessionStorage.setItem('_vaultSess2', JSON.stringify({ ...existingSess, date: today, uid: currentUserEmail, loginDone: true }));
    _vRender();
}

// ── Init (called on first tab click) ──────────────────────────
window.initVault = async function () {
    _vResetMode = false;
    _vPinHash = null;
    _vConfigDocId = null;
    try {
        // Load vault config stored as a special doc inside vault_entries collection
        const cfgQ = query(
            collection(db, 'vault_entries'),
            where('userId', '==', currentUserEmail),
            where('_type', '==', 'vault_config')
        );
        const cfgSnap = await getDocs(cfgQ);
        if (!cfgSnap.empty) {
            const cfgDoc = cfgSnap.docs[0];
            _vConfigDocId = cfgDoc.id;
            _vPinHash = cfgDoc.data().vaultPinHash || null;
        }
    } catch (e) { _vPinHash = null; }

    // Check session (already did login PIN today?)
    const ss = sessionStorage.getItem('_vaultSess2');
    const today = new Date().toISOString().slice(0, 10);
    let sessionValid = false;
    if (ss) {
        try {
            const p = JSON.parse(ss);
            sessionValid = (p.date === today && p.uid === currentUserEmail && p.loginDone);
        } catch { /* ignore */ }
    }

    if (sessionValid && _vPinHash) {
        // Same day, login already done → just Vault PIN
        _vShowPanel('vaultpin');
    } else if (_vPinHash) {
        // New day or first visit → Login PIN first
        _vShowPanel('login');
    } else {
        // No vault configured at all → Login PIN → Setup
        document.getElementById('vault-setup-banner-title').textContent = '🆕 STEP 2 — Pehla Vault PIN Banayein';
        _vShowPanel('login');
    }
};

// Called on subsequent tab visits
window._vaultCheckLock = function () {
    if (!_vKey) {
        _vResetMode = false;
        window.initVault();
    }
};

// ── Load & render entries ──────────────────────────────────────
async function _vLoadEntries() {
    _vEntries = [];
    if (!_vKey) return;
    try {
        const snap = await getDocs(query(collection(db, 'vault_entries'), where('userId', '==', currentUserEmail)));
        const jobs = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.deleted || data._type === 'vault_config') return;
            jobs.push((async () => {
                const pw = await _vDecrypt(data.encryptedPassword || '');
                return { _docId: d.id, title: data.title||'', username: data.username||'', password: pw||'', url: data.url||'', notes: data.notes||'', timestamp: data.timestamp||'' };
            })());
        });
        _vEntries = (await Promise.all(jobs)).sort((a,b) => (a.title||'').localeCompare(b.title||''));
        const el = document.getElementById('vault-entry-count');
        if (el) el.textContent = _vEntries.length;
    } catch (e) { console.error('[Vault] Load error:', e); }
}

function _vRender() {
    const list  = document.getElementById('vault-list');
    const empty = document.getElementById('vault-empty');
    if (!list) return;
    list.innerHTML = '';

    const q = _vSearch.toLowerCase();
    const filtered = q ? _vEntries.filter(e => (e.title+e.username+e.url).toLowerCase().includes(q)) : _vEntries;

    if (filtered.length === 0) { empty?.classList.remove('hidden'); return; }
    empty?.classList.add('hidden');

    filtered.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all p-4';

        let faviconHtml = '<span style="font-size:20px;">🔑</span>';
        if (entry.url) {
            try {
                const domain = new URL(entry.url.startsWith('http') ? entry.url : 'https://' + entry.url).hostname;
                faviconHtml = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" width="28" height="28" class="rounded" onerror="this.outerHTML='<span style=\\'font-size:20px;\\'>🔑</span>'" />`;
            } catch { /* keep default */ }
        }

        div.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center bg-indigo-50">${faviconHtml}</div>
                <div class="flex-1 min-w-0">
                    <p class="font-black text-slate-800 text-base truncate">${_vEsc(entry.title)}</p>
                    <p class="text-xs text-slate-400 truncate">${entry.username ? '👤 ' + _vEsc(entry.username) : ''}</p>
                </div>
                <div class="flex gap-1.5 flex-shrink-0">
                    <button class="vpc-copy w-8 h-8 rounded-xl bg-slate-50 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 flex items-center justify-center text-sm transition-all" title="Copy">📋</button>
                    <button class="vpc-edit w-8 h-8 rounded-xl bg-slate-50 hover:bg-blue-50  text-slate-500 hover:text-blue-600  flex items-center justify-center text-sm transition-all" title="Edit">✏️</button>
                    <button class="vpc-del  w-8 h-8 rounded-xl bg-slate-50 hover:bg-red-50   text-slate-500 hover:text-red-500   flex items-center justify-center text-sm transition-all" title="Delete">🗑️</button>
                </div>
            </div>
            <div class="mt-3 flex items-center gap-2">
                <div class="flex-1 bg-slate-50 rounded-xl px-3 py-2 flex items-center gap-2 min-w-0">
                    <span class="vpc-pw font-mono text-sm text-slate-600 flex-1 truncate tracking-widest select-none" data-shown="0">••••••••</span>
                    <button class="vpc-eye text-sm text-slate-400 hover:text-slate-600 flex-shrink-0">👁️</button>
                </div>
                ${entry.url ? `<a href="${_vEsc(entry.url.startsWith('http') ? entry.url : 'https://'+entry.url)}" target="_blank" rel="noopener" class="w-8 h-8 rounded-xl bg-slate-50 hover:bg-green-50 text-slate-400 hover:text-green-600 flex items-center justify-center text-sm flex-shrink-0 transition-all">🔗</a>` : ''}
            </div>
            ${entry.notes ? `<p class="mt-2 text-xs text-slate-400 pl-1 leading-relaxed">${_vEsc(entry.notes)}</p>` : ''}`;

        div.querySelector('.vpc-copy').onclick = () => {
            navigator.clipboard.writeText(entry.password || '').then(() => {
                if (window.showToast) showToast('reminder', '📋 Password copied!', entry.title);
            });
        };
        div.querySelector('.vpc-eye').addEventListener('click', function () {
            const pwEl = div.querySelector('.vpc-pw');
            const shown = pwEl.dataset.shown === '1';
            pwEl.textContent = shown ? '••••••••' : (entry.password || '(empty)');
            pwEl.dataset.shown = shown ? '0' : '1';
            this.textContent = shown ? '👁️' : '🙈';
        });
        div.querySelector('.vpc-edit').onclick = () => _vOpenModal(entry);
        div.querySelector('.vpc-del').onclick = async () => {
            if (!confirm(`"${entry.title}" delete karna chahte hain?`)) return;
            try {
                await updateDoc(doc(db, 'vault_entries', entry._docId), { deleted: true });
                _vEntries = _vEntries.filter(e => e._docId !== entry._docId);
                const el = document.getElementById('vault-entry-count');
                if (el) el.textContent = _vEntries.length;
                _vRender();
            } catch (e) { console.error('[Vault] Delete error:', e); }
        };
        list.appendChild(div);
    });
}

function _vEsc(s) { const d = document.createElement('div'); d.textContent = s||''; return d.innerHTML; }

// ── Add/Edit modal ─────────────────────────────────────────────
function _vOpenModal(entry = null) {
    _vEditId = entry?._docId || null;
    document.getElementById('vault-modal-title').textContent = entry ? 'Edit Password' : 'Add Password';
    document.getElementById('vault-field-title').value    = entry?.title    || '';
    document.getElementById('vault-field-username').value = entry?.username || '';
    document.getElementById('vault-field-password').value = entry?.password || '';
    document.getElementById('vault-field-url').value      = entry?.url      || '';
    document.getElementById('vault-field-notes').value    = entry?.notes    || '';
    document.getElementById('vault-field-password').type  = 'password';
    document.getElementById('vault-toggle-pw').textContent = '👁️';
    document.getElementById('vault-entry-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('vault-field-title').focus(), 100);
}

function _vCloseModal() {
    document.getElementById('vault-entry-modal').classList.add('hidden');
    _vEditId = null;
}

async function _vSaveEntry() {
    const title    = document.getElementById('vault-field-title').value.trim();
    const username = document.getElementById('vault-field-username').value.trim();
    const password = document.getElementById('vault-field-password').value;
    const url      = document.getElementById('vault-field-url').value.trim();
    const notes    = document.getElementById('vault-field-notes').value.trim();
    if (!title)    { alert('Website/App name zaroori hai!'); return; }
    if (!password) { alert('Password zaroori hai!'); return; }
    if (!_vKey)    { alert('Vault locked — page refresh karein.'); return; }

    const btn = document.getElementById('vault-save-entry-btn');
    btn.disabled = true; btn.textContent = '⏳ Saving...';
    try {
        const encryptedPassword = await _vEncrypt(password);
        const now = new Date().toISOString();
        const data = { userId: currentUserEmail, title, username, encryptedPassword, url, notes, timestamp: now, deleted: false };
        if (_vEditId) {
            await updateDoc(doc(db, 'vault_entries', _vEditId), data);
            const idx = _vEntries.findIndex(e => e._docId === _vEditId);
            if (idx >= 0) _vEntries[idx] = { ..._vEntries[idx], title, username, password, url, notes };
        } else {
            const ref = await addDoc(collection(db, 'vault_entries'), data);
            _vEntries.push({ _docId: ref.id, title, username, password, url, notes, timestamp: now });
            _vEntries.sort((a,b) => (a.title||'').localeCompare(b.title||''));
        }
        const el = document.getElementById('vault-entry-count');
        if (el) el.textContent = _vEntries.length;
        _vCloseModal();
        _vRender();
    } catch (e) {
        console.error('[Vault] Save error:', e);
        alert('Save nahi hua. Try again!');
    } finally {
        btn.disabled = false; btn.textContent = '💾 Save';
    }
}

// ── PIN box helper — bind input/keydown for a given class ──────
function _vBindPinBoxes(cls, onComplete) {
    // Called once at startup; uses event delegation on document
    // (already handled below in _vBindUI)
}

// ── Shake + clear helper ────────────────────────────────────────
function _vShakeError(boxCls, errId) {
    document.querySelectorAll(boxCls).forEach(b => {
        b.classList.add('border-red-500','bg-red-900/20');
        setTimeout(() => b.classList.remove('border-red-500','bg-red-900/20'), 700);
    });
    document.getElementById(errId)?.classList.remove('hidden');
    setTimeout(() => {
        document.querySelectorAll(boxCls).forEach(b => { b.value = ''; });
        document.getElementById(errId)?.classList.add('hidden');
        const btn = { '.vp-login-box':'vault-login-verify-btn', '.vp-vault-box':'vault-vaultpin-unlock-btn' }[boxCls];
        if (btn) document.getElementById(btn).disabled = true;
        document.querySelector(boxCls)?.focus();
    }, 1300);
}

// ── Event listeners ────────────────────────────────────────────
(function _vBindUI() {

    // Generic PIN box input/keydown (event delegation)
    const PIN_CLASSES = ['.vp-login-box','.vp-vault-box','.vp-new-box','.vp-confirm-box'];
    const BTN_MAP = { 'vp-login-box':'vault-login-verify-btn', 'vp-vault-box':'vault-vaultpin-unlock-btn', 'vp-new-box':null, 'vp-confirm-box':'vault-setup-save-btn' };

    document.addEventListener('input', e => {
        const cls = PIN_CLASSES.find(c => e.target.classList.contains(c.slice(1)));
        if (!cls) return;
        const boxes = [...document.querySelectorAll(cls)];
        const idx   = boxes.indexOf(e.target);
        const val   = e.target.value.replace(/\D/g,'');
        e.target.value = val.slice(0,1);
        if (val && idx < boxes.length - 1) boxes[idx+1].focus();

        // Enable/disable button
        const filled = boxes.map(b=>b.value).join('');
        const btnId  = BTN_MAP[cls.slice(1)];
        if (btnId) document.getElementById(btnId).disabled = filled.length < 4;

        // Setup: enable save only when BOTH new+confirm have 4 digits
        if (cls === '.vp-new-box' || cls === '.vp-confirm-box') {
            const newPin  = [...document.querySelectorAll('.vp-new-box')].map(b=>b.value).join('');
            const confPin = [...document.querySelectorAll('.vp-confirm-box')].map(b=>b.value).join('');
            document.getElementById('vault-setup-save-btn').disabled = (newPin.length < 4 || confPin.length < 4);
        }
    }, true);

    document.addEventListener('keydown', e => {
        const cls = PIN_CLASSES.find(c => e.target.classList.contains(c.slice(1)));
        if (!cls) return;
        const boxes = [...document.querySelectorAll(cls)];
        const idx   = boxes.indexOf(e.target);
        if (e.key === 'Backspace' && !e.target.value && idx > 0) boxes[idx-1].focus();
        if (e.key === 'Enter') {
            const btnId = BTN_MAP[cls.slice(1)];
            if (btnId) document.getElementById(btnId)?.click();
        }
    });

    document.addEventListener('paste', e => {
        const cls = PIN_CLASSES.find(c => e.target.classList.contains(c.slice(1)));
        if (!cls) return;
        const paste = (e.clipboardData||window.clipboardData).getData('text').replace(/\D/g,'');
        if (paste.length >= 4) {
            const boxes = [...document.querySelectorAll(cls)];
            boxes.forEach((b,i) => { b.value = paste[i]||''; });
            const btnId = BTN_MAP[cls.slice(1)];
            if (btnId) document.getElementById(btnId).disabled = false;
            e.preventDefault();
        }
    });

    // ── PANEL 1: Login PIN verify ──
    document.getElementById('vault-login-verify-btn')?.addEventListener('click', async () => {
        const entered = [...document.querySelectorAll('.vp-login-box')].map(b=>b.value).join('');
        if (entered !== currentUserPin) {
            _vShakeError('.vp-login-box', 'vault-login-error');
            return;
        }
        // Login PIN correct — mark session loginDone
        const today = new Date().toISOString().slice(0,10);
        const existing = (() => { try { return JSON.parse(sessionStorage.getItem('_vaultSess2')||'{}'); } catch{return{};} })();
        sessionStorage.setItem('_vaultSess2', JSON.stringify({ ...existing, date: today, uid: currentUserEmail, loginDone: true }));

        if (_vPinHash) {
            // Vault already setup → go to vault PIN entry
            _vShowPanel('vaultpin');
        } else {
            // First time or reset — go to setup
            _vShowPanel('setup');
        }
    });

    // ── PANEL 2: Vault PIN unlock ──
    document.getElementById('vault-vaultpin-unlock-btn')?.addEventListener('click', async () => {
        const entered = [...document.querySelectorAll('.vp-vault-box')].map(b=>b.value).join('');
        const enteredHash = await _vHashPin(entered);
        if (enteredHash !== _vPinHash) {
            _vShakeError('.vp-vault-box', 'vault-vaultpin-error');
            return;
        }
        const btn = document.getElementById('vault-vaultpin-unlock-btn');
        btn.textContent = '⏳ Opening...'; btn.disabled = true;
        try {
            _vKey = await _vDeriveKey(entered);
            await _vLoadEntries();
            _vShowContent();
        } catch (e) {
            console.error('[Vault] Unlock error:', e);
            btn.textContent = '🔓 Vault Kholein'; btn.disabled = false;
        }
    });

    // ── Reset trigger button ──
    document.getElementById('vault-reset-trigger-btn')?.addEventListener('click', () => {
        _vResetMode = true;
        document.getElementById('vault-setup-banner-title').textContent = '🔄 STEP 2 — Naya Vault PIN Set Karein';
        _vShowPanel('login');
    });

    // ── PANEL 3: Setup / create new vault PIN ──
    document.getElementById('vault-setup-save-btn')?.addEventListener('click', async () => {
        const newPin  = [...document.querySelectorAll('.vp-new-box')].map(b=>b.value).join('');
        const confPin = [...document.querySelectorAll('.vp-confirm-box')].map(b=>b.value).join('');
        if (newPin !== confPin) {
            document.getElementById('vault-setup-error')?.classList.remove('hidden');
            document.querySelectorAll('.vp-confirm-box').forEach(b => { b.value=''; b.classList.add('border-red-500'); setTimeout(()=>b.classList.remove('border-red-500'),700); });
            setTimeout(() => document.getElementById('vault-setup-error')?.classList.add('hidden'), 2000);
            return;
        }
        const btn = document.getElementById('vault-setup-save-btn');
        btn.textContent = '⏳ Setting...'; btn.disabled = true;

        try {
            const hash   = await _vHashPin(newPin);
            const newKey = await _vDeriveKey(newPin);

            // If resetting, re-encrypt all existing entries
            if (_vResetMode && _vKey) {
                const snap = await getDocs(query(collection(db, 'vault_entries'), where('userId','==', currentUserEmail)));
                const jobs = [];
                snap.forEach(d => {
                    if (d.data().deleted || d.data()._type === 'vault_config') return;
                    jobs.push((async () => {
                        // decrypt with old key, re-encrypt with new key
                        const old = await _vDecrypt(d.data().encryptedPassword || '');
                        if (old !== null) {
                            const newEnc = await (async () => {
                                const iv = crypto.getRandomValues(new Uint8Array(12));
                                const ct = await crypto.subtle.encrypt({name:'AES-GCM',iv}, newKey, new TextEncoder().encode(old));
                                return btoa(String.fromCharCode(...iv))+':'+btoa(String.fromCharCode(...new Uint8Array(ct)));
                            })();
                            await updateDoc(doc(db,'vault_entries',d.id), { encryptedPassword: newEnc });
                        }
                    })());
                });
                await Promise.all(jobs);
            }

            // Save new hash & key to vault_entries collection (as a special config doc)
            _vPinHash = hash;
            _vKey = newKey;
            const cfgData = { userId: currentUserEmail, _type: 'vault_config', vaultPinHash: hash, updatedAt: new Date().toISOString(), deleted: false };
            if (_vConfigDocId) {
                await updateDoc(doc(db, 'vault_entries', _vConfigDocId), cfgData);
            } else {
                const cfgRef = await addDoc(collection(db, 'vault_entries'), cfgData);
                _vConfigDocId = cfgRef.id;
            }

            _vResetMode = false;
            await _vLoadEntries();
            _vShowContent();
        } catch (e) {
            console.error('[Vault] Setup error:', e);
            alert('PIN save nahi hua. Try again!');
            btn.textContent = '✅ PIN Set Karein & Vault Kholein'; btn.disabled = false;
        }
    });

    // ── Lock button ──
    document.getElementById('vault-lock-btn')?.addEventListener('click', () => {
        _vKey = null; _vEntries = [];
        sessionStorage.removeItem('_vaultSess2');
        _vResetMode = false;
        window.initVault();
    });

    // ── Add button ──
    document.getElementById('vault-add-btn')?.addEventListener('click', () => _vOpenModal());

    // ── Modal ──
    document.getElementById('vault-modal-close')?.addEventListener('click', _vCloseModal);
    document.getElementById('vault-cancel-btn')?.addEventListener('click', _vCloseModal);
    document.getElementById('vault-save-entry-btn')?.addEventListener('click', _vSaveEntry);
    document.getElementById('vault-toggle-pw')?.addEventListener('click', () => {
        const inp = document.getElementById('vault-field-password');
        const tog = document.getElementById('vault-toggle-pw');
        inp.type = inp.type === 'password' ? 'text' : 'password';
        tog.textContent = inp.type === 'password' ? '👁️' : '🙈';
    });
    document.getElementById('vault-entry-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('vault-entry-modal')) _vCloseModal();
    });

    // ── Search ──
    document.getElementById('vault-search')?.addEventListener('input', e => {
        _vSearch = e.target.value.toLowerCase();
        _vRender();
    });
})();
