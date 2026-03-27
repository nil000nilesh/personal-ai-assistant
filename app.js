// app.js — Entry point: sets up shared state, view switching, imports all modules
import { APP, ui } from './modules/state.js';
import { loadAppListeners } from './modules/data.js';
import { init as initChatPanel } from './modules/chat-panel.js';
import { init as initNotifications } from './modules/notifications.js';
import { init as initAdmin } from './modules/admin.js';

// Side-effect imports (these modules set up their own listeners on import)
import './modules/auth.js';    // onAuthStateChanged, login/PIN handlers
import './modules/ai.js';      // sendMessage, speech recognition
import './modules/vault.js';   // password vault UI

// ── Fill UI element references (used lazily by all modules) ──────────
Object.assign(ui, {
    login:            document.getElementById('login-screen'),
    pin:              document.getElementById('pin-screen'),
    appLayout:        document.getElementById('app-layout'),
    viewNotes:        document.getElementById('view-notes'),
    viewTasks:        document.getElementById('view-tasks'),
    viewReminders:    document.getElementById('view-reminders'),
    viewNotebook:     document.getElementById('view-notebook'),
    chatBox:          document.getElementById('chat-box'),
    notesGrid:        document.getElementById('notes-grid'),
    tasksList:        document.getElementById('tasks-list'),
    remindersList:    document.getElementById('reminders-list'),
    notebookGrid:     document.getElementById('notebook-grid'),
    userInput:        document.getElementById('user-input'),
    micBtn:           document.getElementById('mic-btn'),
    chatModal:        document.getElementById('chat-modal'),
    chatModalContent: document.getElementById('chat-modal-content')
});

// ── View switching ────────────────────────────────────────────────────
const views = ['notebook', 'notes', 'tasks', 'reminders', 'vault'];

export function switchView(targetView) {
    views.forEach(v => {
        const deskBtn = document.getElementById('tab-' + v + '-desk');
        const mobBtn  = document.getElementById('tab-' + v + '-mob');
        const viewEl  = document.getElementById('view-' + v);
        if (v === targetView) {
            viewEl.classList.remove('hidden'); viewEl.classList.add('flex');
            if (deskBtn) deskBtn.classList.add('active');
            if (mobBtn)  mobBtn.classList.add('active');
        } else {
            viewEl.classList.add('hidden'); viewEl.classList.remove('flex');
            if (deskBtn) deskBtn.classList.remove('active');
            if (mobBtn)  mobBtn.classList.remove('active');
        }
    });
}
window._switchView = switchView;

// Vault tab — lazy init on first visit
let _vaultTabReady = false;
views.forEach(v => {
    const handler = () => {
        switchView(v);
        if (v === 'vault') {
            if (!_vaultTabReady) { _vaultTabReady = true; if (window.initVault) window.initVault(); }
            else { if (window._vaultCheckLock) window._vaultCheckLock(); }
        }
    };
    document.getElementById('tab-' + v + '-desk')?.addEventListener('click', handler);
    document.getElementById('tab-' + v + '-mob')?.addEventListener('click', handler);
});

// ── Wire cross-module functions for auth.js to call ──────────────────
window._loadAppListeners = loadAppListeners;
window._setupAdminPanel  = () => initAdmin();

// ── Initialize modules ───────────────────────────────────────────────
initChatPanel();
initNotifications();
