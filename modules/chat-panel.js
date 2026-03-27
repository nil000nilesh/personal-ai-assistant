// modules/chat-panel.js — Floating chat panel: FAB drag, panel drag, resize, show/hide, clear chat, activity bar
import { APP, NS, ui } from './state.js';
import { db } from './firebase.js';
import { addDoc, collection } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const chatPanel  = document.getElementById('chat-panel');
const chatFab    = document.getElementById('chat-fab');
const fabBtn     = document.getElementById('open-chat-fab');
const fabBadge   = document.getElementById('fab-badge');

function showPanel() {
    if(!chatPanel) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const isMobile = vw < 768;

    let pw, ph, right, bottom, left, borderRadius;
    if (isMobile) {
        pw = vw - 16;
        ph = vh - 160;
        right = '8px';
        bottom = '80px';
        left = 'auto';
        borderRadius = '16px';
    } else {
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
    APP.panelVisible = true;
    APP.unreadCount = 0;
    if(fabBadge) fabBadge.style.display = 'none';
    setTimeout(() => { if(ui.userInput) ui.userInput.focus(); if(ui.chatBox) ui.chatBox.scrollTop = ui.chatBox.scrollHeight; }, 100);
}

function hidePanel() {
    if(!chatPanel) return;
    chatPanel.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
    chatPanel.style.opacity = '0';
    chatPanel.style.transform = 'translateY(14px) scale(0.97)';
    setTimeout(() => { if(chatPanel) { chatPanel.style.display = 'none'; chatPanel.style.display = ''; chatPanel.style.display = 'none'; } }, 180);
    APP.panelVisible = false;
}

// Add activity entry function — exported for use in ai.js
export function addActivity(icon, text, color) {
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
    if(!APP.panelVisible && fabBadge) {
        APP.unreadCount++;
        fabBadge.textContent = APP.unreadCount > 9 ? '9+' : APP.unreadCount;
        fabBadge.style.display = 'flex';
    }
}
window.addActivity = addActivity;

export function init() {
    fabBtn.addEventListener('click', (e) => {
        if(APP.panelVisible) hidePanel(); else showPanel();
    });
    document.getElementById('minimise-chat-btn').addEventListener('click', hidePanel);
    document.getElementById('close-chat-btn').addEventListener('click', hidePanel);

    // ── CLEAR CHAT — New session start karo ──────────────────────────
    document.getElementById('clear-chat-btn')?.addEventListener('click', async () => {
        if(!confirm('Nayi chat session shuru karein?\n\nPurani history screen se hat jayegi (data Firestore mein safe rahega).')) return;
        APP.sessionStartTime = new Date().toISOString();
        APP.chatHistory = [];
        if(ui.chatBox) {
            const welcome = ui.chatBox.firstElementChild;
            ui.chatBox.innerHTML = '';
            if(welcome) ui.chatBox.appendChild(welcome);
        }
        try {
            await addDoc(collection(db, "chats"), {
                role: "assistant",
                content: "✨ Nayi chat session shuru hui! Ab fresh start — boliye, kya kaam hai? 😊",
                timestamp: new Date().toISOString(),
                userId: APP.currentUserEmail
            });
        } catch(e) { console.warn('Session reset save failed:', e); }
    });

    // Activity bar toggle
    document.getElementById('toggle-activity-btn').addEventListener('click', () => {
        const bar = document.getElementById('activity-bar');
        bar.style.display = (bar.style.display === 'none' || bar.style.display === '') ? 'block' : 'none';
    });

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
}
