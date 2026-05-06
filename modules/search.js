// modules/search.js — Global cross-view search (Ctrl+K)
import { APP } from './state.js';

let _open = false;

function isInputActive() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function openSearchModal() {
    const modal = document.getElementById('global-search-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    _open = true;
    setTimeout(() => document.getElementById('search-modal-input')?.focus(), 50);
}

export function closeSearchModal() {
    document.getElementById('global-search-modal')?.classList.add('hidden');
    const inp = document.getElementById('search-modal-input');
    if (inp) inp.value = '';
    const body = document.getElementById('search-results-body');
    if (body) body.innerHTML = '<div class="empty-state"><p class="empty-state-title">Search karein...</p><p class="empty-state-sub">Tasks, reminders, clients, notes — sab ek jagah</p></div>';
    _open = false;
}

function match(obj, q, fields) {
    return fields.some(f => (obj[f] || '').toLowerCase().includes(q));
}

function searchAll(query) {
    const q = query.toLowerCase().trim();
    if (!q) return null;
    return {
        tasks:     (APP.allTasks     || []).filter(t => !t.deleted && match(t, q, ['title', 'client'])).slice(0, 5),
        reminders: (APP.allReminders || []).filter(r => !r.deleted && match(r, q, ['title', 'client'])).slice(0, 5),
        notes:     (APP.allSavedNotes|| []).filter(n => !n.deleted && match(n, q, ['client', 'mobile', 'account', 'content'])).slice(0, 5),
        notebooks: (APP.allNotebooks || []).filter(n => !n.deleted && match(n, q, ['client', 'content'])).slice(0, 5),
    };
}

function renderSearchResults(results) {
    const body = document.getElementById('search-results-body');
    if (!body) return;
    if (!results) {
        body.innerHTML = '<div class="empty-state"><p class="empty-state-title">Search karein...</p><p class="empty-state-sub">Tasks, reminders, clients, notes — sab ek jagah</p></div>';
        return;
    }
    const total = Object.values(results).reduce((s, a) => s + a.length, 0);
    if (total === 0) {
        body.innerHTML = '<div class="empty-state"><p class="empty-state-title">Koi result nahi mila</p><p class="empty-state-sub">Dusra keyword try karein</p></div>';
        return;
    }

    const sections = [
        { key: 'tasks',     label: 'Tasks',           view: 'tasks',     type: 'task',     icon: '<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>' },
        { key: 'reminders', label: 'Reminders',       view: 'reminders', type: 'reminder', icon: '<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>' },
        { key: 'notes',     label: 'Client Profiles', view: 'notes',     type: 'case',     icon: '<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>' },
        { key: 'notebooks', label: 'Notebook',        view: 'notebook',  type: 'notebook', icon: '<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>' },
    ];

    let html = '';
    sections.forEach(sec => {
        const items = results[sec.key];
        if (!items.length) return;
        html += `<div class="mb-4"><div class="flex items-center gap-2 mb-2"><span class="text-slate-400">${sec.icon}</span><span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${sec.label}</span></div>`;
        items.forEach(item => {
            const title = item.title || item.client || item.displayTitle || 'Untitled';
            const sub = item.client ? item.client : (item.time || item.timestamp || '').substring(0, 16);
            html += `<div class="search-result-item flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-indigo-50 transition-colors"
                         data-view="${sec.view}" data-type="${sec.type}" data-idx="${(APP.allTasks||[]).indexOf(item)}">
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-slate-800 truncate">${title}</p>
                    ${sub ? `<p class="text-[10px] text-slate-400 truncate">${sub}</p>` : ''}
                </div>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#94a3b8" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
            </div>`;
            // Store item reference for click
            body._searchItems = body._searchItems || {};
            body._searchItems[`${sec.type}_${title}`] = { item, view: sec.view, type: sec.type };
        });
        html += '</div>';
    });
    body.innerHTML = html;

    // Wire clicks
    body.querySelectorAll('.search-result-item').forEach(el => {
        const view = el.dataset.view;
        const type = el.dataset.type;
        const title = el.querySelector('p')?.textContent;
        el.addEventListener('click', () => {
            closeSearchModal();
            window._switchView?.(view);
            // Find item and open focus mode after DOM settles
            setTimeout(() => {
                const allMap = { task: APP.allTasks, reminder: APP.allReminders, case: APP.allSavedNotes, notebook: APP.allNotebooks };
                const arr = allMap[type] || [];
                const found = arr.find(i => (i.title||i.client||'') === title);
                if (found) window.openFocusMode?.(type, found);
            }, 150);
        });
    });
}

export function initSearch() {
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && _open) { closeSearchModal(); return; }
        if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !isInputActive())) {
            e.preventDefault(); openSearchModal();
        }
    });
    document.getElementById('search-backdrop')?.addEventListener('click', closeSearchModal);
    document.getElementById('search-modal-input')?.addEventListener('input', e => {
        renderSearchResults(searchAll(e.target.value));
    });
}

window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
