// modules/manual-crud.js — Manual Add/Edit/Delete for tasks, reminders, notes
import { APP } from './state.js';
import { db } from './firebase.js';
import { collection, addDoc, updateDoc, doc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── State ─────────────────────────────────────────────────────────────
let _editingTaskId = null;
let _editingRemId = null;
let _editingClientName = null;

// ── Task Modal ────────────────────────────────────────────────────────
export function openAddTaskModal(task = null) {
    _editingTaskId = task?._docId || null;
    const modal = document.getElementById('add-task-modal');
    if (!modal) return;
    document.getElementById('atm-modal-title').textContent = task ? 'Edit Task' : 'New Task';
    document.getElementById('atm-title').value    = task?.title    || '';
    document.getElementById('atm-client').value   = task?.client   || '';
    document.getElementById('atm-duedate').value  = task?.dueDate  || '';
    document.getElementById('atm-priority').value = task?.priority || '';
    document.getElementById('atm-error').classList.add('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('atm-title')?.focus(), 50);
}

export function closeAddTaskModal() {
    document.getElementById('add-task-modal')?.classList.add('hidden');
    _editingTaskId = null;
}

export async function saveTaskFromModal() {
    const title    = document.getElementById('atm-title')?.value.trim();
    const client   = document.getElementById('atm-client')?.value.trim();
    const dueDate  = document.getElementById('atm-duedate')?.value || '';
    const priority = document.getElementById('atm-priority')?.value || '';
    const errEl    = document.getElementById('atm-error');

    if (!title) {
        errEl.textContent = 'Task title required hai.';
        errEl.classList.remove('hidden');
        return;
    }
    errEl.classList.add('hidden');

    const btn = document.querySelector('#add-task-modal button[onclick="saveTaskFromModal()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        if (_editingTaskId) {
            await updateDoc(doc(db, 'tasks', _editingTaskId), { title, client, dueDate, priority });
        } else {
            await addDoc(collection(db, 'tasks'), {
                title, client, dueDate, priority,
                status: 'Pending',
                timestamp: new Date().toISOString(),
                userId: APP.currentUserEmail,
                deleted: false
            });
        }
        closeAddTaskModal();
        window.addActivity?.('✅', _editingTaskId ? 'Task updated: ' + title : 'Task added: ' + title, '#f59e0b');
    } catch (err) {
        errEl.textContent = 'Save failed: ' + err.message;
        errEl.classList.remove('hidden');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Task'; }
    }
}

export async function confirmDeleteTask(docId, title) {
    if (!confirm(`"${title}" delete karna chahte hain?\n(Yeh action undo ho sakta hai)`) ) return;
    try {
        await updateDoc(doc(db, 'tasks', docId), { deleted: true, deletedAt: new Date().toISOString() });
        window.addActivity?.('🗑️', 'Task deleted: ' + title, '#ef4444');
    } catch (err) { console.error('Task delete error:', err); }
}

// ── Reminder Modal ────────────────────────────────────────────────────
export function openAddReminderModal(rem = null) {
    _editingRemId = rem?._docId || null;
    const modal = document.getElementById('add-reminder-modal');
    if (!modal) return;
    document.getElementById('arm-modal-title').textContent = rem ? 'Edit Reminder' : 'New Reminder';
    document.getElementById('arm-title').value  = rem?.title  || '';
    document.getElementById('arm-client').value = rem?.client || '';
    document.getElementById('arm-type').value   = rem?.type   || '';
    // Convert ISO time to datetime-local format
    if (rem?.time) {
        try {
            const d = new Date(rem.time);
            if (!isNaN(d)) document.getElementById('arm-datetime').value = d.toISOString().slice(0, 16);
            else document.getElementById('arm-datetime').value = '';
        } catch { document.getElementById('arm-datetime').value = ''; }
    } else {
        document.getElementById('arm-datetime').value = '';
    }
    document.getElementById('arm-error').classList.add('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('arm-title')?.focus(), 50);
}

export function closeAddReminderModal() {
    document.getElementById('add-reminder-modal')?.classList.add('hidden');
    _editingRemId = null;
}

export async function saveReminderFromModal() {
    const title    = document.getElementById('arm-title')?.value.trim();
    const client   = document.getElementById('arm-client')?.value.trim();
    const datetime = document.getElementById('arm-datetime')?.value;
    const type     = document.getElementById('arm-type')?.value || '';
    const errEl    = document.getElementById('arm-error');

    if (!title) {
        errEl.textContent = 'Reminder title required hai.';
        errEl.classList.remove('hidden');
        return;
    }
    errEl.classList.add('hidden');

    const timeISO = datetime ? new Date(datetime).toISOString() : 'Manual';
    const btn = document.querySelector('#add-reminder-modal button[onclick="saveReminderFromModal()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        if (_editingRemId) {
            await updateDoc(doc(db, 'reminders', _editingRemId), { title, client, time: timeISO, type });
            window.scheduleReminder?.({ title, client, time: timeISO, type, _docId: _editingRemId });
        } else {
            const remObj = {
                title, client, time: timeISO, type,
                status: 'Active',
                recurring: 'none',
                timestamp: new Date().toISOString(),
                userId: APP.currentUserEmail,
                deleted: false
            };
            const docRef = await addDoc(collection(db, 'reminders'), remObj);
            window.scheduleReminder?.({ ...remObj, _docId: docRef.id });
        }
        closeAddReminderModal();
        window.addActivity?.('⏰', _editingRemId ? 'Reminder updated: ' + title : 'Reminder added: ' + title, '#6366f1');
    } catch (err) {
        errEl.textContent = 'Save failed: ' + err.message;
        errEl.classList.remove('hidden');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Reminder'; }
    }
}

export async function confirmDeleteReminder(docId, title) {
    if (!confirm(`"${title}" delete karna chahte hain?`)) return;
    try {
        await updateDoc(doc(db, 'reminders', docId), { deleted: true, deletedAt: new Date().toISOString() });
        window.addActivity?.('🗑️', 'Reminder deleted: ' + title, '#ef4444');
    } catch (err) { console.error('Reminder delete error:', err); }
}

// ── Edit Note (Client Profile) Modal ──────────────────────────────────
export function openEditNoteModal(clientName) {
    _editingClientName = clientName;
    const group = APP.allGroupedNotes[clientName.toUpperCase()];
    const modal = document.getElementById('edit-note-modal');
    if (!modal || !group) return;
    document.getElementById('enm-client-name').textContent = group.displayTitle || clientName;
    document.getElementById('enm-mobile').value  = group.mobile  || '';
    document.getElementById('enm-account').value = group.account || '';
    document.getElementById('enm-address').value = group.address || '';
    // Get status from latest update
    const latestStatus = group.updates?.[0]?.status || group.updates?.[0]?.info?.status || '';
    document.getElementById('enm-status').value = latestStatus;
    document.getElementById('enm-error').classList.add('hidden');
    modal.classList.remove('hidden');
}

export function closeEditNoteModal() {
    document.getElementById('edit-note-modal')?.classList.add('hidden');
    _editingClientName = null;
}

export async function saveNoteEditFromModal() {
    if (!_editingClientName) return;
    const mobile  = document.getElementById('enm-mobile')?.value.trim();
    const account = document.getElementById('enm-account')?.value.trim();
    const address = document.getElementById('enm-address')?.value.trim();
    const status  = document.getElementById('enm-status')?.value;
    const errEl   = document.getElementById('enm-error');
    errEl.classList.add('hidden');

    const btn = document.querySelector('#edit-note-modal button[onclick="saveNoteEditFromModal()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        const q = query(
            collection(db, 'notes'),
            where('client', '==', _editingClientName),
            where('userId', '==', APP.currentUserEmail)
        );
        const snap = await getDocs(q);
        const updates = snap.docs.map(d => updateDoc(doc(db, 'notes', d.id), { mobile, account, address, status }));
        await Promise.all(updates);
        closeEditNoteModal();
        window.addActivity?.('✏️', 'Profile updated: ' + _editingClientName, '#0891b2');
    } catch (err) {
        errEl.textContent = 'Save failed: ' + err.message;
        errEl.classList.remove('hidden');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
}

// ── Wire all to window.* ──────────────────────────────────────────────
window.openAddTaskModal     = openAddTaskModal;
window.closeAddTaskModal    = closeAddTaskModal;
window.saveTaskFromModal    = saveTaskFromModal;
window.confirmDeleteTask    = confirmDeleteTask;
window.openAddReminderModal = openAddReminderModal;
window.closeAddReminderModal= closeAddReminderModal;
window.saveReminderFromModal= saveReminderFromModal;
window.confirmDeleteReminder= confirmDeleteReminder;
window.openEditNoteModal    = openEditNoteModal;
window.closeEditNoteModal   = closeEditNoteModal;
window.saveNoteEditFromModal= saveNoteEditFromModal;

export function initManualCRUD() {
    // Close modals on Escape
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        closeAddTaskModal();
        closeAddReminderModal();
        closeEditNoteModal();
    });
}
