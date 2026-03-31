// modules/notifications.js — Notification panel, overdue popup, browser push, scheduling
import { APP, ADMIN_EMAIL, ui, NS } from './state.js';
import { auth, db } from './firebase.js';
import { collection, addDoc, getDocs, updateDoc, doc, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
        const pendingTasks = (typeof APP.allTasks !== 'undefined' ? APP.allTasks : [])
            .filter(t => !t.deleted && t.status !== 'Done' && t.status !== 'Finished');
        const taskBadgeCount = window._seenTaskIds === null
            ? pendingTasks.length
            : pendingTasks.filter(t => !window._seenTaskIds.has(t._docId)).length;
        if(taskBadgeCount > 0) { tb.textContent = taskBadgeCount > 9 ? '9+' : taskBadgeCount; tb.style.display='flex'; }
        else tb.style.display='none';
    }
    // Reminder badge on sidebar — show new reminders added since last visit (clears on page visit)
    const rb = document.getElementById('rem-badge');
    if(rb) {
        const activeRems = (typeof APP.allReminders !== 'undefined' ? APP.allReminders : [])
            .filter(r => r.status !== 'Closed' && r.status !== 'Done');
        const remBadgeCount = window._seenRemIds === null
            ? activeRems.length
            : activeRems.filter(r => !window._seenRemIds.has(r._docId)).length;
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
    const pendingTasks  = APP.allTasks.filter(t => t.status !== 'Done' && t.status !== 'Finished').length;
    const overdueCount  = APP.allTasks.filter(t => {
        if(t.status === 'Done' || t.status === 'Finished') return false;
        const d = t.dueDate ? new Date(t.dueDate) : new Date(t.timestamp);
        return d < todayStart;
    }).length;
    const activeRem = APP.allReminders.filter(r => r.status !== 'Closed').length;

    const tn = document.getElementById('np-task-num');
    const rn = document.getElementById('np-rem-num');
    const sn = document.getElementById('np-saved-num');
    if(tn) { tn.textContent = pendingTasks; tn.title = overdueCount > 0 ? overdueCount + ' overdue' : ''; tn.style.color = overdueCount > 0 ? '#ef4444' : '#fbbf24'; }
    if(rn) rn.textContent = activeRem;
    if(sn) sn.textContent = NS.savedToday;
}

// Expose internal functions on window so other modules (ai.js, data.js) can call them
window.refreshBadges  = () => refreshBadges();
window.refreshCounters = () => refreshCounters();

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
        const pendingTasks = APP.allTasks.filter(t => t.status !== 'Done' && t.status !== 'Finished');
        const activeRem    = APP.allReminders.filter(r => r.status !== 'Closed');

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
        // Use APP.allGroupedNotes (has account extracted already); fallback to rebuilding from APP.allSavedNotes
        let grpObj = APP.allGroupedNotes;
        if(!grpObj || Object.keys(grpObj).length === 0) {
            grpObj = {};
            (APP.allSavedNotes || []).forEach(note => {
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
window.renderNotifList = () => renderNotifList();

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
    const overdueTasks = APP.allTasks.filter(t => {
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
    const overdueReminders = APP.allReminders.filter(r => {
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
    const headerCloseBtn = document.getElementById('overdue-header-close-btn');
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
        if(headerCloseBtn) headerCloseBtn.removeEventListener('click', closeHandler);
    };

    skipBtn.addEventListener('click', skipHandler);
    finishBtn.addEventListener('click', finishHandler);
    closeBtn.addEventListener('click', closeHandler);
    if(headerCloseBtn) headerCloseBtn.addEventListener('click', closeHandler);

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

    const overdueTaskCount = APP.allTasks.filter(t => {
        if(t.status === 'Done' || t.status === 'Finished') return false;
        const d = t.dueDate ? new Date(t.dueDate) : (t.timestamp ? new Date(t.timestamp) : null);
        return d && d < todayStart;
    }).length;

    const overdueRemCount = APP.allReminders.filter(r => {
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

    const pendingCount = APP.allTasks.filter(t => !t.deleted && t.status !== 'Done' && t.status !== 'Finished').length;
    const remCount     = APP.allReminders.filter(r => r.status !== 'Closed' && r.status !== 'Done').length;

    // Mark sent regardless so it doesn't re-fire
    sentSlots.push(slotKey);
    localStorage.setItem(storageKey, JSON.stringify(sentSlots));

    if(!NS.pushOK || (pendingCount === 0 && remCount === 0)) return;

    const parts = [];
    if(pendingCount > 0) parts.push(pendingCount + ' task' + (pendingCount > 1 ? 's' : '') + ' pending');
    if(remCount     > 0) parts.push(remCount     + ' reminder' + (remCount     > 1 ? 's' : '') + ' active');
    browserPush('task', '📋 ' + label + ' — CaseDesk AI', parts.join(' aur ') + ' hain, inhe finish karein! 💪');
}

export function init() { scheduleDailySummaryNotifs?.(); }
