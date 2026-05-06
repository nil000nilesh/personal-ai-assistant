// modules/export.js — Data export: CSV for tasks, reminders, clients
import { APP } from './state.js';

function downloadCSV(filename, headers, rows) {
    const escape = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportTasksCSV() {
    const headers = ['Title', 'Client', 'Status', 'Priority', 'Due Date', 'Created'];
    const rows = (APP.allTasks || [])
        .filter(t => !t.deleted)
        .map(t => [
            t.title || '',
            t.client || '',
            t.status || 'Pending',
            t.priority || 'Normal',
            t.dueDate || '',
            (t.timestamp || '').substring(0, 10)
        ]);
    downloadCSV('tasks_export.csv', headers, rows);
}

export function exportRemindersCSV() {
    const headers = ['Title', 'Client', 'Status', 'Time', 'Type', 'Created'];
    const rows = (APP.allReminders || [])
        .filter(r => !r.deleted)
        .map(r => [
            r.title || '',
            r.client || '',
            r.status || 'Active',
            r.time || '',
            r.type || '',
            (r.timestamp || '').substring(0, 10)
        ]);
    downloadCSV('reminders_export.csv', headers, rows);
}

export function exportClientsCSV() {
    const headers = ['Client Name', 'Mobile', 'Account No', 'Address', 'Status', 'Total Updates'];
    const rows = Object.values(APP.allGroupedNotes || {})
        .map(g => [
            g.displayTitle || '',
            g.mobile || '',
            g.account || '',
            g.address || '',
            (g.updates && g.updates[0]?.status) || '',
            g.updates?.length || 0
        ]);
    downloadCSV('clients_export.csv', headers, rows);
}

// Wire to window for HTML onclick
window.exportTasksCSV = exportTasksCSV;
window.exportRemindersCSV = exportRemindersCSV;
window.exportClientsCSV = exportClientsCSV;
