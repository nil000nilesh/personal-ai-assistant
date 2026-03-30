// modules/ai.js — GPT-4.1 AI engine, tool calls, message rendering, speech recognition
import { APP, ADMIN_EMAIL, ui } from './state.js';
import { auth, db } from './firebase.js';
import { collection, addDoc, getDocs, query, orderBy, where, doc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { addActivity } from './chat-panel.js';

// ═══════════════════════════════════════════════════════════════
//  REAL AI ENGINE — OpenAI GPT-4o powered sendMessage
// ═══════════════════════════════════════════════════════════════
async function sendMessage() {
    if (APP.isProcessing) return;
    const text = ui.userInput.value.trim();
    if (!text) return;

    APP.isProcessing = true;
    ui.userInput.disabled = true;
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;
    sendBtn.classList.add('opacity-50');
    ui.userInput.value = "";

    APP.chatHistory.push({ role: 'user', content: text });

    await addDoc(collection(db, "chats"), {
        role: "user", content: text, timestamp: new Date().toISOString(),
        userId: APP.currentUserEmail
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
        const ctxQuery = (col) => APP.currentUserRole === 'admin'
            ? getDocs(collection(db, col))
            : getDocs(query(collection(db, col), where("userId", "==", APP.currentUserEmail)));

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
${summarize(casesData, ['client','content','mobile','account','address','timestamp'])}

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

        const systemPrompt = `You are CaseDesk AI — a smart, conversational personal banking assistant and case manager. Think and talk like a real helpful coworker, NOT like a bot. Today: ${today}
User: ${APP.currentUserEmail}

YOUR PERSONALITY:
- Talk like a warm, smart coworker — natural Hinglish (Hindi + English mix)
- Be conversational — ask follow-up questions, suggest things, give opinions
- Be proactive — if you see something useful in data, mention it
- Use emojis naturally but don't overdo it
- NEVER write code, JSON, or technical content in reply field
- Give proper greetings for hi/hello/namaste/good morning/kya haal etc

USER'S SAVED DATA — Search this carefully for every query:
=== CLIENT CASES ===
${clientSummary || 'Koi case data nahi abhi tak'}

=== TASKS ===
${tasksData.filter(t=>!t.deleted).map(t=>`[${t.status||'Pending'}] ${t.title} | Client: ${t.client||'-'} | Due: ${t.dueDate||t.timestamp||'-'}`).join('\n') || 'Koi task nahi'}

=== REMINDERS ===
${remindersData.filter(r=>!r.deleted).map(r=>`[${r.status||'Active'}] ${r.title} | Time: ${r.time} | Client: ${r.client||'-'}`).join('\n') || 'Koi reminder nahi'}

=== NOTEBOOKS ===
${notebookData.filter(n=>!n.deleted).slice(-20).map(n=>`Client: ${n.client||'-'} | ${(n.content||'').substring(0,200)}`).join('\n') || 'Koi notebook entry nahi'}

CONVERSATION RULES — Follow these STRICTLY:

1. NOTES & CLIENT CASES → AUTO-SAVE (bina puche) — PROFESSIONAL BANKING SECRETARY:
   You are a professional banking secretary assistant. When user gives any client note, info, or update, AUTOMATICALLY process it and structure it.

   ═══ NOTE PROCESSING FORMAT ═══
   When saving case.content, structure it EXACTLY like this:

   📋 [CLIENT NAME] — Case Intake Note

   🏢 CLIENT INFORMATION
   Client Name: [extracted name]
   Contact Person(s): [extracted person names with श्री/जी honorifics]
   Account No: [CC/account number if mentioned]
   Mobile: [phone number if mentioned]
   Address: [location if mentioned]
   Status: [current case status — Active/Pending/Processing/Sanctioned/Disbursed/Rejected]

   📝 SECRETARY DRAFT NOTE
   Rewrite the raw note in FORMAL HINDI (Devanagari script), date-wise chronological order.
   Each entry: दिनांक: [DD माह YYYY] | समय: [HH:MM AM/PM]
   Then formal summary using professional secretary language.
   STOP HERE — do NOT add tasks list, reminders list, or pending list inside note content.
   Tasks and reminders must be created as SEPARATE tool calls, NOT written inside this note.

   ═══ WRITING RULES ═══
   - FORMAL SARKARI HINDI: "सूचित किया जाता है", "कार्यवाही प्रारंभ की जाएगी", "अनुमोदन प्रतीक्षित है"
   - Banking/system terms in ENGLISH: CMA, Balance Sheet, P&L, Sanction, Disbursement, Mortgage, CC Account, Tejas, CIBIL
   - Names with RESPECT: "श्री [Name] जी", "[Name] महोदय"
   - Communication: "दूरभाष पर चर्चा संपन्न हुई", "telephonic follow-up किया गया"
   - If date/time missing from note entry → write "Date/Time not specified"
   - DO NOT add any information not present in original note
   - Keep secretary draft FORMAL and CONCISE
   - If multiple date entries exist → process each separately in chronological order
   - Each update = SELF-CONTAINED and readable on its own

   ═══ EXAMPLE NOTE CONTENT (create_note tool — content field only) ═══
   "📋 Paawan Bio Energy — Case Intake Note\n\n🏢 CLIENT INFORMATION\nClient Name: Paawan Bio Energy\nContact Person: श्री Pravin Patidar जी\nCC Account No: 389005/614\nCA Status: Final confirmation pending\n\n📝 SECRETARY DRAFT NOTE\nदिनांक: 28 फरवरी 2026 | समय: 12:28 PM\nमॉर्गेज दस्तावेज़ीकरण कार्य सम्पन्न किया गया एवं ऋण स्वीकृति संबंधित आवश्यक कार्यवाही पूर्ण की गई।\n\nदिनांक: 10 मार्च 2026 | समय: 10:33 AM\nPaawan Bio Energy के संदर्भ में सूचित किया जाता है कि CMA verification हेतु प्रस्तुति भेजी जा चुकी है। Updated CMA एवं Balance Sheet प्राप्त होते ही Tejas प्रणाली में स्वीकृति की कार्यवाही प्रारंभ की जाएगी।"
   ← NOTE: No TASKS section, no REMINDERS section, no PENDING section in note content.
      Those are separate create_task and create_reminder tool calls (see below).

   ═══ FIELD EXTRACTION (CRITICAL) ═══
   • case.client = client/company name (ALWAYS fill — e.g. "Paawan Bio Energy")
   • case.mobile = 10-digit phone number (e.g. "9753332926")
   • case.account = CC/account number (e.g. "389005/614")
   • case.address = address/location (if available)
   • case.status = EXACTLY ONE of: "Active" / "Pending" / "Processing" / "Sanctioned" / "Disbursed" / "Rejected" / "Mortgage"
     → Extract from user's words: "Active hai", "Pending hai", "Sanctioned ho gaya", "Disburse ho gaya" etc.
     → If user mentions "Active" → "Active"; "Pending" → "Pending"; default = "Active"
     → NEVER leave blank — always set one of the 7 values above

   ═══ ALSO AUTO-EXTRACT TASKS & REMINDERS ═══
   - Jab case save karo, content mein se tasks/reminders EXTRACT karo:
     → Action items (document lana, follow-up, process karna) → task.save = true bhi set karo
     → Time-bound items (kal 2 baje call, next week meeting) → reminder.save = true bhi set karo
   - Ek message mein case + task + reminder TEENO simultaneously save ho sakte hain!

   ═══ TOOL CALLING — CRITICAL STRICT RULES ═══

   RULE 1 — create_note: Call ONCE per case.
     • content field = ONLY brief case summary (CLIENT INFORMATION block + SECRETARY DRAFT NOTE paragraph)
     • DO NOT write any task list, reminder list, or pending list inside content
     • WRONG: content has "✅ TASKS\n1. NOC lena\n2. Documents..."
     • CORRECT: content has only "📋 Ramesh Patel — Case Intake Note\n\n🏢 CLIENT INFORMATION\n..."

   RULE 2 — create_task: Call SEPARATELY for EACH individual task.
     • If there are 4 tasks → make 4 separate create_task tool calls
     • Each call has ONE task title only
     • NEVER combine tasks into a single call or write them inside note content
     • WRONG: create_note content = "...TASKS: 1. NOC lena 2. Documents..."
     • CORRECT: create_task(title="SBI se NOC prapt karen"), create_task(title="Documents verify karna"), etc.

   RULE 3 — create_reminder: Call SEPARATELY for EACH deadline/followup.
     • If there are 2 reminders → make 2 separate create_reminder tool calls
     • NEVER write reminders inside note content

   RULE 4 — create_client_profile: Call ONCE with all extracted client details.

   EXECUTION: When user gives raw banking case info → call ALL relevant tools automatically, no permission needed.
   CONFIRMATION: After tool execution, reply: "✅ Case processed! Note save hua, profile create hua, X tasks aur Y reminders set ho gaye."
   SIMPLE QUERIES: For greetings, questions, searches — no tool calls needed, respond via JSON format.

   ═══ NOTEBOOK vs CASE ═══
   - Client personal info + banking/loan updates → case.save = true
   - General notes/observations/non-client content → notebook.save = true
   - BOTH can be true simultaneously

   ═══ AFTER SAVING ═══
   - Reply mein structured summary do in Hinglish (NOT the full draft — just key points)
   - Confirm: "Save ho gaya! ✅"
   - Mention extracted tasks & reminders in reply
   - Agar same client ki pehle se entry hai, naya update add karo (purana mat hatao)

2. TASKS → AUTO-SAVE (bina puche):
   ═══ TASK KYA HOTA HAI? ═══
   - Task = Koi KAAM jo user ko KARNA hai — action item, to-do, checklist item
   - Task mein STATUS hota hai: Pending → Done → Finished
   - Task time-bound bhi ho sakta hai (dueDate), lekin MAIN cheez hai KAM KARNA
   - Examples: "NOC lena", "Documents verify karna", "Client ko call karna", "Form fill karna"
   - Task ka pura hona = user ne kaam kar diya (checkbox tick kiya)

   - Jab user koi kaam bataye ya raw banking info se tasks ban sakte hain → AUTOMATICALLY task.save = true karo
   - Har actionable item ke liye SEPARATE task banao — ek message mein MULTIPLE tasks allowed hain
   - Agar multiple tasks hain → "tasks" array use karo (see JSON format below)
   - Suggest a realistic dueDate based on context (agar user ne date nahi batai)
   - Permission ya confirmation KABHI mat maango — seedha save karo
   - IMPORTANT: task.dueDate MUST be valid ISO 8601 (e.g. "2026-03-15T00:00:00")

3. REMINDERS → AUTO-SAVE (bina puche):
   ═══ REMINDER KYA HOTA HAI? ═══
   - Reminder = Koi YAAD DILAANA — time-bound alert jab koi cheez HONI hai ya YAAD aani chahiye
   - Reminder mein TIME/DEADLINE hota hai — yahi uski main pehchaan hai
   - Reminder ka STATUS hai: Active → Closed (user dismiss kare tab)
   - Examples: "15 March ko court date hai", "Kal 2 baje meeting hai", "Next week tak response chahiye"
   - Reminder app AUTOMATICALLY notification bhejta hai jab deadline aati hai

   ═══ TASK vs REMINDER — CLEAR DISTINCTION ═══
   - "Document lana hai" → TASK (kaam karna hai)
   - "15 March ko document submit karna hai" → TASK + REMINDER dono (kaam bhi + deadline bhi)
   - "Kal 2 baje call karna" → REMINDER (time-bound event/alert)
   - "Follow-up karna" → TASK (kaam)
   - "Next week tak follow-up karna" → REMINDER (specific deadline ke saath)
   - "KCC ka inspection karna" → TASK (action)
   - "30 March ko KCC inspection ki deadline hai" → REMINDER (deadline alert)

   RULE: Agar user ne SPECIFIC DATE/TIME bataya hai → REMINDER bhi banao
         Agar action karna hai bina specific date ke → TASK banao
         Dono ek saath ban sakte hain ek hi message se!

   - Jab user information deta hai jismein date/time-bound actions hain → AUTOMATICALLY reminder.save = true karo
   - Har deadline/follow-up ke liye SEPARATE reminder banao — ek message mein MULTIPLE reminders allowed hain
   - Agar multiple reminders hain → "reminders" array use karo (see JSON format below)
   - Agar user ne time bhi bataya hai (jaise "2 baje", "kal subah", "15 March ko") → ISO 8601 format mein convert karke reminder.time mein daalo
   - Agar user ne time nahi bataya lekin deadline implied hai → reasonable time estimate lagao (e.g., din ki shaam 6 baje)
   - Agar koi time context nahi → time = "Manual" set karo, but STILL save karo
   - Permission ya confirmation KABHI mat maango — seedha save karo
   - IMPORTANT: reminder.time MUST be valid ISO 8601 (e.g. "2026-03-15T14:00:00") ya "Manual"
   - IMPORTANT: NEVER set reminder.time to a date in the past — hamesha future date use karo

4. UPDATE EXISTING DATA:
   - Jab user bole "task update karo / status change karo / timeline badh do / reminder ka time badal do":
     → update.action = true set karo
     → update.collection = "tasks" / "reminders" / "notes" / "notebooks"
     → update.matchTitle = exact title or closest match from saved data
     → update.matchClient = client name to find the right document
     → update.fields = { only fields that need to change }
       For tasks: { status, title, dueDate, priority, client }
       For reminders: { title, time, client, status }
       For notes/notebooks: { content, client, mobile, account, address }
   - After update, confirm: "Update ho gaya! ✅"

5. DELETE REQUEST:
   - Jab user bole "hatao / delete karo / remove karo / band karo":
     → softDelete.action = true
   - Confirm: "Hata diya! 🗑️"

6. FINISH TASK / CLOSE REMINDER:
   - "Task finish karo / complete karo" → update task status to "Finished"
   - "Reminder band karo / close karo" → update reminder status to "Closed"
   - Use update.action for these (NOT softDelete)

7. SEARCH & ANSWER:
   - Jab user puche "kya pending hai / client kahan hai / kya status hai / kitne task hain":
     → Search saved data carefully, give COMPLETE detailed answer
     → Mention overdue items proactively
     → If asked about timelines, calculate from dates in data

8. OUT OF SCOPE:
   - Coding/poem/math/translate/non-banking topics:
     → Reply: "Maafi chahta hoon 🙏 Yeh meri expertise se bahar hai. Main aapka case manager hoon — client cases, tasks, reminders mein madad kar sakta hoon. Kaise help karun? 😊"
     → All save flags = false

9. UPDATES — ALWAYS SAVE AS NEW ENTRY:
   - Jab bhi user kisi existing client ke baare mein NEW information deta hai → ALWAYS case.save = true karo
   - Har update ek ALAG naya document hota hai Firestore mein — purana delete ya merge NAHI hota
   - "Same client ka data already hai" — yeh save karne se NAHI rokta
   - Sirf exact same sentence repeat hone par (copy-paste) hi save mat karo
   - Har naya update: alag timestamp, alag content, same client name → case.save = true HAMESHA
   - Example: Ramesh Patidar ka pehle case bana → ab uska CIBIL score bata rahe ho → PHIR BHI case.save = true

RESPONSE FORMAT — ALWAYS valid JSON only, NO backticks, NO extra text outside JSON:
{
  "reply": "Warm Hinglish response. When saving: give structured summary (client, key update, tasks extracted, reminders set). Confirm with Save ho gaya ✅. Min 2 sentences. NEVER write code/JSON/markdown tables here.",
  "softDelete": { "action": false, "collection": "", "clientName": "", "title": "" },
  "update": { "action": false, "collection": "", "matchTitle": "", "matchClient": "", "fields": {} },
  "notebook": { "save": false, "client": "", "content": "" },
  "case": { "save": false, "client": "", "mobile": null, "account": null, "address": null, "status": "", "content": "" },
  "task": { "save": false, "client": "", "title": "", "dueDate": "", "priority": "" },
  "reminder": { "save": false, "client": "", "title": "", "time": "" },
  "tasks": [],
  "reminders": []
}

MULTIPLE TASKS/REMINDERS:
- For SINGLE task → use "task" field as before
- For MULTIPLE tasks → use "tasks" array: [{"save":true,"client":"Name","title":"Task 1","dueDate":"ISO","priority":"Urgent"},{"save":true,...}]
- For SINGLE reminder → use "reminder" field as before
- For MULTIPLE reminders → use "reminders" array: [{"save":true,"client":"Name","title":"Reminder 1","time":"ISO"},{"save":true,...}]
- When raw banking info comes → ALWAYS use arrays for tasks and reminders (usually 3-6 tasks and 1-3 reminders per case)
- EVERY item in tasks/reminders array MUST have save:true

softDelete.collection = "notes" / "tasks" / "reminders" / "notebooks"
update.collection = "tasks" / "reminders" / "notes" / "notebooks"
update.fields = only include fields that changed
task.dueDate = ISO 8601 format (e.g. "2026-03-15T00:00:00")
task.priority = "Urgent" or "" (empty for normal)
reminder.time = ISO 8601 format or "Manual" or "जल्द"`.trim();

        // ── 3. CALL OPENAI GPT-4o ───────────────────────────────────
        const messages = [
            { role: "system", content: systemPrompt },
            ...APP.chatHistory.slice(-16) // last 16 messages for better conversation context
        ];

        // Helper: convert relative date terms to ISO string
        function resolveDueDate(dateStr) {
            if (!dateStr) return null;
            const s = dateStr.toString().toLowerCase().trim();
            const base = new Date();
            base.setHours(0, 0, 0, 0);
            if (s === 'aaj' || s === 'today') return base.toISOString();
            if (s === 'kal' || s === 'tomorrow') { base.setDate(base.getDate() + 1); return base.toISOString(); }
            if (s.includes('agle hafte') || s.includes('next week')) { base.setDate(base.getDate() + 7); return base.toISOString(); }
            if (s.includes('is week') || s.includes('this week')) {
                const day = base.getDay(); // 0=Sun
                base.setDate(base.getDate() + (7 - day) % 7);
                return base.toISOString();
            }
            const dinMatch = s.match(/(\d+)\s*din/);
            if (dinMatch) { base.setDate(base.getDate() + parseInt(dinMatch[1])); return base.toISOString(); }
            const dayMatch = s.match(/(\d+)\s*day/);
            if (dayMatch) { base.setDate(base.getDate() + parseInt(dayMatch[1])); return base.toISOString(); }
            // If it looks like an ISO date already, return as-is
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return dateStr;
            // Try parsing as a natural date
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) return parsed.toISOString();
            return null;
        }

        // Tool definitions for automatic Firestore writes
        const toolDefinitions = [
            {
                type: "function",
                function: {
                    name: "create_note",
                    description: "Save a structured banking case note to Notebook",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            content: { type: "string", description: "Full structured case summary in Hinglish" },
                            client_name: { type: "string" },
                            product: { type: "string", description: "KCC/TL/CC/AIF/OD etc" },
                            tags: { type: "array", items: { type: "string" } }
                        },
                        required: ["title", "content", "client_name"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "create_client_profile",
                    description: "Create or update a client profile with banking case details",
                    parameters: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            mobile: { type: "string" },
                            address: { type: "string" },
                            product: { type: "string" },
                            limit_amount: { type: "string" },
                            cibil_score: { type: "number" },
                            co_applicant: { type: "string" },
                            land_details: { type: "string" },
                            dob: { type: "string" },
                            status: { type: "string", enum: ["Active", "Pending", "Processing", "Sanctioned", "Disbursed", "Rejected", "Mortgage"] }
                        },
                        required: ["name", "product"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "create_task",
                    description: "Create a single actionable task. Call this ONCE per task — for multiple tasks, call multiple times.",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            client_name: { type: "string" },
                            priority: { type: "string", enum: ["Urgent", "High", "Medium", "Low"] },
                            due_date: { type: "string", description: "ISO 8601 date string" },
                            category: { type: "string", enum: ["document", "inspection", "followup", "sanction", "disbursement", "other"] }
                        },
                        required: ["title", "client_name", "priority"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "create_reminder",
                    description: "Create a dated reminder for follow-up or deadline. Call ONCE per reminder.",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            client_name: { type: "string" },
                            reminder_date: { type: "string", description: "ISO 8601 date string" },
                            type: { type: "string", enum: ["document", "deadline", "followup", "inspection"] }
                        },
                        required: ["title", "client_name", "reminder_date"]
                    }
                }
            }
        ];

        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${APP.DYNAMIC_OPENAI_KEY}`
            },
            body: JSON.stringify({
                model: APP.OPENAI_MODEL,
                messages: messages,
                temperature: 0.4,
                max_tokens: 2500,
                tools: toolDefinitions,
                tool_choice: "auto"
            })
        });

        if (!openaiRes.ok) {
            const errData = await openaiRes.json();
            throw new Error(errData.error?.message || "OpenAI API Error");
        }

        const openaiData = await openaiRes.json();
        const assistantMessage = openaiData.choices[0].message;
        const toolCalls = assistantMessage.tool_calls || [];
        const rawContent = (assistantMessage.content || '').trim();

        // ── 4. PROCESS TOOL CALLS (if any) ────────────────────────────
        const now = new Date().toISOString();
        const savePromises = [];
        let toolCallResults = [];
        let toolSummary = { notes: 0, profiles: 0, tasks: 0, reminders: 0 };

        if (toolCalls.length > 0) {
            for (const tc of toolCalls) {
                let args;
                try { args = JSON.parse(tc.function.arguments); } catch(e) { continue; }
                const fnName = tc.function.name;
                let result = "done";

                if (fnName === 'create_note') {
                    savePromises.push(addDoc(collection(db, "notebooks"), {
                        title: args.client_name || "सामान्य",
                        content: args.content,
                        client: args.client_name || "सामान्य",
                        product: args.product || null,
                        tags: args.tags || [],
                        timestamp: now,
                        userId: APP.currentUserEmail
                    }));
                    toolSummary.notes++;
                    if(window.addActivity) addActivity('📓', 'Notebook saved: ' + (args.client_name || 'General'), '#4f46e5');
                    addNotif('notebook', '📓 Notebook saved — ' + (args.client_name || 'General'), 'AI ne automatically save kiya');
                    if(window.registerUpdate) registerUpdate('notebook', args.client_name || '');
                    result = "Note saved for " + args.client_name;
                }
                else if (fnName === 'create_client_profile') {
                    const profileContent = `📋 ${args.name} — Case Intake Note\n\n🏢 CLIENT INFORMATION\nClient Name: ${args.name}\nProduct: ${args.product || '-'}\nMobile: ${args.mobile || '-'}\nAddress: ${args.address || '-'}\nLimit: ${args.limit_amount || '-'}\nCIBIL: ${args.cibil_score || '-'}\nCo-Applicant: ${args.co_applicant || '-'}\nLand Details: ${args.land_details || '-'}`;
                    savePromises.push(addDoc(collection(db, "notes"), {
                        title: args.name,
                        content: profileContent,
                        client: args.name,
                        mobile: args.mobile || null,
                        account: null,
                        address: args.address || null,
                        status: args.status || "Active",
                        timestamp: now,
                        userId: APP.currentUserEmail
                    }));
                    toolSummary.profiles++;
                    if(window.addActivity) addActivity('📂', 'Client profile saved: ' + args.name, '#0891b2');
                    addNotif('case', '📂 Client Profile — ' + args.name, args.mobile ? '📱 ' + args.mobile : 'Profile saved');
                    if(window.registerUpdate) registerUpdate('case', args.name || '');
                    result = "Profile created for " + args.name;
                }
                else if (fnName === 'create_task') {
                    const taskObj = {
                        title: args.title,
                        status: "Pending",
                        client: args.client_name || "सामान्य",
                        timestamp: now,
                        userId: APP.currentUserEmail
                    };
                    const resolvedDue = resolveDueDate(args.due_date);
                    if(resolvedDue) taskObj.dueDate = resolvedDue;
                    if(args.priority) taskObj.priority = args.priority;
                    if(args.category) taskObj.category = args.category;
                    savePromises.push(addDoc(collection(db, "tasks"), taskObj));
                    APP.allTasks.unshift({ ...taskObj, _docId: '_pending_' + now + '_' + toolSummary.tasks });
                    toolSummary.tasks++;
                    if(window.addActivity) addActivity('✅', 'Task created: ' + args.title.substring(0,30), '#d97706');
                    addNotif('task', '✅ New Task — ' + args.title.substring(0,45), 'Client: ' + (args.client_name || 'General'));
                    if(window.registerUpdate) registerUpdate('task', args.client_name || '');
                    result = "Task created: " + args.title;
                }
                else if (fnName === 'create_reminder') {
                    const remObj = {
                        title: args.title,
                        time: args.reminder_date || "Manual",
                        client: args.client_name || "सामान्य",
                        type: args.type || "followup",
                        timestamp: now,
                        userId: APP.currentUserEmail
                    };
                    savePromises.push(addDoc(collection(db, "reminders"), remObj));
                    APP.allReminders.unshift({ ...remObj, _docId: '_pending_' + now + '_' + toolSummary.reminders });
                    toolSummary.reminders++;
                    if(window.addActivity) addActivity('⏰', 'Reminder set: ' + args.title.substring(0,30), '#dc2626');
                    addNotif('reminder', '⏰ Reminder set — ' + args.title.substring(0,40), '📅 ' + (args.reminder_date || 'Manual'));
                    if(typeof scheduleReminder === 'function') scheduleReminder(remObj);
                    if(window.registerUpdate) registerUpdate('reminder', args.client_name || '');
                    result = "Reminder set: " + args.title;
                }

                toolCallResults.push({ tool_call_id: tc.id, role: "tool", content: result });
            }

            // Re-render UI after tool calls
            if(toolSummary.tasks > 0 && typeof renderTasks === 'function') renderTasks();
            if(toolSummary.reminders > 0 && typeof renderReminders === 'function') renderReminders();
        }

        // ── 4b. GET FINAL TEXT RESPONSE ────────────────────────────
        let replyText;
        if (toolCalls.length > 0 && toolCallResults.length > 0) {
            // Send tool results back to get a final conversational reply
            const followUpMessages = [
                ...messages,
                assistantMessage,
                ...toolCallResults
            ];
            try {
                const followUpRes = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${APP.DYNAMIC_OPENAI_KEY}` },
                    body: JSON.stringify({ model: APP.OPENAI_MODEL, messages: followUpMessages, temperature: 0.4, max_tokens: 800 })
                });
                if (followUpRes.ok) {
                    const followUpData = await followUpRes.json();
                    const followUpContent = (followUpData.choices[0].message.content || '').trim();
                    // Try parsing as JSON (existing format), else use as plain text
                    try {
                        const clean = followUpContent.replace(/```json|```/g, '').trim();
                        const parsed = JSON.parse(clean);
                        replyText = parsed.reply || followUpContent;
                    } catch(e) {
                        replyText = followUpContent;
                    }
                } else {
                    // Fallback confirmation
                    const parts = [];
                    if(toolSummary.notes > 0) parts.push(`${toolSummary.notes} note saved`);
                    if(toolSummary.profiles > 0) parts.push(`${toolSummary.profiles} profile created`);
                    if(toolSummary.tasks > 0) parts.push(`${toolSummary.tasks} tasks created`);
                    if(toolSummary.reminders > 0) parts.push(`${toolSummary.reminders} reminders set`);
                    replyText = `✅ Case processed: ${parts.join(', ')}`;
                }
            } catch(e) {
                const parts = [];
                if(toolSummary.notes > 0) parts.push(`${toolSummary.notes} note saved`);
                if(toolSummary.profiles > 0) parts.push(`${toolSummary.profiles} profile created`);
                if(toolSummary.tasks > 0) parts.push(`${toolSummary.tasks} tasks created`);
                if(toolSummary.reminders > 0) parts.push(`${toolSummary.reminders} reminders set`);
                replyText = `✅ Case processed: ${parts.join(', ')}`;
            }
        } else {
            // No tool calls — parse JSON response as before
            let aiResponse;
            try {
                const clean = rawContent.replace(/```json|```/g, '').trim();
                aiResponse = JSON.parse(clean);
            } catch(e) {
                aiResponse = { reply: rawContent, notebook: { save: false }, case: { save: false }, task: { save: false }, reminder: { save: false }, tasks: [], reminders: [], update: { action: false }, softDelete: { action: false } };
            }
            replyText = aiResponse.reply || "कार्य सम्पन्न हुआ।";

            // ── 5. SAVE TO FIREBASE BASED ON AI JSON DECISION ───────────────

        if (aiResponse.notebook?.save && aiResponse.notebook?.content) {
            savePromises.push(addDoc(collection(db, "notebooks"), {
                title: aiResponse.notebook.client || "सामान्य",
                content: aiResponse.notebook.content,
                client: aiResponse.notebook.client || "सामान्य",
                timestamp: now,
                userId: APP.currentUserEmail          // ← User isolation
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
                status: aiResponse.case.status || null,   // ← explicit status field
                timestamp: now,
                userId: APP.currentUserEmail          // ← User isolation
            }));
            if(window.addActivity) addActivity('📂', 'Client case saved: ' + (aiResponse.case.client || 'General'), '#0891b2');
            addNotif('case', '📂 Client Case updated — ' + (aiResponse.case.client || 'General'), aiResponse.case.mobile ? '📱 ' + aiResponse.case.mobile : 'Case record saved');
            if(window.registerUpdate) registerUpdate('case', aiResponse.case.client || '');
        }

        if (aiResponse.task?.save && aiResponse.task?.title) {
            const taskObj = {
                title: aiResponse.task.title,
                status: "Pending",
                client: aiResponse.task.client || "सामान्य",
                timestamp: now,
                userId: APP.currentUserEmail
            };
            if(aiResponse.task.dueDate) taskObj.dueDate = aiResponse.task.dueDate;
            if(aiResponse.task.priority) taskObj.priority = aiResponse.task.priority;
            const taskDocRef = addDoc(collection(db, "tasks"), taskObj);
            savePromises.push(taskDocRef);
            // Optimistic local push — onSnapshot will sync shortly
            APP.allTasks.unshift({ ...taskObj, _docId: '_pending_' + now });
            if(typeof renderTasks === 'function') renderTasks();
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
                userId: APP.currentUserEmail
            };
            savePromises.push(addDoc(collection(db, "reminders"), remObj));
            APP.allReminders.unshift({ ...remObj, _docId: '_pending_' + now });
            if(typeof renderReminders === 'function') renderReminders();
            if(window.addActivity) addActivity('⏰', 'Reminder set: ' + aiResponse.reminder.title.substring(0,30), '#dc2626');
            addNotif('reminder', '⏰ Reminder set — ' + aiResponse.reminder.title.substring(0,40), '📅 ' + (aiResponse.reminder.time || 'जल्द'));
            scheduleReminder(remObj);
            if(window.registerUpdate) registerUpdate('reminder', aiResponse.reminder.client || '');
        }

        // ── MULTIPLE TASKS ARRAY HANDLER ─────────────────────────────────
        if (Array.isArray(aiResponse.tasks) && aiResponse.tasks.length > 0) {
            aiResponse.tasks.forEach((t, idx) => {
                if(!t.save || !t.title) return;
                const taskObj = {
                    title: t.title,
                    status: "Pending",
                    client: t.client || "सामान्य",
                    timestamp: now,
                    userId: APP.currentUserEmail
                };
                const resolvedTDue = resolveDueDate(t.dueDate);
                if(resolvedTDue) taskObj.dueDate = resolvedTDue;
                if(t.priority) taskObj.priority = t.priority;
                savePromises.push(addDoc(collection(db, "tasks"), taskObj));
                APP.allTasks.unshift({ ...taskObj, _docId: '_pending_' + now + '_' + idx });
                if(window.addActivity) addActivity('✅', 'Task created: ' + t.title.substring(0,30), '#d97706');
                addNotif('task', '✅ New Task — ' + t.title.substring(0,45), 'Client: ' + (t.client || 'General'));
                if(window.registerUpdate) registerUpdate('task', t.client || '');
            });
            if(typeof renderTasks === 'function') renderTasks();
        }

        // ── MULTIPLE REMINDERS ARRAY HANDLER ─────────────────────────────
        if (Array.isArray(aiResponse.reminders) && aiResponse.reminders.length > 0) {
            aiResponse.reminders.forEach((r, idx) => {
                if(!r.save || !r.title) return;
                const remObj = {
                    title: r.title,
                    time: r.time || "Manual",
                    client: r.client || "सामान्य",
                    timestamp: now,
                    userId: APP.currentUserEmail
                };
                savePromises.push(addDoc(collection(db, "reminders"), remObj));
                APP.allReminders.unshift({ ...remObj, _docId: '_pending_' + now + '_' + idx });
                if(window.addActivity) addActivity('⏰', 'Reminder set: ' + r.title.substring(0,30), '#dc2626');
                addNotif('reminder', '⏰ Reminder set — ' + r.title.substring(0,40), '📅 ' + (r.time || 'Manual'));
                if(typeof scheduleReminder === 'function') scheduleReminder(remObj);
                if(window.registerUpdate) registerUpdate('reminder', r.client || '');
            });
            if(typeof renderReminders === 'function') renderReminders();
        }

        // ── UPDATE HANDLER — Update existing tasks/reminders/notes/notebooks ─
        if (aiResponse.update?.action) {
            const upd = aiResponse.update;
            const colName = upd.collection || '';
            const matchTitle = (upd.matchTitle || '').toLowerCase().trim();
            const matchClient = (upd.matchClient || '').toLowerCase().trim();
            if (colName && (matchTitle || matchClient)) {
                try {
                    const qSnap = await getDocs(query(
                        collection(db, colName),
                        where("userId", "==", APP.currentUserEmail)
                    ));
                    let bestMatch = null;
                    let bestScore = 0;
                    qSnap.forEach(d => {
                        const data = d.data();
                        if(data.deleted) return;
                        const docTitle = (data.title || '').toLowerCase().trim();
                        const docClient = (data.client || '').toLowerCase().trim();
                        let score = 0;
                        if(matchTitle && (docTitle.includes(matchTitle) || matchTitle.includes(docTitle))) score += 2;
                        if(matchClient && (docClient.includes(matchClient) || matchClient.includes(docClient))) score += 1;
                        if(score > bestScore) { bestScore = score; bestMatch = d; }
                    });
                    if(bestMatch && upd.fields && Object.keys(upd.fields).length > 0) {
                        await updateDoc(doc(db, colName, bestMatch.id), upd.fields);
                        if(window.addActivity) addActivity('📝', 'Updated: ' + (matchTitle || matchClient), '#2563eb');
                        addNotif('task', '📝 Updated — ' + (matchTitle || matchClient), 'AI ne update kiya');
                    }
                } catch(err) {
                    console.error('Update error:', err);
                    if(window.addNotif) addNotif('error', '❌ Update failed', err.message || 'Update mein error aaya');
                }
            }
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
                        where("userId", "==", APP.currentUserEmail)
                    ));
                    const updateJobs = [];
                    qSnap.forEach(d => {
                        const data = d.data();
                        if(data.deleted) return;
                        const nameField = (data.client || data.title || '').toLowerCase().trim();
                        if (nameField.includes(matchName) || matchName.includes(nameField)) {
                            updateJobs.push(
                                updateDoc(doc(db, colName, d.id), { deleted: true, deletedAt: new Date().toISOString() })
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
                    if(window.addNotif) addNotif('error', '❌ Delete failed', err.message || 'Delete mein error aaya');
                }
            }
        }

        } // ← close else block (no tool calls — JSON path)

        APP.chatHistory.push({ role: 'assistant', content: replyText });

        // Save AI reply to chat
        savePromises.push(addDoc(collection(db, "chats"), {
            role: "assistant", content: replyText, timestamp: now,
            userId: APP.currentUserEmail              // ← User isolation
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
            userId: APP.currentUserEmail
        });
    } finally {
        APP.isProcessing = false;
        ui.userInput.disabled = false;
        sendBtn.disabled = false;
        sendBtn.classList.remove('opacity-50');
        ui.userInput.focus();
    }
}

document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('user-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
    // Shift+Enter = default behavior (newline in textarea)
});
// Auto-resize textarea as user types
document.getElementById('user-input').addEventListener('input', () => {
    const el = document.getElementById('user-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 80) + 'px';
});





// ╔══════════════════════════════════════════════════════════════╗
// ║  TASK / REMINDER DETAIL POPUP                                ║
// ╚══════════════════════════════════════════════════════════════╝

window.closeItemDetailPopup = function() {
    document.getElementById('item-detail-popup').classList.add('hidden');
};

window.showItemDetailPopup = function(item, type) {
    const popup  = document.getElementById('item-detail-popup');
    const header = document.getElementById('item-detail-header');
    const body   = document.getElementById('item-detail-body');
    const actions= document.getElementById('item-detail-actions');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isTask = type === 'task';

    const isOverdue = isTask
        ? (item.dueDate ? new Date(item.dueDate) : new Date(item.timestamp)) < todayStart && item.status !== 'Done' && item.status !== 'Finished'
        : (item.time && item.time !== 'Manual' && item.time !== 'जल्द' && new Date(item.time) < now && item.status !== 'Closed');

    const grad = isTask
        ? (isOverdue ? 'linear-gradient(135deg,#dc2626,#ef4444)' : 'linear-gradient(135deg,#f59e0b,#f97316)')
        : (isOverdue ? 'linear-gradient(135deg,#dc2626,#ef4444)' : 'linear-gradient(135deg,#7c3aed,#6366f1)');

    const icon = isTask ? '✅' : '⏰';
    const typeLabel = isTask ? 'Task' : 'Reminder';
    const statusBadge = isTask
        ? (item.status === 'Done' ? '✅ Done' : item.status === 'Finished' ? '🏆 Finished' : isOverdue ? '🔴 Overdue' : '⏳ Pending')
        : (item.status === 'Closed' ? '✅ Closed' : isOverdue ? '🔴 Overdue' : '🟢 Active');

    header.style.cssText = 'background:' + grad + ';padding:20px;position:relative;overflow:hidden;';
    header.innerHTML = `
        <div style="position:absolute;right:-16px;top:-16px;width:70px;height:70px;background:rgba(255,255,255,0.08);border-radius:50%;"></div>
        <div style="display:flex;align-items:flex-start;gap:12px;position:relative;">
            <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${icon}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:9px;font-weight:900;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">${typeLabel}</div>
                <div style="font-weight:900;font-size:16px;color:white;line-height:1.3;">${item.title || 'Untitled'}</div>
                <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:9px;font-weight:900;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,0.2);color:white;">${statusBadge}</span>
                    ${item.client ? '<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.9);">👤 '+item.client+'</span>' : ''}
                </div>
            </div>
            <button onclick="closeItemDetailPopup()" style="width:28px;height:28px;background:rgba(255,255,255,0.15);border:none;border-radius:8px;cursor:pointer;color:white;font-size:14px;flex-shrink:0;">✕</button>
        </div>`;

    // Body details
    const rows = [];
    if(isTask) {
        if(item.dueDate) rows.push(['📅 Due Date', new Date(item.dueDate).toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'long',year:'numeric'})]);
        if(item.priority) rows.push(['🚨 Priority', item.priority]);
        rows.push(['📋 Status', item.status || 'Pending']);
        rows.push(['🕐 Created', new Date(item.timestamp).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})]);
    } else {
        if(item.time && item.time !== 'Manual' && item.time !== 'जल्द') {
            const d = new Date(item.time);
            rows.push(['⏰ Scheduled', isNaN(d) ? item.time : d.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'long'}) + ' · ' + d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})]);
        } else {
            rows.push(['⏰ Time', item.time || 'Not set']);
        }
        rows.push(['📋 Status', item.status || 'Active']);
        rows.push(['🕐 Created', new Date(item.timestamp||Date.now()).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})]);
    }

    body.innerHTML = rows.map(([label, val]) =>
        `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:11px;font-weight:700;color:#94a3b8;min-width:100px;">${label}</span>
            <span style="font-size:12px;font-weight:600;color:#334155;">${val}</span>
        </div>`
    ).join('');

    // Action buttons
    actions.innerHTML = '';
    if(isTask && item._docId && item.status !== 'Done' && item.status !== 'Finished') {
        const doneBtn = document.createElement('button');
        doneBtn.style.cssText = 'flex:1;padding:12px;border-radius:14px;background:linear-gradient(135deg,#10b981,#059669);color:white;font-weight:800;font-size:13px;border:none;cursor:pointer;';
        doneBtn.textContent = '✅ Mark Done';
        doneBtn.onclick = async () => {
            item.status = 'Done';
            try { await updateDoc(doc(db, 'tasks', item._docId), { status: 'Done' }); } catch(e) {}
            closeItemDetailPopup();
        };
        actions.appendChild(doneBtn);
    }
    if(!isTask && item._docId && item.status !== 'Closed') {
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'flex:1;padding:12px;border-radius:14px;background:linear-gradient(135deg,#10b981,#059669);color:white;font-weight:800;font-size:13px;border:none;cursor:pointer;';
        closeBtn.textContent = '✅ Mark Closed';
        closeBtn.onclick = async () => {
            item.status = 'Closed';
            try { await updateDoc(doc(db, 'reminders', item._docId), { status: 'Closed' }); } catch(e) {}
            closeItemDetailPopup();
        };
        actions.appendChild(closeBtn);
    }
    const dismissBtn = document.createElement('button');
    dismissBtn.style.cssText = 'flex:1;padding:12px;border-radius:14px;background:#f1f5f9;color:#475569;font-weight:700;font-size:13px;border:none;cursor:pointer;';
    dismissBtn.textContent = '✕ Dismiss';
    dismissBtn.onclick = closeItemDetailPopup;
    actions.appendChild(dismissBtn);

    popup.classList.remove('hidden');
};

// ╔══════════════════════════════════════════════════════════════╗
// ║  CLIENT DETAIL POPUP + CLIENT LIST                           ║
// ╚══════════════════════════════════════════════════════════════╝

window.closeClientDetailPopup = function() {
    document.getElementById('client-detail-popup').classList.add('hidden');
};

window.showClientDetailPopup = function(clientName) {
    const popup   = document.getElementById('client-detail-popup');
    const content = document.getElementById('client-detail-content');
    const key = clientName.toUpperCase();
    const group = APP.allGroupedNotes[key];
    if(!group) return;

    const pal = (window._getCardPalette || (n => ({ grad:'linear-gradient(135deg,#6366f1,#3b82f6)', border:'#6366f1', light:'#ede9fe', text:'#4f46e5' })))(group.displayTitle);
    const sortedUpdates = [...group.updates].sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
    const latestUpdate = sortedUpdates[0];
    const initials = group.displayTitle.split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'?';

    function fmtD(ts) { return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
    function fmtT(ts) { return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }

    const infoRows = [];
    if(group.mobile)  infoRows.push(['📱 Mobile',  group.mobile]);
    if(group.account) infoRows.push(['🏦 Account', group.account]);
    if(group.address) infoRows.push(['📍 Address', group.address]);
    infoRows.push(['📋 Updates', group.updates.length]);
    infoRows.push(['🕐 Last Updated', fmtD(latestUpdate.timestamp)]);

    const updatesHTML = sortedUpdates.map((u,idx) => {
        const isLatest = idx === 0;
        return `<div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;last-child:border-bottom:none;${isLatest?'background:'+pal.light+'30;':''}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
                <span style="font-size:9px;font-weight:900;padding:2px 8px;border-radius:20px;${isLatest?'background:'+pal.light+';color:'+pal.text+';':'background:#f1f5f9;color:#64748b;'}">📅 ${fmtD(u.timestamp)} ⏰ ${fmtT(u.timestamp)}</span>
                ${isLatest ? '<span style="font-size:8px;font-weight:900;color:white;padding:2px 8px;border-radius:20px;background:'+pal.border+';">LATEST</span>' : ''}
                <span style="font-size:9px;color:#cbd5e1;margin-left:auto;">#${sortedUpdates.length-idx}</span>
            </div>
            <p style="font-size:13px;color:#334155;font-weight:500;white-space:pre-wrap;margin:0;line-height:1.6;" class="devanagari">${u.content||''}</p>
        </div>`;
    }).join('');

    content.innerHTML = `
        <div style="background:${pal.grad};padding:18px 20px 14px;position:relative;overflow:hidden;flex-shrink:0;">
            <div style="position:absolute;right:-20px;top:-20px;width:80px;height:80px;background:rgba(255,255,255,0.08);border-radius:50%;"></div>
            <div style="display:flex;align-items:flex-start;gap:12px;position:relative;">
                <div style="width:48px;height:48px;background:rgba(255,255,255,0.22);border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;color:white;border:1.5px solid rgba(255,255,255,0.3);flex-shrink:0;">${initials}</div>
                <div style="flex:1;">
                    <div style="font-size:9px;font-weight:900;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">👤 CLIENT PROFILE</div>
                    <div style="font-weight:900;font-size:18px;color:white;line-height:1.2;">${group.displayTitle}</div>
                </div>
                <button onclick="closeClientDetailPopup()" style="width:30px;height:30px;background:rgba(255,255,255,0.15);border:none;border-radius:9px;cursor:pointer;color:white;font-size:15px;flex-shrink:0;">✕</button>
            </div>
        </div>
        <div style="background:#f8fafc;border-left:4px solid ${pal.border};padding:10px 16px;">
            ${infoRows.map(([l,v])=>`<div style="display:flex;align-items:center;gap:10px;padding:4px 0;border-bottom:1px solid #f1f5f9;"><span style="font-size:10px;font-weight:700;color:#94a3b8;min-width:110px;">${l}</span><span style="font-size:11px;font-weight:600;color:#334155;">${v}</span></div>`).join('')}
        </div>
        <div style="overflow-y:auto;max-height:50vh;">${updatesHTML}</div>`;
    popup.classList.remove('hidden');
};

window.openClientListPopup = function() {
    const popup = document.getElementById('client-list-popup');
    const body  = document.getElementById('client-list-body');
    const count = document.getElementById('client-list-count');
    const entries = Object.values(APP.allGroupedNotes);
    if(count) count.textContent = entries.length + ' client' + (entries.length !== 1 ? 's' : '');
    renderClientList(entries, body);
    popup.classList.remove('hidden');
};

window.closeClientListPopup = function() {
    document.getElementById('client-list-popup').classList.add('hidden');
};

function renderClientList(entries, body) {
    body.innerHTML = '';
    if(entries.length === 0) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">No clients found</div>';
        return;
    }
    const sorted = [...entries].sort((a,b) => {
        const aT = Math.max(...a.updates.map(u => new Date(u.timestamp)));
        const bT = Math.max(...b.updates.map(u => new Date(u.timestamp)));
        return bT - aT;
    });
    sorted.forEach((group, idx) => {
        const pal = (window._getCardPalette || (n => ({ border:'#6366f1', light:'#ede9fe', text:'#4f46e5' })))(group.displayTitle);
        const initials = group.displayTitle.split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'?';
        const latest = [...group.updates].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''))[0];
        const latestDate = new Date(latest?.timestamp||Date.now()).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 8px;border-radius:12px;cursor:pointer;transition:background 0.15s;border-bottom:1px solid #f8fafc;';
        row.innerHTML = `
            <div style="width:38px;height:38px;border-radius:12px;background:${pal.light};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;color:${pal.text};border:2px solid ${pal.border}20;flex-shrink:0;">${initials}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:800;font-size:13px;color:#0f172a;margin-bottom:2px;">${group.displayTitle}</div>
                <div style="font-size:10px;color:#94a3b8;font-weight:600;">${group.updates.length} update${group.updates.length>1?'s':''} · ${latestDate}</div>
            </div>
            ${group.mobile ? '<div style="font-size:10px;font-weight:700;color:#64748b;">📱 '+group.mobile+'</div>' : ''}
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#cbd5e1" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`;
        row.onmouseenter = () => row.style.background = '#f8fafc';
        row.onmouseleave = () => row.style.background = '';
        row.onclick = () => {
            closeClientListPopup();
            setTimeout(() => showClientDetailPopup(group.displayTitle), 100);
        };
        body.appendChild(row);
    });
}

window.filterClientList = function(q) {
    const entries = Object.values(APP.allGroupedNotes).filter(g =>
        g.displayTitle.toLowerCase().includes(q.toLowerCase()) ||
        (g.mobile||'').includes(q)
    );
    renderClientList(entries, document.getElementById('client-list-body'));
};

// ╔══════════════════════════════════════════════════════════════╗
// ║  FOCUS MODE — Full-screen read popup for any card            ║
// ╚══════════════════════════════════════════════════════════════╝

window.openFocusMode = function(type, data) {
    const popup   = document.getElementById('focus-popup');
    const body    = document.getElementById('focus-body');
    if(!popup || !body) return;

    const PALETTES = [
        { grad:'linear-gradient(135deg,#6366f1,#8b5cf6)', border:'#6366f1', light:'#ede9fe', text:'#4f46e5' },
        { grad:'linear-gradient(135deg,#0891b2,#2563eb)', border:'#0891b2', light:'#cffafe', text:'#0e7490' },
        { grad:'linear-gradient(135deg,#059669,#0d9488)', border:'#059669', light:'#d1fae5', text:'#047857' },
        { grad:'linear-gradient(135deg,#dc2626,#db2777)', border:'#dc2626', light:'#fee2e2', text:'#b91c1c' },
        { grad:'linear-gradient(135deg,#d97706,#f59e0b)', border:'#d97706', light:'#fef3c7', text:'#b45309' },
        { grad:'linear-gradient(135deg,#7c3aed,#a855f7)', border:'#7c3aed', light:'#f3e8ff', text:'#6d28d9' },
        { grad:'linear-gradient(135deg,#0f766e,#065f46)', border:'#0f766e', light:'#ccfbf1', text:'#0f766e' },
        { grad:'linear-gradient(135deg,#be185d,#9d174d)', border:'#be185d', light:'#fce7f3', text:'#be185d' },
    ];
    function getPal(name) {
        const h = (name||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0);
        return PALETTES[h % PALETTES.length];
    }
    function fmt(ts) {
        if(!ts) return '';
        const d = new Date(ts);
        return isNaN(d) ? ts : d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) + ' ' + d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
    }
    function esc(str) {
        const div = document.createElement('div'); div.textContent = str||''; return div.innerHTML;
    }

    body.innerHTML = '';
    let html = '';

    if(type === 'client') {
        // data = group object { displayTitle, mobile, account, address, updates[] }
        const pal = getPal(data.displayTitle);
        const words = (data.displayTitle||'').trim().split(/\s+/);
        const initials = ((words[0]?.[0]||'') + (words[1]?.[0]||'')).toUpperCase();
        const sorted = [...(data.updates||[])].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
        html = `
        <div style="background:${pal.grad};padding:24px 24px 20px;position:relative;overflow:hidden;">
            <div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.07);"></div>
            <div style="display:flex;align-items:center;gap:14px;">
                <div style="width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.22);border:2px solid rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff;flex-shrink:0;">${esc(initials)||'?'}</div>
                <div>
                    <div style="font-size:10px;font-weight:800;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">👤 CLIENT PROFILE</div>
                    <div style="font-size:20px;font-weight:900;color:#fff;">${esc(data.displayTitle)}</div>
                    ${data.mobile ? `<div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:3px;">📞 ${esc(data.mobile)}</div>` : ''}
                </div>
            </div>
            ${data.account ? `<div style="margin-top:10px;font-size:11px;font-weight:700;color:rgba(255,255,255,.7);">🏦 Account: ${esc(data.account)}</div>` : ''}
            ${data.address ? `<div style="margin-top:4px;font-size:11px;font-weight:700;color:rgba(255,255,255,.7);">📍 ${esc(data.address)}</div>` : ''}
        </div>
        <div style="padding:16px 20px;background:#f8fafc;">
            <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">📋 All Updates (${sorted.length})</div>
            ${sorted.map((u,i) => `
                <div style="background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:8px;border-left:3px solid ${pal.border};box-shadow:0 1px 6px rgba(0,0,0,.05);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                        <span style="font-size:9px;font-weight:900;background:${pal.light};color:${pal.text};padding:2px 8px;border-radius:6px;">${i===0?'✨ Latest':'#'+(sorted.length-i)}</span>
                        <span style="font-size:10px;color:#94a3b8;">${fmt(u.timestamp)}</span>
                    </div>
                    <div style="font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;word-break:break-word;">${esc(u.content||u.info||u.updates||'')}</div>
                </div>`).join('')}
        </div>`;

    } else if(type === 'task') {
        // data = task object
        const isDone = data.status === 'Done' || data.status === 'Finished';
        const grad = isDone ? 'linear-gradient(135deg,#059669,#0d9488)' : data.priority === 'Urgent' ? 'linear-gradient(135deg,#dc2626,#db2777)' : 'linear-gradient(135deg,#f59e0b,#d97706)';
        const d = new Date(data.timestamp);
        const dateStr = isNaN(d) ? '' : d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
        const timeStr = isNaN(d) ? '' : d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
        html = `
        <div style="background:${grad};padding:24px 24px 20px;position:relative;overflow:hidden;">
            <div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.07);"></div>
            <div style="font-size:10px;font-weight:800;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">✅ TASK</div>
            <div style="font-size:20px;font-weight:900;color:#fff;line-height:1.35;">${esc(data.title)}</div>
            <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">
                <span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">${isDone ? '✅ '+data.status : '⏳ '+data.status}</span>
                ${data.priority === 'Urgent' ? '<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">🚨 URGENT</span>' : ''}
                ${data.dueDate ? `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">📅 Due: ${new Date(data.dueDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span>` : ''}
            </div>
        </div>
        <div style="padding:20px 24px;">
            ${data.client ? `<div style="margin-bottom:14px;padding:12px 16px;background:#eff6ff;border-radius:12px;border-left:3px solid #3b82f6;"><span style="font-size:11px;font-weight:700;color:#1d4ed8;">👤 Client: ${esc(data.client)}</span></div>` : ''}
            ${data.notes ? `<div style="margin-bottom:14px;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📝 Notes</div><div style="font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;">${esc(data.notes)}</div></div>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                <span style="font-size:11px;color:#94a3b8;">🕐 Created: ${dateStr} ${timeStr}</span>
                ${data.finishedAt ? `<span style="font-size:11px;color:#059669;">🏁 Finished: ${fmt(data.finishedAt)}</span>` : ''}
            </div>
        </div>`;

    } else if(type === 'reminder') {
        // data = reminder object
        const remDate = data.time && data.time !== 'Manual' && data.time !== 'जल्द' ? new Date(data.time) : null;
        const isClosed = data.status === 'Closed';
        const isOverdue = !isClosed && remDate && remDate < new Date();
        const isToday = !isClosed && remDate && remDate.toDateString() === new Date().toDateString();
        const grad = isClosed ? 'linear-gradient(135deg,#059669,#0d9488)' : isOverdue ? 'linear-gradient(135deg,#dc2626,#db2777)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)';
        const timeLabel = isClosed ? '🏁 Closed' : isOverdue ? '🔴 Overdue' : isToday ? '🟠 Today' : '⏰ Upcoming';
        let daysInfo = '';
        if(remDate && !isClosed) {
            const diff = Math.ceil((remDate - new Date()) / (1000*60*60*24));
            if(isOverdue) daysInfo = `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">${Math.abs(diff)}d overdue</span>`;
            else if(diff === 0) daysInfo = `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">Due Today!</span>`;
            else daysInfo = `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">in ${diff} day${diff!==1?'s':''}</span>`;
        }
        const remDocId = data._docId || '';
        html = `
        <div style="background:${grad};padding:24px 24px 20px;position:relative;overflow:hidden;">
            <div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.07);"></div>
            <div style="font-size:10px;font-weight:800;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">⏰ REMINDER</div>
            <div style="font-size:20px;font-weight:900;color:#fff;line-height:1.35;">${esc(data.title)}</div>
            <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">
                <span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">${timeLabel}</span>
                ${remDate && !isNaN(remDate) ? `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;">⏰ Deadline: ${remDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}${remDate.getHours()||remDate.getMinutes() ? ' · '+remDate.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}) : ''}</span>` : ''}
                ${daysInfo}
            </div>
        </div>
        <div style="padding:20px 24px;">
            ${data.client ? `<div style="margin-bottom:14px;padding:12px 16px;background:#eff6ff;border-radius:12px;border-left:3px solid #3b82f6;"><span style="font-size:11px;font-weight:700;color:#1d4ed8;">👤 Client: ${esc(data.client)}</span></div>` : ''}
            ${data.type ? `<div style="margin-bottom:10px;"><span style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;">Type: </span><span style="font-size:11px;font-weight:700;color:#334155;">${esc(data.type)}</span></div>` : ''}
            ${data.description||data.notes ? `<div style="margin-bottom:14px;"><div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📝 Details</div><div style="font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;">${esc(data.description||data.notes)}</div></div>` : ''}
            ${data.finishedAt ? `<div style="font-size:11px;color:#059669;margin-bottom:8px;">🏁 Closed: ${fmt(data.finishedAt)}</div>` : ''}
            <div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">🕐 Created: ${fmt(data.timestamp)}</div>
            ${!isClosed ? `<div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button id="fm-close-rem-btn" style="flex:1;min-width:120px;padding:12px 16px;border-radius:14px;background:linear-gradient(135deg,#10b981,#059669);color:white;font-weight:800;font-size:13px;border:none;cursor:pointer;">✅ Close Reminder</button>
                ${isOverdue ? `<button id="fm-snooze-rem-btn" style="flex:1;min-width:120px;padding:12px 16px;border-radius:14px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;font-weight:800;font-size:13px;border:none;cursor:pointer;">⏩ Snooze 1 Day</button>` : ''}
            </div>` : ''}
        </div>`;

    } else if(type === 'notebook') {
        // data = notebook group { displayName, updates[] }
        const pal = getPal(data.displayName);
        const sorted = [...(data.updates||[])].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
        html = `
        <div style="background:${pal.grad};padding:24px 24px 20px;position:relative;overflow:hidden;">
            <div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.07);"></div>
            <div style="font-size:10px;font-weight:800;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">📓 NOTEBOOK</div>
            <div style="font-size:20px;font-weight:900;color:#fff;">${esc(data.displayName)}</div>
            <div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,.7);">${sorted.length} page${sorted.length!==1?'s':''}</div>
        </div>
        <div style="padding:16px 20px;background:#f8fafc;">
            ${sorted.map((u,i) => `
                <div style="background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:8px;border-left:3px solid ${pal.border};box-shadow:0 1px 6px rgba(0,0,0,.05);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <span style="font-size:9px;font-weight:900;background:${pal.light};color:${pal.text};padding:2px 8px;border-radius:6px;">${i===0?'✨ Latest':'Page '+(sorted.length-i)}</span>
                        <span style="font-size:10px;color:#94a3b8;">${fmt(u.timestamp)}</span>
                    </div>
                    <div style="font-size:13px;color:#374151;line-height:1.75;white-space:pre-wrap;word-break:break-word;">${esc(u.content||u.info||'')}</div>
                </div>`).join('')}
        </div>`;
    }

    body.innerHTML = html;
    popup.classList.remove('hidden');
    document.addEventListener('keydown', _focusEscHandler);

    // Focus mode reminder action buttons
    const fmCloseBtn = document.getElementById('fm-close-rem-btn');
    if(fmCloseBtn && type === 'reminder' && data._docId && !data._docId.startsWith('_pending_')) {
        fmCloseBtn.addEventListener('click', async () => {
            const finishedAt = new Date().toISOString();
            data.status = 'Closed';
            data.finishedAt = finishedAt;
            closeFocusMode();
            renderReminders();
            try { await updateDoc(doc(db, 'reminders', data._docId), { status: 'Closed', finishedAt }); } catch(e) {}
        });
    }
    const fmSnoozeBtn = document.getElementById('fm-snooze-rem-btn');
    if(fmSnoozeBtn && type === 'reminder' && data._docId && !data._docId.startsWith('_pending_')) {
        fmSnoozeBtn.addEventListener('click', async () => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            const newTime = tomorrow.toISOString();
            data.time = newTime;
            closeFocusMode();
            renderReminders();
            try {
                await updateDoc(doc(db, 'reminders', data._docId), { time: newTime });
                if(window.scheduleReminder) scheduleReminder(data);
            } catch(e) {}
        });
    }
};

function _focusEscHandler(e) {
    if(e.key === 'Escape') closeFocusMode();
}

window.closeFocusMode = function() {
    document.getElementById('focus-popup')?.classList.add('hidden');
    document.removeEventListener('keydown', _focusEscHandler);
};

// ╔══════════════════════════════════════════════════════════════╗
// ║  PAGE VISIT BADGE CLEARING (Update Panel Removed)            ║
// ╚══════════════════════════════════════════════════════════════╝

const PAGE_MAP = {
    notebook: 'notebook',
    case:     'notes',
    task:     'tasks',
    reminder: 'reminders'
};

// Stub — AI save code calls this, keep as no-op
window.registerUpdate = function() {};
window.toggleUpdPanel = function() {};
window.goToPage = function(page) { if(window.switchView) switchView(page); };
window.clearAllUpdates = function() {};

// Notification type mapping: page → notification types
const PAGE_TO_NOTIF = {
    notebook:  ['notebook'],
    notes:     ['case'],
    tasks:     ['task'],
    reminders: ['reminder']
};

// Track task/reminder IDs seen on last page visit — badge shows only NEW items added after
window._seenTaskIds = null;   // null = page never visited this session
window._seenRemIds  = null;

// Mark notifications as read when visiting a page
function markPageNotifsRead(page) {
    const types = PAGE_TO_NOTIF[page];
    if(!types || typeof NS === 'undefined') return;
    let changed = false;
    NS.items.forEach(item => {
        if(types.includes(item.type) && !item.read) {
            item.read = true;
            changed = true;
        }
    });
    // Snapshot current IDs so badge shows 0 until new items arrive
    if(page === 'tasks') {
        window._seenTaskIds = new Set(
            (typeof APP.allTasks !== 'undefined' ? APP.allTasks : [])
                .filter(t => !t.deleted && t.status !== 'Done' && t.status !== 'Finished')
                .map(t => t._docId)
        );
        changed = true;
    }
    if(page === 'reminders') {
        window._seenRemIds = new Set(
            (typeof APP.allReminders !== 'undefined' ? APP.allReminders : [])
                .filter(r => r.status !== 'Closed' && r.status !== 'Done')
                .map(r => r._docId)
        );
        changed = true;
    }
    if(changed) {
        NS.unread = NS.items.filter(i => !i.read).length;
        window.refreshBadges?.();
        window.renderNotifList?.();
    }
}

// Wrap switchView to clear badges on page visit + reset task filter
window.switchView = function(targetView) {
    window._switchView?.(targetView);
    markPageNotifsRead(targetView);
    if(targetView === 'tasks' && window._resetTaskFilter) window._resetTaskFilter();
};

// Also hook tab clicks to mark as read
['notebook','notes','tasks','reminders'].forEach(v => {
    ['desk','mob'].forEach(suffix => {
        const btn = document.getElementById('tab-' + v + '-' + suffix);
        if(btn) btn.addEventListener('click', () => markPageNotifsRead(v));
    });
});

// ╔══════════════════════════════════════════════════════════════╗
// ║          CASEDESK AI — NOTIFICATION ENGINE                  ║
// ╚══════════════════════════════════════════════════════════════╝

