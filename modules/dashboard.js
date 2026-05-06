// modules/dashboard.js — Smart home dashboard with live stats and sections
import { APP } from './state.js';

// Colour palettes for client avatar initials (matches existing data.js pattern)
const PALETTES = [
    { bg: '#ede9fe', text: '#4f46e5' }, { bg: '#cffafe', text: '#0e7490' },
    { bg: '#d1fae5', text: '#047857' }, { bg: '#fee2e2', text: '#b91c1c' },
    { bg: '#fef3c7', text: '#b45309' }, { bg: '#f3e8ff', text: '#6d28d9' },
    { bg: '#fce7f3', text: '#be185d' }, { bg: '#e0f2fe', text: '#0369a1' },
];

function paletteFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
    return PALETTES[Math.abs(h) % PALETTES.length];
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

export function renderDashboard() {
    // Only render if dashboard view is visible
    const view = document.getElementById('view-dashboard');
    if (!view || !view.classList.contains('flex')) return;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // ── Greeting ──────────────────────────────────────────────────────
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
    const greetEl = document.getElementById('dash-greeting');
    if (greetEl) greetEl.textContent = `${greeting}! 👋`;
    const dateEl = document.getElementById('dash-date');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const tasks     = APP.allTasks     || [];
    const reminders = APP.allReminders || [];
    const clients   = APP.allGroupedNotes || {};

    // ── Stat Cards ───────────────────────────────────────────────────
    const pendingTasks = tasks.filter(t => !t.deleted && t.status !== 'Done' && t.status !== 'Finished');
    const overdueTasks = pendingTasks.filter(t => {
        const d = t.dueDate ? new Date(t.dueDate) : null;
        return d && d < todayStart;
    });
    const activeRems = reminders.filter(r => !r.deleted && r.status !== 'Closed');
    const clientCount = Object.keys(clients).length;

    const setStat = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setStat('dash-stat-pending',   pendingTasks.length);
    setStat('dash-stat-overdue',   overdueTasks.length);
    setStat('dash-stat-reminders', activeRems.length);
    setStat('dash-stat-clients',   clientCount);

    // Highlight overdue card in red if > 0
    const overdueCard = document.getElementById('dash-card-overdue');
    if (overdueCard) {
        if (overdueTasks.length > 0) {
            overdueCard.style.borderColor = '#fecaca';
            overdueCard.style.background = '#fff5f5';
        } else {
            overdueCard.style.borderColor = '';
            overdueCard.style.background = '';
        }
    }

    // ── Overdue Items ─────────────────────────────────────────────────
    const overdueList = document.getElementById('dash-overdue-list');
    const overdueEmpty = document.getElementById('dash-overdue-empty');
    if (overdueList) {
        const items = overdueTasks.slice(0, 5);
        if (items.length === 0) {
            overdueList.innerHTML = '';
            overdueEmpty?.classList.remove('hidden');
        } else {
            overdueEmpty?.classList.add('hidden');
            overdueList.innerHTML = items.map(t => `
                <div class="card-enter bg-white rounded-xl border border-red-200 px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition-all"
                     onclick="window._switchView('tasks');setTimeout(()=>window.openFocusMode?.('task',window.APP?.allTasks?.find(x=>x._docId==='${esc(t._docId||'')}')??{}),150)">
                    <span class="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 animate-pulse"></span>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-semibold text-slate-800 truncate">${esc(t.title)}</p>
                        ${t.client ? `<p class="text-[10px] text-slate-400">${esc(t.client)}</p>` : ''}
                    </div>
                    <span class="chip chip-overdue flex-shrink-0">Overdue</span>
                </div>`).join('');
        }
    }

    // ── Today's Reminders ─────────────────────────────────────────────
    const todayList = document.getElementById('dash-today-list');
    const todayEmpty = document.getElementById('dash-today-empty');
    if (todayList) {
        const todayRems = activeRems.filter(r => {
            const d = r.time && r.time !== 'Manual' ? new Date(r.time) : null;
            return d && !isNaN(d) && d.toDateString() === now.toDateString();
        }).slice(0, 5);
        if (todayRems.length === 0) {
            todayList.innerHTML = '';
            todayEmpty?.classList.remove('hidden');
        } else {
            todayEmpty?.classList.add('hidden');
            todayList.innerHTML = todayRems.map(r => {
                const remDate = new Date(r.time);
                const timeStr = remDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                return `
                <div class="card-enter bg-amber-50 rounded-xl border border-amber-200 px-4 py-3 cursor-pointer hover:shadow-md transition-all"
                     onclick="window._switchView('reminders');setTimeout(()=>window.openFocusMode?.('reminder',window.APP?.allReminders?.find(x=>x._docId==='${esc(r._docId||'')}')??{}),150)">
                    <div class="flex items-center justify-between mb-1">
                        <span class="chip chip-pending">Today</span>
                        <span class="text-[10px] font-bold text-amber-600">${timeStr}</span>
                    </div>
                    <p class="text-sm font-semibold text-slate-800 truncate">${esc(r.title)}</p>
                    ${r.client ? `<p class="text-[10px] text-slate-400">${esc(r.client)}</p>` : ''}
                </div>`;
            }).join('');
        }
    }

    // ── Pending Tasks Preview ─────────────────────────────────────────
    const pendingList = document.getElementById('dash-pending-list');
    if (pendingList) {
        const items = pendingTasks.slice(0, 5);
        if (items.length === 0) {
            pendingList.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Koi pending task nahi 🎉</p>';
        } else {
            pendingList.innerHTML = items.map(t => `
                <div class="card-enter bg-white rounded-xl border border-slate-100 px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition-all"
                     onclick="window._switchView('tasks');setTimeout(()=>window.openFocusMode?.('task',window.APP?.allTasks?.find(x=>x._docId==='${esc(t._docId||'')}')??{}),150)"
                     style="box-shadow:var(--shadow-card)">
                    <div class="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0"></div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-semibold text-slate-800 truncate">${esc(t.title)}</p>
                        ${t.client ? `<p class="text-[10px] text-slate-400">${esc(t.client)}</p>` : ''}
                    </div>
                    ${t.dueDate ? `<span class="chip chip-active flex-shrink-0">${new Date(t.dueDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span>` : ''}
                </div>`).join('');
        }
    }

    // ── Recent Clients ────────────────────────────────────────────────
    const clientsGrid = document.getElementById('dash-clients-grid');
    if (clientsGrid) {
        const recentClients = Object.values(clients)
            .sort((a, b) => {
                const aTime = a.updates?.[0]?.timestamp || '';
                const bTime = b.updates?.[0]?.timestamp || '';
                return bTime.localeCompare(aTime);
            })
            .slice(0, 4);
        if (recentClients.length === 0) {
            clientsGrid.innerHTML = '<p class="text-xs text-slate-400 col-span-4 text-center py-4">Koi client profile nahi</p>';
        } else {
            clientsGrid.innerHTML = recentClients.map(g => {
                const name = g.displayTitle || 'Unknown';
                const initials = name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
                const pal = paletteFor(name);
                const updCount = g.updates?.length || 0;
                const lastUpdate = g.updates?.[0]?.timestamp?.substring(0, 10) || '';
                return `
                <div class="card-enter card-hover bg-white rounded-2xl border border-slate-100 p-4 cursor-pointer text-center"
                     style="box-shadow:var(--shadow-card)"
                     onclick="window._switchView('notes');setTimeout(()=>window.showClientDetailPopup?.('${esc(name)}'),150)">
                    <div class="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black mx-auto mb-3"
                         style="background:${pal.bg};color:${pal.text}">${initials}</div>
                    <p class="text-xs font-black text-slate-800 truncate" title="${esc(name)}">${esc(name)}</p>
                    <p class="text-[10px] text-slate-400 mt-0.5">${updCount} update${updCount !== 1 ? 's' : ''}</p>
                    ${lastUpdate ? `<p class="text-[9px] text-slate-300 mt-0.5">${lastUpdate}</p>` : ''}
                </div>`;
            }).join('');
        }
    }
}

export function initDashboard() {
    window.renderDashboard = renderDashboard;
    // Render when tab is clicked
    document.getElementById('tab-dashboard-desk')?.addEventListener('click', () => setTimeout(renderDashboard, 50));
    document.getElementById('tab-dashboard-mob')?.addEventListener('click', () => setTimeout(renderDashboard, 50));
}
