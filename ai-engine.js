// ═══════════════════════════════════════════════════════════════
//  ai-engine.js — CaseDesk AI Chat Engine
//  Depends on: app.js (db, auth, ui, currentUserEmail, etc.)
//  To modify AI behaviour: sirf is file ko edit karo
// ═══════════════════════════════════════════════════════════════

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

    recognition.onstart = () => { isRecording = true; ui.micBtn.classList.add('recording'); ui.userInput.placeholder = "Listening..."; };
    recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) ui.userInput.value += event.results[i][0].transcript + ' ';
            else interimTranscript += event.results[i][0].transcript;
        }
    };
    recognition.onend = () => { isRecording = false; ui.micBtn.classList.remove('recording'); ui.userInput.placeholder = "Type a command or tap mic..."; };
    ui.micBtn.addEventListener('click', () => { if (isRecording) recognition.stop(); else recognition.start(); });
} else { ui.micBtn.style.display = 'none'; }

let isProcessing = false;

// ═══════════════════════════════════════════════════════════════
//  REAL AI ENGINE — OpenAI GPT-4o powered sendMessage
// ═══════════════════════════════════════════════════════════════
async function sendMessage() {
    if (isProcessing) return;
    const text = ui.userInput.value.trim();
    if (!text) return;

    isProcessing = true;
    ui.userInput.disabled = true;
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;
    sendBtn.classList.add('opacity-50');
    ui.userInput.value = "";

    chatHistory.push({ role: 'user', content: text });

    await addDoc(collection(db, "chats"), {
        role: "user", content: text, timestamp: new Date().toISOString(),
        userId: currentUserEmail
    });

    // Loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.className = "flex justify-start w-full";
    loadingDiv.innerHTML = `<div class="p-4 rounded-2xl bg-white border border-slate-200 text-blue-500 text-sm font-bold animate-pulse shadow-sm flex items-center gap-2"><span class="text-xl">🤖</span> AI सोच रहा है...</div>`;
    ui.chatBox.appendChild(loadingDiv);
    ui.chatBox.scrollTop = ui.chatBox.scrollHeight;

    try {
        // ── 1. FETCH DATA FROM FIREBASE FOR AI CONTEXT ──────────────────
        // Admin = saara data, User = sirf apna
        const ctxQuery = (col) => currentUserRole === 'admin'
            ? getDocs(collection(db, col))
            : getDocs(query(collection(db, col), where("userId", "==", currentUserEmail)));

        const [notebooksSnap, notesSnap, tasksSnap, remindersSnap] = await Promise.all([
            ctxQuery("notebooks"),
            ctxQuery("notes"),
            ctxQuery("tasks"),
            ctxQuery("reminders")
        ]);

        const notebookData = notebooksSnap.docs.map(d => d.data());
        const casesData    = notesSnap.docs.map(d => d.data());
        const tasksData    = tasksSnap.docs.map(d => d.data());
        const remindersData= remindersSnap.docs.map(d => d.data());

        // Summarise saved data for AI context
        function summarize(arr, fields) {
            return arr.slice(-30).map(item =>
                fields.map(f => `${f}: ${item[f] || ''}`).join(' | ')
            ).join('\n');
        }

        const savedContext = `
=== SAVED NOTEBOOKS (last 30) ===
${summarize(notebookData, ['client','content','timestamp'])}

=== CLIENT CASES (last 30) ===
${summarize(casesData, ['client','content','timestamp'])}

=== TASKS (last 30) ===
${summarize(tasksData, ['title','status','client','timestamp'])}

=== REMINDERS (last 30) ===
${summarize(remindersData, ['title','time','client','timestamp'])}
        `.trim();

        // ── 2. SYSTEM PROMPT — Smart update, no repetition ──────────────
        const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

        // Group existing notes by client for AI context
        const existingClients = {};
        [...casesData, ...notebookData].forEach(item => {
            const key = (item.client || '').toUpperCase();
            if(key) {
                if(!existingClients[key]) existingClients[key] = { name: item.client, updates: [] };
                existingClients[key].updates.push({ ts: item.timestamp, content: item.content });
            }
        });
        const clientSummary = Object.values(existingClients).map(c => {
            const sorted = c.updates.sort((a,b) => (b.ts||'').localeCompare(a.ts||''));
            return `CLIENT: ${c.name}\nLATEST UPDATE: ${sorted[0]?.content?.substring(0,200)||''}\nTOTAL UPDATES: ${sorted.length}`;
        }).join('\n---\n');

        const systemPrompt = `You are CaseDesk AI — a friendly, intelligent personal banking assistant and case manager. Today: ${today}
User: ${currentUserEmail}

YOUR PERSONALITY:
- Talk like a warm helpful friend — use natural Hinglish (Hindi + English mix)
- Give proper greetings for hi/hello/namaste/good morning/kya haal etc
- When user asks about their data, search carefully below and give complete helpful answer
- Be expressive, use emojis naturally 😊
- NEVER write code, JSON examples, or technical content in reply field

USER'S SAVED DATA — Search this carefully to answer questions:
=== CLIENT CASES ===
${clientSummary || 'Koi case data nahi abhi tak'}

=== TASKS ===
${tasksData.map(t=>`[${t.status}] ${t.title} | Client: ${t.client||'-'}`).join('\n') || 'Koi task nahi'}

=== REMINDERS ===
${remindersData.map(r=>`${r.title} | Samay: ${r.time} | Client: ${r.client||'-'}`).join('\n') || 'Koi reminder nahi'}

=== NOTEBOOKS ===
${notebookData.slice(-20).map(n=>`Client: ${n.client||'-'} | ${(n.content||'').substring(0,200)}`).join('\n') || 'Koi notebook entry nahi'}

RESPONSE RULES:
1. GREETING (hi/hello/namaste/good morning/kya haal): Warmly reply like a friend — "Namaste! Bahut accha laga aapko dekhke 😊 Aaj main aapki kya madad kar sakta hoon?"
2. QUESTION about saved data (client kahan hai / kya pending hai / remind karo): Search above data CAREFULLY and give complete, detailed answer
3. NEW INFO (client details, task, reminder): Save it AND confirm in friendly way — "Bilkul! Save kar liya 📂 Koi aur update?"
4. DELETE REQUEST (hatao / delete karo / remove karo / band karo / mita do): Set softDelete.action=true, fill collection and clientName/title. Reply: "Done! Screen se hata diya gaya 🗑️ Agar kabhi wapas chahiye to sirf bol dena, main restore kar dunga 😊"
5. OUT OF SCOPE (coding likhne ko bolo / poem / math / translate / kuch bhi jo banking case management se bilkul related nahi): Reply ONLY: "Maafi chahta hoon 🙏 Yeh kaam meri expertise se bahar hai. Main aapka banking case manager hoon — client cases, tasks, reminders aur notes mein madad kar sakta hoon. Kya main aapke kisi case ya task mein help kar sakta hoon? 😊" — Koi bhi save field true mat karna.
6. NO REPETITION: Sirf naya content save karo, purani details repeat mat karo

RESPONSE FORMAT — Always valid JSON only, no backticks, no extra text outside JSON:
{
  "reply": "Warm Hinglish response — helpful, complete, friendly. Min 2 sentences. NEVER write code or JSON here.",
  "softDelete": { "action": false, "collection": "", "clientName": "", "title": "" },
  "notebook": { "save": false, "client": "", "content": "" },
  "case": { "save": false, "client": "", "mobile": null, "account": null, "address": null, "content": "" },
  "task": { "save": false, "client": "", "title": "" },
  "reminder": { "save": false, "client": "", "title": "", "time": "" }
}

softDelete.collection = "notes" / "tasks" / "reminders" / "notebooks"
softDelete.clientName = client name to match (for notes/notebooks)
softDelete.title = task or reminder title to match (for tasks/reminders)`.trim();

        // ── 3. CALL OPENAI GPT-4o ───────────────────────────────────
        const messages = [
            { role: "system", content: systemPrompt },
            ...chatHistory.slice(-10) // last 10 messages for context
        ];

        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${DYNAMIC_OPENAI_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: messages,
                temperature: 0.3,
                max_tokens: 1200
            })
        });

        if (!openaiRes.ok) {
            const errData = await openaiRes.json();
            throw new Error(errData.error?.message || "OpenAI API Error");
        }

        const openaiData = await openaiRes.json();
        const rawContent = openaiData.choices[0].message.content.trim();

        // ── 4. PARSE AI RESPONSE ────────────────────────────────────
        let aiResponse;
        try {
            // Strip code fences if any
            const clean = rawContent.replace(/```json|```/g, '').trim();
            aiResponse = JSON.parse(clean);
        } catch(e) {
            // If AI returned plain text (not JSON), show it directly
            aiResponse = { reply: rawContent, notebook: { save: false }, case: { save: false }, task: { save: false }, reminder: { save: false } };
        }

        const replyText = aiResponse.reply || "कार्य सम्पन्न हुआ।";
        chatHistory.push({ role: 'assistant', content: replyText });

        // ── 5. SAVE TO FIREBASE BASED ON AI DECISION ───────────────
        const now = new Date().toISOString();
        const savePromises = [];

        if (aiResponse.notebook?.save && aiResponse.notebook?.content) {
            savePromises.push(addDoc(collection(db, "notebooks"), {
                title: aiResponse.notebook.client || "सामान्य",
                content: aiResponse.notebook.content,
                client: aiResponse.notebook.client || "सामान्य",
                timestamp: now,
                userId: currentUserEmail          // ← User isolation
            }));
            if(window.addActivity) addActivity('📓', 'Notebook updated: ' + (aiResponse.notebook.client || 'General'), '#4f46e5');
            addNotif('notebook', '📓 Notebook saved — ' + (aiResponse.notebook.client || 'General'), 'AI ne automatically save kiya');
            if(window.registerUpdate) registerUpdate('notebook', aiResponse.notebook.client || '');
        }

        if (aiResponse.case?.save && aiResponse.case?.content) {
            savePromises.push(addDoc(collection(db, "notes"), {
                title: aiResponse.case.client || "सामान्य",
                content: aiResponse.case.content,
                client: aiResponse.case.client || "सामान्य",
                mobile: aiResponse.case.mobile || null,
                account: aiResponse.case.account || null,
                address: aiResponse.case.address || null,
                timestamp: now,
                userId: currentUserEmail          // ← User isolation
            }));
            if(window.addActivity) addActivity('📂', 'Client case saved: ' + (aiResponse.case.client || 'General'), '#0891b2');
            addNotif('case', '📂 Client Case updated — ' + (aiResponse.case.client || 'General'), aiResponse.case.mobile ? '📱 ' + aiResponse.case.mobile : 'Case record saved');
            if(window.registerUpdate) registerUpdate('case', aiResponse.case.client || '');
        }

        if (aiResponse.task?.save && aiResponse.task?.title) {
            savePromises.push(addDoc(collection(db, "tasks"), {
                title: aiResponse.task.title,
                status: "Pending",
                client: aiResponse.task.client || "सामान्य",
                timestamp: now,
                userId: currentUserEmail          // ← User isolation
            }));
            if(window.addActivity) addActivity('✅', 'Task created: ' + aiResponse.task.title.substring(0,30), '#d97706');
            addNotif('task', '✅ New Task — ' + aiResponse.task.title.substring(0,45), 'Client: ' + (aiResponse.task.client || 'General'));
            if(window.registerUpdate) registerUpdate('task', aiResponse.task.client || '');
        }

        if (aiResponse.reminder?.save && aiResponse.reminder?.title) {
            const remObj = {
                title: aiResponse.reminder.title,
                time: aiResponse.reminder.time || "जल्द",
                client: aiResponse.reminder.client || "सामान्य",
                timestamp: now,
                userId: currentUserEmail          // ← User isolation
            };
            savePromises.push(addDoc(collection(db, "reminders"), remObj));
            if(window.addActivity) addActivity('⏰', 'Reminder set: ' + aiResponse.reminder.title.substring(0,30), '#dc2626');
            addNotif('reminder', '⏰ Reminder set — ' + aiResponse.reminder.title.substring(0,40), '📅 ' + (aiResponse.reminder.time || 'जल्द'));
            scheduleReminder(remObj);
            if(window.registerUpdate) registerUpdate('reminder', aiResponse.reminder.client || '');
        }

        // ── SOFT DELETE HANDLER ──────────────────────────────────────────
        if (aiResponse.softDelete?.action) {
            const sd = aiResponse.softDelete;
            const colName = sd.collection || '';
            const matchName = (sd.clientName || sd.title || '').toLowerCase().trim();
            if (colName && matchName) {
                try {
                    const qSnap = await getDocs(query(
                        collection(db, colName),
                        where("userId", "==", currentUserEmail)
                    ));
                    const updateJobs = [];
                    qSnap.forEach(d => {
                        const data = d.data();
                        const nameField = (data.client || data.title || '').toLowerCase().trim();
                        if (nameField.includes(matchName) || matchName.includes(nameField)) {
                            updateJobs.push(
                                import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js")
                                .then(({updateDoc, doc: docRef}) =>
                                    updateDoc(docRef(db, colName, d.id), { deleted: true, deletedAt: new Date().toISOString() })
                                )
                            );
                        }
                    });
                    if (updateJobs.length > 0) {
                        await Promise.all(updateJobs);
                        if(window.addActivity) addActivity('🗑️', 'Removed: ' + matchName, '#ef4444');
                        addNotif('case', '🗑️ Removed — ' + matchName, 'Restore ke liye AI se bolo');
                    }
                } catch(err) {
                    console.error('Soft delete error:', err);
                }
            }
        }

        // Save AI reply to chat
        savePromises.push(addDoc(collection(db, "chats"), {
            role: "assistant", content: replyText, timestamp: now,
            userId: currentUserEmail              // ← User isolation
        }));

        await Promise.all(savePromises);

        // ── 6. RENDER AI REPLY — onSnapshot se automatically render hoga
        loadingDiv.remove();
        ui.chatBox.scrollTop = ui.chatBox.scrollHeight;

    } catch (err) {
        loadingDiv.remove();
        const errMsg = `❌ त्रुटि: ${err.message}`;
        await addDoc(collection(db, "chats"), {
            role: "assistant", content: errMsg, timestamp: new Date().toISOString(),
            userId: currentUserEmail
        });
    } finally {
        isProcessing = false;
        ui.userInput.disabled = false;
        sendBtn.disabled = false;
        sendBtn.classList.remove('opacity-50');
        ui.userInput.focus();
    }
}

document.getElementById('send-btn').addEventListener('click', sendMessage);
ui.userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
