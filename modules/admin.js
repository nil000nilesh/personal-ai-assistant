// modules/admin.js — Admin panel: user management, PIN editing, password reset
import { APP, ADMIN_EMAIL, ui } from './state.js';
import { auth, db } from './firebase.js';
import { sendPasswordResetEmail, updatePassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, getDocs, addDoc, updateDoc, deleteDoc, setDoc, doc, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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



export function init() { setupAdminPanel(); }
