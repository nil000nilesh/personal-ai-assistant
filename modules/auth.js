// modules/auth.js — Authentication: Google/email login, PIN screen, onAuthStateChanged
import { APP, ADMIN_EMAIL, ui } from './state.js';
import { auth, db, provider } from './firebase.js';
import { signInWithPopup, signInWithCredential, GoogleAuthProvider,
         signOut, onAuthStateChanged, createUserWithEmailAndPassword,
         signInWithEmailAndPassword, updateProfile,
         updatePassword, sendPasswordResetEmail as _sendResetEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, getDocs, addDoc, query, where, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// loadAppListeners and setupAdminPanel are defined in app.js, called via window
const loadAppListeners  = () => window._loadAppListeners?.();
const setupAdminPanel   = () => window._setupAdminPanel?.();
const switchView        = (v) => window._switchView?.(v);

export function hideAllStates() {
    ui.login.classList.add('hidden'); ui.login.classList.remove('flex');
    ui.pin.classList.add('hidden'); ui.pin.classList.remove('flex');
    ui.appLayout.classList.add('hidden'); ui.appLayout.classList.remove('flex');
}


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

window.sendForgotPassword = async function() {
    const email = document.getElementById('email-si-email').value.trim();
    if (!email) { showEmailAuthError('Pehle apna email address daalein.'); return; }
    try {
        await _sendResetEmail(auth, email);
        showEmailAuthSuccess('Password reset link bhej diya! Apna email check karein aur link se naya password set karein.');
    } catch (err) {
        const errMap = {
            'auth/user-not-found':  'Yeh email registered nahi hai.',
            'auth/invalid-email':   'Email format sahi nahi hai.',
            'auth/too-many-requests': 'Bahut zyada attempts. Thoda wait karein.'
        };
        showEmailAuthError(errMap[err.code] || 'Reset email nahi bheja ja saka: ' + err.message);
    }
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
            APP.currentUserRole = "admin";
            APP.currentUserEmail = user.email;
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
                    APP.currentUserPin = "5786";
                } else {
                    APP.currentUserPin = snap.docs[0].data().pin || "5786";
                }
            } catch(e) {
                APP.currentUserPin = "5786"; // fallback
            }
            if (!APP.isPinVerified) {
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

                APP.currentUserPin = userData.pin;
                APP.currentUserRole = "user";
                APP.currentUserEmail = user.email;

                // Password reset ke baad force change check
                if (userData.mustChangePassword === true) {
                    hideAllStates();
                    showForceChangePasswordScreen(user, snap.docs[0].id);
                    return;
                }

                if (!APP.isPinVerified) {
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
        APP.isPinVerified = false;
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
            getDocs(query(collection(db, "tasks"),     where("userId", "==", APP.currentUserEmail))),
            getDocs(query(collection(db, "reminders"), where("userId", "==", APP.currentUserEmail)))
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
    APP.isPinVerified = false;
    APP.DYNAMIC_OPENAI_KEY = "";
    APP.currentUserPin = "";
    APP.currentUserRole = "user";
    APP.currentUserEmail = "";
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
    if (enteredPin === APP.currentUserPin) {
        APP.isPinVerified = true;
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
            APP.DYNAMIC_OPENAI_KEY = keyDoc.data().openai_key;
            if (keyDoc.data().openai_model) APP.OPENAI_MODEL = keyDoc.data().openai_model;
            APP.sessionStartTime = new Date().toISOString(); 
            
            ui.appLayout.classList.remove('hidden'); 
            ui.appLayout.classList.add('flex');

            // Show admin button only for admin role
            if (APP.currentUserRole === 'admin') {
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
