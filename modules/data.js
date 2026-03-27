// modules/data.js — Firestore real-time listeners, note/task/reminder/chat rendering
import { APP, ADMIN_EMAIL, ui, NS } from './state.js';
import { auth, db } from './firebase.js';
import { collection, addDoc, getDocs, query, orderBy, where, onSnapshot, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
// scheduleReminder is accessed via window (set by notifications.js)


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
    const uid = APP.currentUserEmail;
    const isAdminUser = (APP.currentUserRole === 'admin');

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
        snapshot.forEach(d => { const m = d.data(); if(isAdminUser && m.userId && m.userId !== ADMIN_EMAIL) return; if((m.timestamp||'') >= APP.sessionStartTime) msgs.push(m); });
        msgs.sort((a,b) => (a.timestamp||'').localeCompare(b.timestamp||''));
        APP.chatHistory = [];
        msgs.forEach(msg => {
            APP.chatHistory.push({ role: msg.role, content: msg.content });
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
    // APP.allGroupedNotes is global (declared at top)

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

        let entries = Object.values(APP.allGroupedNotes);

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
        APP.allSavedNotes = []; APP.allGroupedNotes = {};
        const docs = [];
        snapshot.forEach(d => {
            const data = d.data();
            if(isAdminUser && data.userId && data.userId !== ADMIN_EMAIL) return;
            if(data.deleted) return;
            docs.push({ ...data, _docId: d.id });
        });
        docs.sort((a,b) => (a.timestamp||'').localeCompare(b.timestamp||''));
        docs.forEach(note => {
            APP.allSavedNotes.push(note);
            const key = (note.client || note.title || 'सामान्य').toUpperCase();
            const name = note.client || note.title || 'सामान्य';
            if(!APP.allGroupedNotes[key]) APP.allGroupedNotes[key] = { displayTitle: name, mobile: null, account: null, address: null, updates: [] };
            const g = APP.allGroupedNotes[key];
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
            filtered = APP.allTasks.filter(t => isIncomplete(t));
        } else if(taskCurrentFilter === 'done') {
            filtered = APP.allTasks.filter(t => t.status === 'Done' || t.status === 'Finished');
        } else { // 'all'
            filtered = [...APP.allTasks];
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
        const totalPending  = APP.allTasks.filter(t => isIncomplete(t)).length;
        const totalOverdue  = APP.allTasks.filter(t => isIncomplete(t) && taskEffectiveDate(t) < todayStart).length;
        const totalDone     = APP.allTasks.filter(t => t.status === 'Done').length;
        const totalFinished = APP.allTasks.filter(t => t.status === 'Finished').length;
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
        APP.allTasks = [];
        snapshot.forEach(d => {
            const data = d.data();
            if(isAdminUser && data.userId && data.userId !== ADMIN_EMAIL) return;
            if(data.deleted) return;
            APP.allTasks.push({ ...data, _docId: d.id });
        });
        // Client-side sort: timestamp desc (newest first)
        APP.allTasks.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
        renderTasks();
        // Update notif panel task counter
        const pendingForNotif = APP.allTasks.filter(t => t.status !== 'Done' && t.status !== 'Finished').length;
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
        const activeReminders = APP.allReminders.filter(r => r.status !== 'Closed');
        const closedReminders = APP.allReminders.filter(r => r.status === 'Closed');

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
                        window.scheduleReminder?.(rem);
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
        APP.allReminders = [];
        snapshot.forEach(d => {
            const data = d.data();
            if(isAdminUser && data.userId && data.userId !== ADMIN_EMAIL) return;
            if(data.deleted) return;
            APP.allReminders.push({ ...data, _docId: d.id });
        });
        // Client-side sort: timestamp desc
        APP.allReminders.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
        renderReminders();
        // Schedule browser push for all upcoming reminders on load
        APP.allReminders.forEach(rem => { window.scheduleReminder?.(rem); });
        // Update reminder count in notif panel
        const upcomingCount = APP.allReminders.filter(r => {
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
            : query(collection(db, colName), where("userId", "==", APP.currentUserEmail));
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
        APP.allNotebooks.forEach(page => {
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

            const hasProfile = typeof APP.allGroupedNotes !== 'undefined' && !!APP.allGroupedNotes[group.displayName.toUpperCase()];
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
        APP.allNotebooks = [];
        snapshot.forEach(d => {
            const data = d.data();
            if(isAdminUser && data.userId && data.userId !== ADMIN_EMAIL) return;
            if(data.deleted) return;
            APP.allNotebooks.push({ ...data, _docId: d.id });
        });
        // Client-side sort: timestamp desc
        APP.allNotebooks.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
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

    recognition.onstart = () => { isRecording = true; document.getElementById('mic-btn')?.classList.add('recording'); const inp = document.getElementById('user-input'); if(inp) inp.placeholder = "Listening..."; };
    recognition.onresult = (event) => {
        const inp = document.getElementById('user-input');
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal && inp) inp.value += event.results[i][0].transcript + ' ';
            else interimTranscript += event.results[i][0].transcript;
        }
    };
    recognition.onend = () => { isRecording = false; document.getElementById('mic-btn')?.classList.remove('recording'); const inp = document.getElementById('user-input'); if(inp) inp.placeholder = "Type a command or tap mic..."; };
    document.getElementById('mic-btn')?.addEventListener('click', () => { if (isRecording) recognition.stop(); else recognition.start(); });
} else { const m = document.getElementById('mic-btn'); if(m) m.style.display = 'none'; }



export { loadAppListeners };
