// modules/bulk-ops.js — Multi-select + bulk actions for tasks and reminders
import { db } from './firebase.js';
import { updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let _selectedIds = new Set();
let _bulkMode = false;
let _bulkType = null; // 'tasks' or 'reminders'

function updateBar() {
    const label = document.getElementById('bulk-count-label');
    if (label) label.textContent = `${_selectedIds.size} item${_selectedIds.size !== 1 ? 's' : ''} selected`;
    // Update select-all checkbox
    const allCbs = document.querySelectorAll('.bulk-checkbox');
    const selectAllCb = document.getElementById('bulk-select-all');
    if (selectAllCb && allCbs.length > 0) {
        selectAllCb.checked = allCbs.length > 0 && [...allCbs].every(cb => _selectedIds.has(cb.dataset.docid));
        selectAllCb.indeterminate = _selectedIds.size > 0 && _selectedIds.size < allCbs.length;
    }
}

export function enterBulkMode(type) {
    _bulkMode = true;
    _bulkType = type;
    _selectedIds.clear();
    document.getElementById('bulk-action-bar')?.classList.remove('hidden');
    if (type === 'tasks') window.renderTasks?.();
    else window.renderReminders?.();
    updateBar();
}

export function exitBulkMode() {
    _bulkMode = false;
    _bulkType = null;
    _selectedIds.clear();
    document.getElementById('bulk-action-bar')?.classList.add('hidden');
    window.renderTasks?.();
    window.renderReminders?.();
}

export function toggleItemSelection(docId) {
    if (_selectedIds.has(docId)) _selectedIds.delete(docId);
    else _selectedIds.add(docId);
    updateBar();
}

export function bulkSelectAll(checked) {
    const allCbs = document.querySelectorAll('.bulk-checkbox');
    allCbs.forEach(cb => {
        if (checked) _selectedIds.add(cb.dataset.docid);
        else _selectedIds.delete(cb.dataset.docid);
        cb.checked = checked;
    });
    updateBar();
}

export async function bulkMarkDone() {
    if (_selectedIds.size === 0) return;
    const status = _bulkType === 'tasks' ? 'Done' : 'Closed';
    const colName = _bulkType === 'tasks' ? 'tasks' : 'reminders';
    const extra = _bulkType === 'reminders' ? { finishedAt: new Date().toISOString() } : {};
    const ids = [..._selectedIds];
    try {
        await Promise.all(ids.map(id => updateDoc(doc(db, colName, id), { status, ...extra })));
        window.addActivity?.('✅', `${ids.length} items marked as ${status}`, '#10b981');
    } catch (err) { console.error('Bulk mark done error:', err); }
    exitBulkMode();
}

export async function bulkDelete() {
    if (_selectedIds.size === 0) return;
    if (!confirm(`${_selectedIds.size} items delete karna chahte hain?`)) return;
    const colName = _bulkType === 'tasks' ? 'tasks' : 'reminders';
    const ids = [..._selectedIds];
    const now = new Date().toISOString();
    try {
        await Promise.all(ids.map(id => updateDoc(doc(db, colName, id), { deleted: true, deletedAt: now })));
        window.addActivity?.('🗑️', `${ids.length} items deleted`, '#ef4444');
    } catch (err) { console.error('Bulk delete error:', err); }
    exitBulkMode();
}

// ── Expose globally for use in data.js render functions ──────────────
window.isBulkMode    = () => _bulkMode;
window.getBulkType   = () => _bulkType;
window.isSelected    = (id) => _selectedIds.has(id);
window.enterBulkMode = enterBulkMode;
window.exitBulkMode  = exitBulkMode;
window.toggleItemSelection = toggleItemSelection;
window.bulkSelectAll = bulkSelectAll;
window.bulkMarkDone  = bulkMarkDone;
window.bulkDelete    = bulkDelete;

export function initBulkOps() {
    // No additional setup needed — all wired above
}
