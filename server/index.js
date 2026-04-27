require('dotenv').config();
const express = require('express');
const { Resend } = require('resend');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: false }
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(cors({ origin: '*' }));
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
const PORT = process.env.PORT || 3001;
const resend = new Resend(process.env.RESEND_API_KEY);
const APP_URL = process.env.APP_URL || 'https://playsketchy.com';

// ─── Auth Routes ────────────────────────────────────────────────────────────

app.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields required' });

  const hash = await bcrypt.hash(password, 10);
  const verificationToken = crypto.randomBytes(32).toString('hex');

  const { data, error } = await supabase
    .from('users')
    .insert({ username, email, password_hash: hash, rating: 1000, games_played: 0, wins: 0, verified: false, verification_token: verificationToken })
    .select('id, username, email, rating')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Send verification email
  try {
    await resend.emails.send({
      from: 'Sketchy <noreply@playsketchy.com>',
      to: email,
      subject: 'Verify your Sketchy account',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem;background:#0f172a;color:#e2e8f0;border-radius:1rem">
          <h1 style="font-size:2rem;margin-bottom:.5rem">🎨 Sketchy</h1>
          <p style="color:#94a3b8;margin-bottom:1.5rem">Thanks for signing up, ${username}!</p>
          <p style="margin-bottom:1.5rem">Click the button below to verify your email and start playing.</p>
          <a href="${APP_URL}/verify?token=${verificationToken}" style="display:inline-block;padding:.875rem 2rem;background:#6366f1;color:#fff;border-radius:.75rem;text-decoration:none;font-weight:700;font-size:1rem">Verify Email →</a>
          <p style="margin-top:1.5rem;color:#475569;font-size:.85rem">If you didn't sign up, ignore this email.</p>
        </div>
      `
    });
  } catch (e) { console.error('Email error:', e.message); }

  res.json({ pending: true, message: 'Check your email to verify your account.' });
});

// Email verification endpoint
app.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid token');

  const { data, error } = await supabase
    .from('users')
    .update({ verified: true, verification_token: null })
    .eq('verification_token', token)
    .select('id, username')
    .single();

  if (error || !data) return res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:4rem;background:#0f172a;color:#e2e8f0">
      <h2>❌ Invalid or expired link</h2>
      <a href="${APP_URL}" style="color:#6366f1">Back to Sketchy</a>
    </body></html>
  `);

  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:4rem;background:#0f172a;color:#e2e8f0">
      <h1>🎨 Sketchy</h1>
      <h2 style="color:#22c55e">✅ Email verified!</h2>
      <p style="color:#94a3b8">You're all set, ${data.username}. Go play!</p>
      <a href="${APP_URL}" style="display:inline-block;margin-top:1.5rem;padding:.875rem 2rem;background:#6366f1;color:#fff;border-radius:.75rem;text-decoration:none;font-weight:700">Play Now →</a>
    </body></html>
  `);
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.verified) return res.status(401).json({ error: 'Please verify your email before logging in.' });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, rating: user.rating } });
});

function getRank(rating) {
  if (rating >= 1800) return { name: 'Legend', emoji: '🏆', color: '#fbbf24' };
  if (rating >= 1600) return { name: 'Diamond', emoji: '💎', color: '#67e8f9' };
  if (rating >= 1400) return { name: 'Gold', emoji: '🥇', color: '#fbbf24' };
  if (rating >= 1200) return { name: 'Silver', emoji: '🥈', color: '#94a3b8' };
  if (rating >= 1000) return { name: 'Bronze', emoji: '🥉', color: '#b45309' };
  if (rating >= 800)  return { name: 'Iron', emoji: '⚙️', color: '#64748b' };
  return { name: 'Wood', emoji: '🪵', color: '#78350f' };
}

app.get('/profile/:username', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('username, rating, drawing_rating, guessing_rating, games_played, wins, created_at')
    .eq('username', req.params.username)
    .single();
  if (error) return res.status(404).json({ error: 'User not found' });
  res.json({
    ...data,
    rank: getRank(data.rating),
    drawing_rank: getRank(data.drawing_rating),
    guessing_rank: getRank(data.guessing_rating),
  });
});

app.get('/leaderboard', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('username, rating, games_played, wins')
    .order('rating', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── Word Bank ───────────────────────────────────────────────────────────────

const WORDS = [
  'apple','banana','guitar','elephant','pizza','volcano','umbrella','skateboard',
  'astronaut','jellyfish','tornado','lighthouse','cactus','submarine','penguin',
  'rainbow','thunderstorm','compass','telescope','dinosaur','parachute','igloo',
  'waterfall','saxophone','hammock','quicksand','avalanche','boomerang','catapult',
  'dumbbell','escalator','fireworks','gondola','helicopter','icicle','jackhammer',
  'kangaroo','lollipop','magnet','noodles','octopus','pyramid','quicksand',
  'robot','snowflake','tornado','unicorn','vampire','wizard','xylophone','yoyo','zombie'
];

function pickWords(n = 3) {
  const shuffled = [...WORDS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function maskWord(word) {
  return word.split('').map(c => c === ' ' ? ' ' : '_').join('');
}

// ─── Room State ──────────────────────────────────────────────────────────────

const rooms = {}; // roomId -> room state
const PUBLIC_ROOM = 'PUBLIC';

// Public room matchmaking endpoint
app.get('/public-room', (req, res) => {
  // Find a public room in lobby state with < 10 players, or return PUBLIC
  const available = Object.values(rooms).find(
    r => r.isPublic && r.state === 'lobby' && r.players.length < 10
  );
  res.json({ roomId: available ? available.id : PUBLIC_ROOM });
});

function createRoom(roomId, isPublic = false) {
  return {
    id: roomId,
    isPublic,
    players: [],       // { socketId, userId, username, score, rating }
    state: 'lobby',    // lobby | choosing | drawing | reveal | end
    round: 0,
    maxRounds: 3,
    drawerId: null,
    currentWord: null,
    wordChoices: [],
    guessedBy: [],     // socket IDs that guessed correctly
    turnTimer: null,
    chooseTimer: null,
    drawingTime: 180,
    hintInterval: null,
    revealedIndices: [],
  };
}

function getRoom(roomId, isPublic = false) {
  if (!rooms[roomId]) rooms[roomId] = createRoom(roomId, isPublic);
  return rooms[roomId];
}

function nextDrawer(room) {
  if (room.players.length === 0) return null;
  const idx = room.players.findIndex(p => p.socketId === room.drawerId);
  return room.players[(idx + 1) % room.players.length];
}

function startChoosing(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const drawer = nextDrawer(room);
  if (!drawer) return;

  room.state = 'choosing';
  room.drawerId = drawer.socketId;
  room.wordChoices = pickWords(3);
  room.guessedBy = [];
  room.currentWord = null;

  io.to(roomId).emit('state:choosing', {
    drawerId: drawer.socketId,
    drawerName: drawer.username,
  });

  // Send word choices only to the drawer
  io.to(drawer.socketId).emit('word:choices', room.wordChoices);

  room.chooseTimer = setTimeout(() => {
    // Auto-pick first word if drawer doesn't choose
    if (room.state === 'choosing') {
      chooseWord(roomId, room.wordChoices[0]);
    }
  }, 15000);
}

function chooseWord(roomId, word) {
  const room = rooms[roomId];
  if (!room || room.state !== 'choosing') return;
  clearTimeout(room.chooseTimer);

  room.currentWord = word;
  room.state = 'drawing';

  io.to(roomId).emit('state:drawing', {
    drawerId: room.drawerId,
    wordLength: word.length,
    maskedWord: maskWord(word),
    timeLeft: room.drawingTime,
  });

  // Send actual word to drawer
  io.to(room.drawerId).emit('word:chosen', word);

  room.turnTimer = setTimeout(() => endTurn(roomId), room.drawingTime * 1000);

  // Hints: reveal a random letter every 20 seconds
  room.revealedIndices = [];
  room.hintInterval = setInterval(() => {
    if (!room.currentWord || room.state !== 'drawing') return;
    const wordArr = room.currentWord.split('');
    const hideable = wordArr
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => c !== ' ' && !room.revealedIndices.includes(i));
    if (hideable.length === 0) return;
    const pick = hideable[Math.floor(Math.random() * hideable.length)];
    room.revealedIndices.push(pick.i);
    const masked = wordArr.map((c, i) =>
      c === ' ' ? ' ' : room.revealedIndices.includes(i) ? c : '_'
    ).join('');
    // Send hint to non-drawers only
    room.players.forEach(p => {
      if (p.socketId !== room.drawerId) {
        io.to(p.socketId).emit('hint', { maskedWord: masked });
      }
    });
  }, 20000);
}

async function updateTurnRatings(room) {
  const guessers = room.players.filter(p => p.socketId !== room.drawerId);
  if (guessers.length === 0) return;

  const guessedRatio = room.guessedBy.length / guessers.length;

  // Update drawer's drawing rating
  const drawer = room.players.find(p => p.socketId === room.drawerId);
  if (drawer && drawer.userId) {
    try { await supabase.rpc('update_drawing_rating', { uid: drawer.userId, guessed_ratio: guessedRatio }); }
    catch (e) { console.error('drawing rating error:', e.message); }
  }

  // Update guessers' guessing ratings
  const totalGuessers = room.guessedBy.length;
  for (const p of guessers) {
    if (!p.userId) continue;
    const guessedCorrectly = room.guessedBy.includes(p.socketId);
    const guessPosition = room.guessedBy.indexOf(p.socketId); // 0 = first
    const speedBonus = guessedCorrectly ? Math.max(0, 10 - guessPosition * 3) : 0;
    try { await supabase.rpc('update_guessing_rating', { uid: p.userId, guessed: guessedCorrectly, speed_bonus: speedBonus }); }
    catch (e) { console.error('guessing rating error:', e.message); }
  }
}

function endTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  clearTimeout(room.turnTimer);
  clearInterval(room.hintInterval);
  updateTurnRatings(room);

  room.state = 'reveal';
  io.to(roomId).emit('state:reveal', { word: room.currentWord });

  setTimeout(() => {
    room.round++;
    const totalTurns = room.maxRounds * room.players.length;

    // Count turns taken
    const turns = room.round;
    if (turns >= totalTurns || room.players.length < 2) {
      endGame(roomId);
    } else {
      startChoosing(roomId);
    }
  }, 5000);
}

async function endGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.state = 'end';
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(roomId).emit('state:end', { scores: sorted });

  // Update DB stats for logged-in players
  const winner = sorted[0];
  for (const p of room.players) {
    if (!p.userId) continue;
    const isWinner = winner && p.socketId === winner.socketId;
    try {
      await supabase.rpc('increment', { row_id: p.userId, col: 'games_played' });
      if (isWinner) await supabase.rpc('increment', { row_id: p.userId, col: 'wins' });
    } catch (e) { console.error('DB update error:', e.message); }
  }

  // Cleanup after 30s
  setTimeout(() => { delete rooms[roomId]; }, 30000);
}

// ─── Socket.io ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('room:join', ({ roomId, username, userId, token }) => {
    // Verify JWT if provided
    let verifiedUserId = null;
    let verifiedUsername = username;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        verifiedUserId = decoded.id;
        verifiedUsername = decoded.username;
      } catch {}
    }

    currentRoom = roomId;
    socket.join(roomId);

    const isPublic = roomId === PUBLIC_ROOM || (rooms[roomId] && rooms[roomId].isPublic);
    const room = getRoom(roomId, isPublic);
    room.players.push({
      socketId: socket.id,
      userId: verifiedUserId,
      username: verifiedUsername || `Guest_${socket.id.slice(0, 4)}`,
      score: 0,
      rating: 1000,
    });

    io.to(roomId).emit('room:players', room.players);
    socket.emit('room:state', { state: room.state, players: room.players, isPublic: room.isPublic });

    // Auto-start public room when 2+ players in lobby
    if (room.isPublic && room.state === 'lobby' && room.players.length >= 2) {
      setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].state === 'lobby' && rooms[roomId].players.length >= 2) {
          rooms[roomId].round = 0;
          startChoosing(roomId);
        }
      }, 3000);
    }
  });

  socket.on('room:start', ({ roomId, rounds }) => {
    const room = rooms[roomId];
    if (!room || room.state !== 'lobby') return;
    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players to start');
      return;
    }
    room.round = 0;
    if (rounds && rounds >= 1 && rounds <= 10) room.maxRounds = rounds;
    startChoosing(roomId);
  });

  socket.on('word:pick', ({ roomId, word }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.drawerId) return;
    if (!room.wordChoices.includes(word)) return;
    chooseWord(roomId, word);
  });

  socket.on('draw', ({ roomId, event }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.drawerId) return;
    socket.to(roomId).emit('draw', event);
  });

  socket.on('canvas:clear', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.drawerId) return;
    socket.to(roomId).emit('canvas:clear');
  });

  socket.on('guess', ({ roomId, guess }) => {
    const room = rooms[roomId];
    if (!room || room.state !== 'drawing') return;
    if (socket.id === room.drawerId) return;
    if (room.guessedBy.includes(socket.id)) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    const correct = guess.trim().toLowerCase() === room.currentWord.toLowerCase();

    if (correct) {
      room.guessedBy.push(socket.id);
      // Points: faster = more points (max 500, min 50)
      const timeElapsed = room.drawingTime - (room.drawingTime * 0.8); // rough
      const points = Math.max(50, Math.round(500 - (room.guessedBy.length - 1) * 100));
      player.score += points;

      // Drawer gets points too
      const drawer = room.players.find(p => p.socketId === room.drawerId);
      if (drawer) drawer.score += 25;

      io.to(roomId).emit('guess:correct', {
        socketId: socket.id,
        username: player.username,
        points,
        scores: room.players,
      });

      // Everyone guessed?
      const guessers = room.players.filter(p => p.socketId !== room.drawerId);
      if (room.guessedBy.length >= guessers.length) {
        endTurn(roomId);
      }
    } else {
      // Broadcast guess to everyone (word is hidden server-side)
      io.to(roomId).emit('guess:wrong', {
        socketId: socket.id,
        username: player.username,
        guess,
      });
    }
  });

  socket.on('chat', ({ roomId, message }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    // During drawing phase, don't echo guesses as chat (handle via guess event)
    io.to(roomId).emit('chat', {
      username: player.username,
      message,
      system: false,
    });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;

    room.players = room.players.filter(p => p.socketId !== socket.id);
    io.to(currentRoom).emit('room:players', room.players);

    if (room.drawerId === socket.id && room.state === 'drawing') {
      endTurn(currentRoom);
    }

    if (room.players.length === 0) {
      clearTimeout(room.turnTimer);
      clearTimeout(room.chooseTimer);
      delete rooms[currentRoom];
    }
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
