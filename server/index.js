require('dotenv').config();
const express = require('express');
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

// ─── Auth Routes ────────────────────────────────────────────────────────────

app.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields required' });

  const hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ username, email, password_hash: hash, rating: 1000, games_played: 0, wins: 0 })
    .select('id, username, email, rating')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  const token = jwt.sign({ id: data.id, username: data.username }, JWT_SECRET);
  res.json({ token, user: data });
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

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, rating: user.rating } });
});

app.get('/profile/:username', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('username, rating, games_played, wins, created_at')
    .eq('username', req.params.username)
    .single();
  if (error) return res.status(404).json({ error: 'User not found' });
  res.json(data);
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

function createRoom(roomId) {
  return {
    id: roomId,
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

function getRoom(roomId) {
  if (!rooms[roomId]) rooms[roomId] = createRoom(roomId);
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

function endTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  clearTimeout(room.turnTimer);
  clearInterval(room.hintInterval);

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

  // Update DB for logged-in players
  const winner = sorted[0];
  for (const p of room.players) {
    if (!p.userId) continue;
    const isWinner = winner && p.socketId === winner.socketId;
    const ratingDelta = isWinner ? 25 : -10;
    try {
      await supabase.rpc('clamp_rating', { uid: p.userId, delta: ratingDelta });
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

    const room = getRoom(roomId);
    room.players.push({
      socketId: socket.id,
      userId: verifiedUserId,
      username: verifiedUsername || `Guest_${socket.id.slice(0, 4)}`,
      score: 0,
      rating: 1000,
    });

    io.to(roomId).emit('room:players', room.players);
    socket.emit('room:state', { state: room.state, players: room.players });
  });

  socket.on('room:start', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.state !== 'lobby') return;
    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players to start');
      return;
    }
    room.round = 0;
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
