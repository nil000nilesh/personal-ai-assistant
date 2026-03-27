// modules/firebase.js — Firebase initialization (auth, db, provider)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAeu14r8EACZ7U3eRszsNQmTYTFt5FndcU",
    authDomain: "ai-assistant-app-8e733.firebaseapp.com",
    projectId: "ai-assistant-app-8e733",
    storageBucket: "ai-assistant-app-8e733.firebasestorage.app",
    messagingSenderId: "318215944760",
    appId: "1:318215944760:web:2a387b7bcd068da4ff44cd"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
// Persistent login: auth state localStorage mein save hoga (Android WebView + browser dono)
setPersistence(auth, browserLocalPersistence).catch(() => {});
export const provider = new GoogleAuthProvider();
export const db = getFirestore(firebaseApp);
