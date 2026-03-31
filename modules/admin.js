// modules/admin.js — Admin panel: user management, PIN editing, password reset, trial management
import { APP, ADMIN_EMAIL, ui } from './state.js';
import { auth, db } from './firebase.js';
import { sendPasswordResetEmail, updatePassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, getDocs, addDoc, updateDoc, deleteDoc, setDoc, doc, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ═══════════════════════════════════════════════════════
//  ADMIN PANEL — User Management + Trial Management
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
        loadTrialUsers();
        checkNewSignupNotifications();
    });
    adminCloseBtn.addEventListener('click', () => {
        adminScreen.classList.add('hidden');
    });
    refreshBtn?.addEventListener('click', () => { loadAdminUsers(); loadTrialUsers(); });
    addUserBtn?.addEventListener('click', handleAddUser);

    // Auto-check for new signup notifications when admin logs in
    if (APP.currentUserRole === 'admin') {
        setTimeout(checkNewSignupNotifications, 2000);
    }
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
            const accessUntilStr = u.accessUntil ? new Date(u.accessUntil).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '';
            const isExpired = u.accessUntil && new Date(u.accessUntil) < new Date();
            const statusLabel = u.status === 'inactive' || isExpired ? 'Inactive' : 'Active';

            const card = document.createElement('div');
            card.style.cssText = 'display:flex;align-items:center;gap:14px;padding:14px;border:1.5px solid #f1f5f9;border-radius:16px;transition:all .2s;background:#fafafa;';
            card.onmouseenter = () => card.style.borderColor = '#e0e7ff';
            card.onmouseleave = () => card.style.borderColor = '#f1f5f9';

            const roleChip = isAdminUser
                ? `<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#8b5cf622;color:#8b5cf6;">⚙️ Admin (You)</span>`
                : `<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#3b82f622;color:#3b82f6;">👤 User</span>`;

            const statusChip = !isAdminUser ? (statusLabel === 'Active'
                ? `<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#dcfce7;color:#16a34a;">Active</span>`
                : `<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#fef2f2;color:#ef4444;">Inactive</span>`) : '';

            card.innerHTML = `
                <div style="width:42px;height:42px;border-radius:14px;background:${isAdminUser?'linear-gradient(135deg,#8b5cf622,#8b5cf644)':'linear-gradient(135deg,#3b82f622,#3b82f644)'};border:2px solid ${isAdminUser?'#8b5cf633':'#3b82f633'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${isAdminUser?'⚙️':'👤'}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:800;font-size:13px;color:#1e293b;">${u.name || 'Unknown'} ${u.loginId ? '<span style="font-size:10px;color:#64748b;font-weight:600;">(@'+u.loginId+')</span>' : ''}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.email}</div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">
                        ${roleChip}
                        ${statusChip}
                        <span style="font-size:9px;font-weight:700;color:#94a3b8;background:#f1f5f9;padding:2px 8px;border-radius:6px;">📅 ${addedDate}</span>
                        <span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#fef3c7;color:#92400e;">🔑 PIN: ${u.pin || '—'}</span>
                        ${accessUntilStr ? `<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:6px;background:${isExpired?'#fef2f2':'#eff6ff'};color:${isExpired?'#ef4444':'#3b82f6'};">Access: ${accessUntilStr}</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
                    <button onclick="editUserPin('${u.id}','${u.pin||''}','${u.name||''}','${u.email}')" style="padding:7px 12px;background:#eef2ff;border:none;border-radius:10px;color:#6366f1;font-size:11px;font-weight:700;cursor:pointer;" title="PIN Change Karein">✏️ PIN</button>
                    ${!isAdminUser ? `<button onclick="setUserAccessTime('${u.id}','${u.name||u.email}')" style="padding:7px 12px;background:#f0fdf4;border:none;border-radius:10px;color:#16a34a;font-size:11px;font-weight:700;cursor:pointer;" title="Access Time Set Karein">⏱️ Time</button>` : ''}
                    ${!isAdminUser ? `<button onclick="resetUserPassword('${u.email}','${u.name||u.email}','${u.id}')" style="padding:7px 12px;background:#fff7ed;border:none;border-radius:10px;color:#ea580c;font-size:11px;font-weight:700;cursor:pointer;" title="Password Reset Email Bhejo">📧 Reset</button>` : ''}
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

        // Generate a loginId from name if not provided
        const autoLoginId = name.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random()*100);

        await addDoc(collection(db, "allowed_users"), {
            email, name, pin, role,
            loginId: autoLoginId,
            status: 'active',
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



// ═══════════════════════════════════════════════════════
//  TRIAL USERS MANAGEMENT
// ═══════════════════════════════════════════════════════
async function loadTrialUsers() {
    const listEl = document.getElementById('admin-trial-list');
    const countEl = document.getElementById('admin-trial-count');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align:center;padding:16px;color:#94a3b8;font-size:13px;"><span style="animation:pulse 1.5s infinite;display:inline-block;">⏳ Loading...</span></div>';

    try {
        const snap = await getDocs(collection(db, "trial_users"));
        const users = [];
        snap.forEach(d => users.push({ id: d.id, ...d.data() }));
        if (countEl) countEl.textContent = users.length;

        if (users.length === 0) {
            listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:12px;">Koi trial user nahi hai.</div>';
            return;
        }

        listEl.innerHTML = '';
        const now = new Date();
        users.forEach(u => {
            const trialEnd = u.trialEnd ? new Date(u.trialEnd) : null;
            const isTrialActive = trialEnd && trialEnd > now && u.status === 'trial';
            const isApproved = u.status === 'active';
            const isInactive = u.status === 'inactive' || (trialEnd && trialEnd < now && u.status === 'trial');
            const approvedUntilStr = u.approvedUntil ? new Date(u.approvedUntil).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '';
            const trialEndStr = trialEnd ? trialEnd.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
            const remaining = trialEnd ? Math.ceil((trialEnd - now) / (1000*60*60*24)) : 0;

            let statusChip = '';
            if (isApproved) {
                statusChip = `<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#dcfce7;color:#16a34a;">Approved</span>`;
            } else if (isTrialActive) {
                statusChip = `<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#fef3c7;color:#92400e;">Trial (${remaining > 0 ? remaining+'d left' : 'Expired'})</span>`;
            } else {
                statusChip = `<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;background:#fef2f2;color:#ef4444;">Inactive</span>`;
            }

            const card = document.createElement('div');
            card.style.cssText = `display:flex;align-items:center;gap:14px;padding:14px;border:1.5px solid ${isTrialActive?'#fef3c7':isApproved?'#dcfce7':'#fef2f2'};border-radius:16px;transition:all .2s;background:#fafafa;`;

            card.innerHTML = `
                <div style="width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,${isTrialActive?'#fef3c722,#fef3c744':isApproved?'#dcfce722,#dcfce744':'#fef2f222,#fef2f244'});border:2px solid ${isTrialActive?'#f59e0b33':isApproved?'#22c55e33':'#ef444433'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${isTrialActive?'⏳':isApproved?'✅':'⏸️'}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:800;font-size:13px;color:#1e293b;">${u.name || 'Unknown'} ${u.loginId ? '<span style="font-size:10px;color:#64748b;font-weight:600;">(@'+u.loginId+')</span>' : ''}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.email}</div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;">
                        ${statusChip}
                        <span style="font-size:9px;font-weight:700;color:#94a3b8;background:#f1f5f9;padding:2px 8px;border-radius:6px;">Trial End: ${trialEndStr}</span>
                        ${approvedUntilStr ? `<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:6px;background:#eff6ff;color:#3b82f6;">Approved till: ${approvedUntilStr}</span>` : ''}
                        ${u.lastLogin ? `<span style="font-size:9px;font-weight:700;color:#94a3b8;background:#f1f5f9;padding:2px 8px;border-radius:6px;">Last: ${new Date(u.lastLogin).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
                    <button onclick="approveTrialUser('${u.id}','${u.name||u.email}')" style="padding:7px 12px;background:#dcfce7;border:none;border-radius:10px;color:#16a34a;font-size:11px;font-weight:700;cursor:pointer;" title="Approve & Time Set Karein">✅ Approve</button>
                    <button onclick="deactivateTrialUser('${u.id}','${u.name||u.email}')" style="padding:7px 12px;background:#fef2f2;border:none;border-radius:10px;color:#ef4444;font-size:11px;font-weight:700;cursor:pointer;" title="Deactivate Karein">⏸️ Deactivate</button>
                    <button onclick="deleteTrialUser('${u.id}','${u.name||u.email}')" style="padding:7px 12px;background:#fef2f2;border:none;border-radius:10px;color:#ef4444;font-size:11px;font-weight:700;cursor:pointer;" title="Delete Karein">🗑️</button>
                </div>`;
            listEl.appendChild(card);
        });
    } catch(err) {
        if (listEl) listEl.innerHTML = '<div style="color:#ef4444;padding:16px;font-size:12px;">Error loading trial users: ' + err.message + '</div>';
    }
}

// ── APPROVE TRIAL USER (with time period) ──────────────────────
window.approveTrialUser = async function(docId, userName) {
    const days = prompt(`"${userName}" ko kitne din ke liye approve karna hai?\n\nExamples:\n• 30 = 1 month\n• 90 = 3 months\n• 365 = 1 year\n\nDin enter karein:`, '30');
    if (days === null) return;
    const numDays = parseInt(days);
    if (isNaN(numDays) || numDays < 1) { alert('Valid number of days enter karein!'); return; }

    const pin = prompt(`"${userName}" ke liye 4-digit PIN set karein:`, '');
    if (pin === null) return;
    if (!/^\d{4}$/.test(pin)) { alert('PIN exactly 4 digits hona chahiye!'); return; }

    try {
        const now = new Date();
        const approvedUntil = new Date(now.getTime() + numDays * 24 * 60 * 60 * 1000);
        await updateDoc(doc(db, "trial_users", docId), {
            status: 'active',
            pin: pin,
            approvedBy: ADMIN_EMAIL,
            approvedAt: now.toISOString(),
            approvedUntil: approvedUntil.toISOString()
        });
        showAdminMsg(`✅ "${userName}" ko ${numDays} din ke liye approve kar diya! (PIN: ${pin})`, '#f0fdf4', '#15803d');
        loadTrialUsers();
    } catch(err) {
        showAdminMsg('❌ Error: ' + err.message, '#fef2f2', '#991b1b');
    }
};

// ── DEACTIVATE TRIAL USER ─────────────────────────────────────
window.deactivateTrialUser = async function(docId, userName) {
    if (!confirm(`"${userName}" ko deactivate karna chahte hain?`)) return;
    try {
        await updateDoc(doc(db, "trial_users", docId), { status: 'inactive' });
        showAdminMsg(`⏸️ "${userName}" deactivate ho gaya.`, '#fef3c7', '#92400e');
        loadTrialUsers();
    } catch(err) {
        showAdminMsg('❌ Error: ' + err.message, '#fef2f2', '#991b1b');
    }
};

// ── DELETE TRIAL USER ─────────────────────────────────────────
window.deleteTrialUser = async function(docId, userName) {
    if (!confirm(`"${userName}" ko permanently delete karna chahte hain?`)) return;
    try {
        await deleteDoc(doc(db, "trial_users", docId));
        showAdminMsg(`🗑️ "${userName}" delete ho gaya.`, '#f0fdf4', '#15803d');
        loadTrialUsers();
    } catch(err) {
        showAdminMsg('❌ Delete failed: ' + err.message, '#fef2f2', '#991b1b');
    }
};

// ── SET ACCESS TIME FOR ALLOWED USERS ─────────────────────────
window.setUserAccessTime = async function(docId, userName) {
    const days = prompt(`"${userName}" ko kitne din ke liye access dena hai?\n\n• 30 = 1 month\n• 90 = 3 months\n• 365 = 1 year\n• 0 = Unlimited\n\nDin enter karein:`, '30');
    if (days === null) return;
    const numDays = parseInt(days);
    if (isNaN(numDays) || numDays < 0) { alert('Valid number enter karein!'); return; }

    try {
        const updateData = {};
        if (numDays === 0) {
            updateData.accessUntil = null;
            updateData.status = 'active';
        } else {
            const accessUntil = new Date(new Date().getTime() + numDays * 24 * 60 * 60 * 1000);
            updateData.accessUntil = accessUntil.toISOString();
            updateData.status = 'active';
        }
        await updateDoc(doc(db, "allowed_users", docId), updateData);
        showAdminMsg(`✅ "${userName}" ka access ${numDays === 0 ? 'unlimited' : numDays + ' din'} ke liye set ho gaya!`, '#f0fdf4', '#15803d');
        loadAdminUsers();
    } catch(err) {
        showAdminMsg('❌ Error: ' + err.message, '#fef2f2', '#991b1b');
    }
};

// ═══════════════════════════════════════════════════════
//  NEW SIGNUP NOTIFICATION POPUP FOR ADMIN
// ═══════════════════════════════════════════════════════
async function checkNewSignupNotifications() {
    if (APP.currentUserRole !== 'admin') return;
    try {
        const snap = await getDocs(query(collection(db, "admin_notifications"), where("read", "==", false), where("type", "==", "new_signup")));
        if (snap.empty) return;

        const notifications = [];
        snap.forEach(d => notifications.push({ id: d.id, ...d.data() }));

        // Show popup for each unread notification
        notifications.forEach(notif => {
            showNewSignupPopup(notif);
        });
    } catch(err) {
        console.error('Notification check error:', err);
    }
}

function showNewSignupPopup(notif) {
    // Create popup overlay
    const overlay = document.createElement('div');
    overlay.id = 'signup-popup-' + notif.id;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);';

    const trialEndDate = notif.trialEnd ? new Date(notif.trialEnd).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
    const signupDate = notif.createdAt ? new Date(notif.createdAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

    overlay.innerHTML = `
        <div style="background:white;border-radius:24px;padding:28px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.2);text-align:center;">
            <div style="width:56px;height:56px;margin:0 auto 16px;border-radius:16px;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 4px 16px rgba(245,158,11,0.2);">🆕</div>
            <div style="font-size:18px;font-weight:800;color:#1e293b;margin-bottom:4px;">Naya User Sign Up!</div>
            <div style="font-size:12px;color:#64748b;margin-bottom:16px;">Ek naye user ne account banaya hai</div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:16px;text-align:left;margin-bottom:16px;">
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <div style="font-size:12px;"><span style="font-weight:700;color:#64748b;">Name:</span> <span style="font-weight:800;color:#1e293b;">${notif.userName || '—'}</span></div>
                    <div style="font-size:12px;"><span style="font-weight:700;color:#64748b;">Login ID:</span> <span style="font-weight:800;color:#6366f1;">@${notif.userLoginId || '—'}</span></div>
                    <div style="font-size:12px;"><span style="font-weight:700;color:#64748b;">Email:</span> <span style="font-weight:600;color:#1e293b;">${notif.userEmail || '—'}</span></div>
                    <div style="font-size:12px;"><span style="font-weight:700;color:#64748b;">Signup:</span> <span style="color:#1e293b;">${signupDate}</span></div>
                    <div style="font-size:12px;"><span style="font-weight:700;color:#64748b;">Trial End:</span> <span style="font-weight:700;color:#f59e0b;">${trialEndDate}</span></div>
                </div>
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">3 din ka trial chal raha hai. Admin Panel se approve karein aur time period set karein.</div>
            <div style="display:flex;gap:10px;">
                <button onclick="dismissSignupNotification('${notif.id}')" style="flex:1;padding:12px;background:#f1f5f9;border:none;border-radius:12px;color:#64748b;font-size:13px;font-weight:700;cursor:pointer;">Baad Mein</button>
                <button onclick="dismissSignupNotification('${notif.id}');document.getElementById('admin-panel-btn')?.click();" style="flex:1;padding:12px;background:linear-gradient(135deg,#6366f1,#3b82f6);border:none;border-radius:12px;color:white;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(99,102,241,0.3);">Admin Panel</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
}

window.dismissSignupNotification = async function(notifId) {
    try {
        await updateDoc(doc(db, "admin_notifications", notifId), { read: true });
    } catch(e) { console.error('Dismiss error:', e); }
    document.getElementById('signup-popup-' + notifId)?.remove();
};

export function init() { setupAdminPanel(); }
