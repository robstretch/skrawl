# Skrawl 🎨

Skribbl competitor — real-time draw & guess with user accounts, ratings, and leaderboards.

## Stack
- **Backend:** Node.js + Express + Socket.io
- **Auth:** JWT + bcrypt
- **Database:** Supabase (Postgres)
- **Frontend:** Vanilla HTML/CSS/JS + Canvas API
- **Hosting:** Railway (backend) + Netlify (frontend)

## Setup

### 1. Supabase
1. Create a new project at supabase.com
2. Run `supabase-schema.sql` in the SQL editor
3. Grab your Project URL and anon key

### 2. Backend
```bash
cd server
cp .env.example .env
# Fill in .env with Supabase creds + JWT_SECRET
npm install
npm run dev
```

### 3. Frontend
Just serve the `client/public/` folder. For local dev:
```bash
npx serve client/public
```
Or set `window.SERVER_URL` in index.html before the app.js script tag for production.

## Deploy

### Railway (backend)
- Connect GitHub repo, set root to `/server`
- Add env vars from `.env`
- Auto-deploys on push

### Netlify (frontend)
- Publish directory: `client/public`
- Add `window.SERVER_URL = 'https://your-railway-app.up.railway.app'` to index.html

## Game Flow
1. Register/login or play as guest
2. Create or join a room (6-char code)
3. Host clicks Start (needs 2+ players)
4. Drawer gets 3 word choices, picks one
5. 80 seconds to draw — guessers type in chat
6. Points for correct guesses (faster = more points), drawer gets points per correct guess
7. Rounds rotate through all players × 3 rounds
8. ELO-style rating update after game ends
