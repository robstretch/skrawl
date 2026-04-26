// ── Config ──────────────────────────────────────────────────────────────────
const SERVER_URL = window.SERVER_URL || 'http://localhost:3001';
const socket = io(SERVER_URL);

// ── State ────────────────────────────────────────────────────────────────────
let user = null;       // { id, username, rating, token }
let roomId = null;
let isDrawer = false;
let timerInterval = null;

// ── Screen switcher ──────────────────────────────────────────────────────────
function show(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// ── Auth tabs ────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('form-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Register ─────────────────────────────────────────────────────────────────
document.getElementById('form-register').addEventListener('submit', async e => {
  e.preventDefault();
  const res = await fetch(`${SERVER_URL}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: document.getElementById('reg-username').value,
      email: document.getElementById('reg-email').value,
      password: document.getElementById('reg-password').value,
    })
  });
  const data = await res.json();
  if (data.error) { document.getElementById('reg-error').textContent = data.error; return; }
  loginSuccess(data);
});

// ── Login ─────────────────────────────────────────────────────────────────────
document.getElementById('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const res = await fetch(`${SERVER_URL}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: document.getElementById('login-email').value,
      password: document.getElementById('login-password').value,
    })
  });
  const data = await res.json();
  if (data.error) { document.getElementById('login-error').textContent = data.error; return; }
  loginSuccess(data);
});

// ── Guest ─────────────────────────────────────────────────────────────────────
document.getElementById('form-guest').addEventListener('submit', e => {
  e.preventDefault();
  user = { username: document.getElementById('guest-username').value, rating: null, token: null };
  enterLobby();
});

function loginSuccess({ token, user: u }) {
  user = { ...u, token };
  enterLobby();
}

function enterLobby() {
  document.getElementById('lobby-username').textContent = user.username;
  document.getElementById('lobby-rating').textContent = user.rating ? `⭐ ${user.rating}` : 'Guest';
  show('screen-lobby');
}

// ── Lobby actions ─────────────────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  joinRoom(id);
});

document.getElementById('btn-join').addEventListener('click', () => {
  const id = document.getElementById('room-id-input').value.trim().toUpperCase();
  if (id) joinRoom(id);
});

document.getElementById('btn-leaderboard').addEventListener('click', loadLeaderboard);

// ── Join Room ─────────────────────────────────────────────────────────────────
function joinRoom(id) {
  roomId = id;
  show('screen-game');
  document.getElementById('waiting-room-code').textContent = id;
  document.getElementById('room-code-display').textContent = `Room: ${id}`;

  socket.emit('room:join', {
    roomId: id,
    username: user.username,
    userId: user.id || null,
    token: user.token || null,
  });
}

document.getElementById('btn-start-game').addEventListener('click', () => {
  socket.emit('room:start', { roomId });
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  document.getElementById('end-overlay').classList.add('hidden');
  document.getElementById('waiting-overlay').classList.remove('hidden');
});

// ── Canvas Setup ──────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let drawing = false;
let lastX = 0, lastY = 0;
let currentColor = '#000000';
let brushSize = 6;
let erasing = false;

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function drawLine(x1, y1, x2, y2, color, size, erase) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = erase ? '#ffffff' : color;
  ctx.lineWidth = erase ? size * 2 : size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function startDraw(e) {
  if (!isDrawer) return;
  e.preventDefault();
  drawing = true;
  const pos = getPos(e);
  lastX = pos.x; lastY = pos.y;
}

function doDraw(e) {
  if (!drawing || !isDrawer) return;
  e.preventDefault();
  const pos = getPos(e);
  drawLine(lastX, lastY, pos.x, pos.y, currentColor, brushSize, erasing);
  socket.emit('draw', { roomId, event: { x1: lastX, y1: lastY, x2: pos.x, y2: pos.y, color: currentColor, size: brushSize, erase: erasing } });
  lastX = pos.x; lastY = pos.y;
}

function stopDraw() { drawing = false; }

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', doDraw);
canvas.addEventListener('mouseup', stopDraw);
canvas.addEventListener('mouseleave', stopDraw);
canvas.addEventListener('touchstart', startDraw, { passive: false });
canvas.addEventListener('touchmove', doDraw, { passive: false });
canvas.addEventListener('touchend', stopDraw);

// ── Toolbar ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentColor = btn.dataset.color;
    erasing = false;
    document.getElementById('btn-eraser').textContent = '⬜ Eraser';
  });
});

document.getElementById('brush-size').addEventListener('input', e => {
  brushSize = parseInt(e.target.value);
});

document.getElementById('btn-eraser').addEventListener('click', () => {
  erasing = !erasing;
  document.getElementById('btn-eraser').textContent = erasing ? '✏️ Draw' : '⬜ Eraser';
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!isDrawer) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  socket.emit('canvas:clear', { roomId });
});

// ── Chat ──────────────────────────────────────────────────────────────────────
document.getElementById('chat-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  if (isDrawer) {
    socket.emit('chat', { roomId, message: msg });
  } else {
    socket.emit('guess', { roomId, guess: msg });
  }
  input.value = '';
});

function addChat(html, cls = '') {
  const div = document.createElement('div');
  div.className = `chat-msg ${cls}`;
  div.innerHTML = html;
  const msgs = document.getElementById('chat-messages');
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer(seconds) {
  clearInterval(timerInterval);
  let t = seconds;
  const el = document.getElementById('timer-display');
  el.textContent = t;
  el.className = '';
  timerInterval = setInterval(() => {
    t--;
    el.textContent = t;
    if (t <= 10) el.className = 'timer-danger';
    else if (t <= 20) el.className = 'timer-warn';
    if (t <= 0) clearInterval(timerInterval);
  }, 1000);
}

// ── Socket Events ─────────────────────────────────────────────────────────────
socket.on('room:players', players => {
  // Update waiting list
  const wl = document.getElementById('waiting-players');
  wl.innerHTML = players.map(p => `<div class="waiting-player">${p.username}</div>`).join('');

  // Update sidebar
  updatePlayerList(players);
});

socket.on('room:state', ({ state, players }) => {
  updatePlayerList(players);
  if (state !== 'lobby') {
    document.getElementById('waiting-overlay').classList.add('hidden');
  }
});

function updatePlayerList(players) {
  const list = document.getElementById('player-list');
  list.innerHTML = players
    .sort((a, b) => b.score - a.score)
    .map(p => `<li class="${p.socketId === socket.id && isDrawer ? 'drawing' : ''}">
      <span>${p.username}</span>
      <span class="player-score">${p.score}</span>
    </li>`).join('');
}

socket.on('state:choosing', ({ drawerId, drawerName }) => {
  document.getElementById('waiting-overlay').classList.add('hidden');
  isDrawer = drawerId === socket.id;
  canvas.classList.toggle('no-draw', !isDrawer);
  document.getElementById('toolbar').classList.toggle('hidden', !isDrawer);
  clearInterval(timerInterval);
  document.getElementById('timer-display').textContent = '';
  document.getElementById('word-display').textContent = isDrawer ? 'Choose a word!' : `${drawerName} is choosing...`;
  addChat(`<span class="name">📢</span> ${drawerName} is the drawer`, 'system');
});

socket.on('word:choices', words => {
  const overlay = document.getElementById('word-choice-overlay');
  const container = document.getElementById('word-choices');
  container.innerHTML = words.map(w =>
    `<button class="word-choice-btn" data-word="${w}">${w}</button>`
  ).join('');
  overlay.classList.remove('hidden');

  container.querySelectorAll('.word-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('word:pick', { roomId, word: btn.dataset.word });
      overlay.classList.add('hidden');
    });
  });
});

socket.on('state:drawing', ({ drawerId, wordLength, maskedWord, timeLeft }) => {
  document.getElementById('word-choice-overlay').classList.add('hidden');
  document.getElementById('reveal-overlay').classList.add('hidden');

  isDrawer = drawerId === socket.id;
  canvas.classList.toggle('no-draw', !isDrawer);
  document.getElementById('toolbar').classList.toggle('hidden', !isDrawer);

  if (!isDrawer) {
    document.getElementById('word-display').textContent = maskedWord;
  }

  // Clear canvas for new turn
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  startTimer(timeLeft);
});

socket.on('word:chosen', word => {
  document.getElementById('word-display').textContent = word;
});

socket.on('draw', ({ x1, y1, x2, y2, color, size, erase }) => {
  drawLine(x1, y1, x2, y2, color, size, erase);
});

socket.on('canvas:clear', () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
});

socket.on('guess:correct', ({ socketId, username, points, scores }) => {
  const isMe = socketId === socket.id;
  addChat(`<span class="name">✅ ${username}</span> guessed it! (+${points})`, 'correct');
  if (isMe) document.getElementById('chat-input').disabled = true;
  updatePlayerList(scores);
});

socket.on('guess:wrong', ({ username, guess }) => {
  addChat(`<span class="name">${username}:</span> ${guess}`);
});

socket.on('chat', ({ username, message }) => {
  addChat(`<span class="name">${username}:</span> ${message}`);
});

socket.on('state:reveal', ({ word }) => {
  clearInterval(timerInterval);
  document.getElementById('reveal-word').textContent = word;
  document.getElementById('reveal-overlay').classList.remove('hidden');
  document.getElementById('chat-input').disabled = false;
  setTimeout(() => document.getElementById('reveal-overlay').classList.add('hidden'), 4800);
});

socket.on('state:end', ({ scores }) => {
  clearInterval(timerInterval);
  document.getElementById('end-overlay').classList.remove('hidden');
  document.getElementById('final-scores').innerHTML = scores
    .map((p, i) => `<div class="final-score-row"><span>${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} ${p.username}</span><span>${p.score}</span></div>`)
    .join('');
});

socket.on('error', msg => {
  document.getElementById('start-error').textContent = msg;
});

// ── Leaderboard ───────────────────────────────────────────────────────────────
async function loadLeaderboard() {
  show('screen-leaderboard');
  const res = await fetch(`${SERVER_URL}/leaderboard`);
  const data = await res.json();
  document.getElementById('leaderboard-body').innerHTML = data
    .map((p, i) => `<tr>
      <td>${i + 1}</td>
      <td>${p.username}</td>
      <td>${p.rating}</td>
      <td>${p.wins}</td>
      <td>${p.games_played}</td>
    </tr>`).join('');
}

document.getElementById('btn-back-lobby').addEventListener('click', () => show('screen-lobby'));
