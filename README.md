# CaseDesk AI — Powered by GPT-4.1

AI-Powered Case Manager for banking cases, tasks, and reminders.

## 📁 Project Structure

```
├── index.html      → HTML structure (UI layout)
├── style.css       → All CSS styles & animations
├── app.js          → Application logic (Firebase, AI, UI)
├── server.js       → Node.js/Express server (optional)
├── vercel.json     → Vercel deployment config
├── package.json    → Node.js dependencies
└── .gitignore      → Git ignore rules
```

## 🚀 Deployment

### Vercel (Recommended — current setup)
1. Push to GitHub
2. Connect repo to [vercel.com](https://vercel.com)
3. Deploy — no build command needed, it's a static site

### Local Development
```bash
npm install
npm start
# Opens at http://localhost:3000
```

### GitHub Pages
1. Push to GitHub
2. Go to Settings → Pages → Source: main branch
3. App will be live at `https://username.github.io/repo-name`

## ⚡ Tech Stack
- **Frontend**: HTML, Tailwind CSS, Vanilla JS
- **Backend**: Firebase (Auth + Firestore)
- **AI**: OpenAI GPT-4.1 API
- **Hosting**: Vercel
