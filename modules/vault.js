// modules/vault.js — AES-256-GCM password vault with PIN protection
import { APP, ui } from './state.js';
import { auth, db } from './firebase.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
        { name: 'PBKDF2', salt: enc.encode(APP.currentUserEmail + '_vault_v2'), iterations: 120000, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function _vHashPin(pin) {
    const data = new TextEncoder().encode(pin + '|' + APP.currentUserEmail + '|vault_verify_v2');
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
    sessionStorage.setItem('_vaultSess2', JSON.stringify({ ...existingSess, date: today, uid: APP.currentUserEmail, loginDone: true }));
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
            where('userId', '==', APP.currentUserEmail),
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
            sessionValid = (p.date === today && p.uid === APP.currentUserEmail && p.loginDone);
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
        const snap = await getDocs(query(collection(db, 'vault_entries'), where('userId', '==', APP.currentUserEmail)));
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
        const data = { userId: APP.currentUserEmail, title, username, encryptedPassword, url, notes, timestamp: now, deleted: false };
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
        if (entered !== APP.currentUserPin) {
            _vShakeError('.vp-login-box', 'vault-login-error');
            return;
        }
        // Login PIN correct — mark session loginDone
        const today = new Date().toISOString().slice(0,10);
        const existing = (() => { try { return JSON.parse(sessionStorage.getItem('_vaultSess2')||'{}'); } catch{return{};} })();
        sessionStorage.setItem('_vaultSess2', JSON.stringify({ ...existing, date: today, uid: APP.currentUserEmail, loginDone: true }));

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
                const snap = await getDocs(query(collection(db, 'vault_entries'), where('userId','==', APP.currentUserEmail)));
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
            const cfgData = { userId: APP.currentUserEmail, _type: 'vault_config', vaultPinHash: hash, updatedAt: new Date().toISOString(), deleted: false };
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
