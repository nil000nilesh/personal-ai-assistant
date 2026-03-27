// modules/state.js — Shared mutable state + UI refs + constants

export const APP = {
    chatHistory: [],
    allSavedNotes: [],
    allTasks: [],
    allReminders: [],
    allNotebooks: [],
    allGroupedNotes: {},
    isPinVerified: false,
    DYNAMIC_OPENAI_KEY: "",
    OPENAI_MODEL: "gpt-4.1",
    sessionStartTime: null,
    currentUserEmail: "",
    currentUserPin: "",
    currentUserRole: "user",
    panelVisible: false,
    unreadCount: 0,
    isProcessing: false,
};

export const ADMIN_EMAIL = "nil000nilesh@gmail.com"; // Sirf yahi admin hai — hardcoded, change nahi hoga

// UI element references — filled after DOM ready by app.js
export const ui = {};

// Notification state — used by notifications.js and data.js
export const NS = {
    items: [],          // { id, type, title, sub, time, read, ts }
    unread: 0,
    filter: 'all',
    pushOK: false,
    scheduledKeys: new Set(),   // reminder keys already scheduled
    savedToday: 0
};
