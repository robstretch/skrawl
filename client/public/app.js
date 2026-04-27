// ── Config ──────────────────────────────────────────────────────────────────
const SERVER_URL = window.SERVER_URL || 'http://localhost:3001';
const socket = io(SERVER_URL);

// ── Rank helper ───────────────────────────────────────────────────────────────
function getRank(rating) {
  if (rating >= 1800) return { name: 'Legend', emoji: '🏆' };
  if (rating >= 1600) return { name: 'Diamond', emoji: '💎' };
  if (rating >= 1400) return { name: 'Gold', emoji: '🥇' };
  if (rating >= 1200) return { name: 'Silver', emoji: '🥈' };
  if (rating >= 1000) return { name: 'Bronze', emoji: '🥉' };
  if (rating >= 800)  return { name: 'Iron', emoji: '⚙️' };
  return { name: 'Wood', emoji: '🪵' };
}

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

// ── Mobile chat toggle ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const chatHeader = document.querySelector('.chat-header');
  if (chatHeader) {
    chatHeader.addEventListener('click', () => {
      document.querySelector('.chat-panel').classList.toggle('open');
    });
  }

  // Logo clicks go home
  document.querySelectorAll('.sidebar-logo, .logo-sm').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      history.replaceState(null, '', window.location.pathname);
      show('screen-auth');
    });
  });
});

// ── Quick-start (guest) ───────────────────────────────────────────────────────
document.getElementById('btn-play-now').addEventListener('click', () => {
  const name = document.getElementById('guest-username-main').value.trim();
  if (!name) { document.getElementById('guest-username-main').focus(); return; }
  user = { username: name, rating: null, token: null };
  if (window._pendingRoom) {
    const pending = window._pendingRoom;
    window._pendingRoom = null;
    const isPublic = pending.startsWith('PUBLIC');
    joinRoom(pending, isPublic);
  } else {
    enterPublicRoom();
  }
});
document.getElementById('guest-username-main').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-play-now').click();
});

// ── Show/hide login forms ─────────────────────────────────────────────────────
document.getElementById('show-login').addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('quick-start').classList.add('hidden');
  document.getElementById('auth-forms').classList.remove('hidden');
});

// ── Auth tabs ────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'back') {
      document.getElementById('auth-forms').classList.add('hidden');
      document.getElementById('quick-start').classList.remove('hidden');
      return;
    }
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
  if (data.pending) {
    document.getElementById('reg-error').style.color = '#22c55e';
    document.getElementById('reg-error').textContent = '✅ ' + data.message;
    return;
  }
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

function loginSuccess({ token, user: u }) {
  user = { ...u, token };
  enterAfterAuth();
}

function enterAfterAuth() {
  if (window._pendingRoom) {
    const pending = window._pendingRoom;
    window._pendingRoom = null;
    const isPublic = pending.startsWith('PUBLIC');
    joinRoom(pending, isPublic);
  } else {
    enterPublicRoom();
  }
}

async function enterPublicRoom() {
  try {
    const res = await fetch(`${SERVER_URL}/public-room`);
    const { roomId } = await res.json();
    joinRoom(roomId, true);
  } catch {
    joinRoom('PUBLIC', true);
  }
}

// Check URL hash on load — auto-join if present
window.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash.slice(1); // e.g. #ABC123 -> ABC123
  if (hash) {
    // Show auth first, then auto-join after login/guest
    window._pendingRoom = hash;
  }
});

function enterLobby() {
  document.getElementById('lobby-username').textContent = user.username;
  if (user.rating) {
    const rank = getRank(user.rating);
    document.getElementById('lobby-rating').textContent = `${rank.emoji} ${rank.name} · ${user.rating}`;
  } else {
    document.getElementById('lobby-rating').textContent = 'Guest';
  }
  show('screen-lobby');
}

// ── Lobby actions ─────────────────────────────────────────────────────────────
document.getElementById('btn-play-public').addEventListener('click', () => {
  enterPublicRoom();
});

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
let currentRoomIsPublic = false;

function joinRoom(id, isPublic = false) {
  roomId = id;
  currentRoomIsPublic = isPublic;
  show('screen-game');
  document.getElementById('waiting-overlay').classList.remove('hidden');

  // Update URL hash
  history.replaceState(null, '', '#' + id);

  if (isPublic) {
    document.getElementById('waiting-room-code').textContent = 'Public Room';
    document.getElementById('room-code-display').textContent = 'Public Room';
    document.getElementById('btn-start-game').style.display = 'none';
    document.querySelector('#waiting-overlay p').textContent = 'Waiting for more players...';
    document.querySelector('.round-select').style.display = 'none';
  } else {
    document.getElementById('waiting-room-code').textContent = id;
    document.getElementById('room-code-display').textContent = 'Room: ' + id;
    document.getElementById('btn-start-game').style.display = '';
    document.querySelector('#waiting-overlay p').textContent = 'Share this code with friends!';
    document.querySelector('.round-select').style.display = '';
  }

  socket.emit('room:join', {
    roomId: id,
    username: user.username,
    userId: user.id || null,
    token: user.token || null,
  });

}
document.getElementById('btn-start-game').addEventListener('click', () => {
  const rounds = parseInt(document.getElementById('round-count').value) || 3;
  socket.emit('room:start', { roomId, rounds });
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  document.getElementById('end-overlay').classList.add('hidden');
  if (currentRoomIsPublic) {
    enterPublicRoom();
  } else {
    document.getElementById('waiting-overlay').classList.remove('hidden');
  }
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

// Brush size buttons
document.querySelectorAll('.brush-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    brushSize = parseInt(btn.dataset.size);
    erasing = false;
    document.getElementById('btn-eraser').classList.remove('active');
  });
});

document.getElementById('btn-eraser').addEventListener('click', () => {
  erasing = !erasing;
  document.getElementById('btn-eraser').classList.toggle('active', erasing);
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
  // Auto-open chat on mobile when messages arrive
  if (window.innerWidth <= 768) {
    document.querySelector('.chat-panel').classList.add('open');
  }
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer(seconds) {
  clearInterval(timerInterval);
  let t = seconds;
  const el = document.getElementById('timer-display');
  const ring = document.getElementById('timer-ring');
  const circumference = 113;
  el.textContent = t;
  el.style.color = '#e2e8f0';
  if (ring) { ring.style.stroke = '#6366f1'; ring.style.strokeDashoffset = 0; }
  timerInterval = setInterval(() => {
    t--;
    el.textContent = t;
    if (ring) {
      const offset = circumference * (1 - t / seconds);
      ring.style.strokeDashoffset = offset;
    }
    if (t <= 10) { el.style.color = '#ef4444'; if (ring) ring.style.stroke = '#ef4444'; }
    else if (t <= 20) { el.style.color = '#f97316'; if (ring) ring.style.stroke = '#f97316'; }
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

let drawOrder = [];
let currentDrawerId = null;

function updatePlayerList(players, drawerId) {
  if (drawerId !== undefined) currentDrawerId = drawerId;
  const currentIds = drawOrder.map(p => p.socketId);
  players.forEach(p => { if (!currentIds.includes(p.socketId)) drawOrder.push(p); });
  drawOrder = drawOrder.filter(d => players.find(p => p.socketId === d.socketId));
  drawOrder = drawOrder.map(d => ({ ...d, ...players.find(p => p.socketId === d.socketId) }));

  const list = document.getElementById('player-list');
  list.innerHTML = drawOrder.map((p, i) => {
    const drawing = p.socketId === currentDrawerId;
    const cls = drawing ? 'drawing' : (p.guessed ? 'guessed' : '');
    const you = p.socketId === socket.id ? ' <span style="color:#475569;font-size:.65rem">(you)</span>' : '';
    const rankBadge = p.rating ? getRank(p.rating).emoji : '';
    const avatar = p.avatar || '👤';
    const nameClick = p.userId ? `onclick="loadProfile('${p.username}')" style="cursor:pointer"` : '';
    return `<li class="${cls}">
      <span class="player-avatar">${drawing ? '🖌️' : avatar}</span>
      <span class="player-info" ${nameClick}>
        <div class="player-name">${rankBadge} ${p.username}${you}</div>
        <div class="player-rank-num">#${i+1}</div>
      </span>
      <span class="player-score">${p.score}</span>
    </li>`;
  }).join('');
}

socket.on('state:choosing', ({ drawerId, drawerName, drawerAvatar, round, maxRounds }) => {
  document.getElementById('waiting-overlay').classList.add('hidden');
  isDrawer = drawerId === socket.id;
  currentDrawerId = drawerId;
  canvas.classList.toggle('no-draw', !isDrawer);
  document.getElementById('toolbar-panel').classList.toggle('hidden', !isDrawer);
  clearInterval(timerInterval);
  document.getElementById('timer-display').textContent = '';
  const ring = document.getElementById('timer-ring');
  if (ring) ring.style.strokeDashoffset = 0;
  document.getElementById('word-display').textContent = isDrawer ? 'Choose a word!' : `${drawerAvatar || ''} ${drawerName} is choosing...`;
  if (round && maxRounds) {
    const roundText = `Round ${round} / ${maxRounds}`;
    document.getElementById('round-indicator').textContent = roundText;
    const rb = document.getElementById('round-badge');
    if (rb) rb.textContent = roundText;
  }
  addChat(`<span class="name">📢</span> ${drawerAvatar || ''} ${drawerName} is drawing`, 'system');
  updatePlayerList(drawOrder.length ? drawOrder : [], drawerId);
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
  document.getElementById('waiting-overlay').classList.add('hidden');
  document.getElementById('word-choice-overlay').classList.add('hidden');
  document.getElementById('reveal-overlay').classList.add('hidden');

  isDrawer = drawerId === socket.id;
  canvas.classList.toggle('no-draw', !isDrawer);
  document.getElementById('toolbar-panel').classList.toggle('hidden', !isDrawer);

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

// ── Share helpers ─────────────────────────────────────────────────────────
async function shareRoom() {
  const url = window.location.href;
  const text = `Come play Sketchy with me! 🎨 Draw & guess words in real-time. Join here: ${url}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Play Sketchy with me!', text, url }); return; } catch {}
  }
  await navigator.clipboard.writeText(url);
  return '✅ Link copied!';
}

async function shareResults(scores) {
  const top3 = scores.slice(0, 3).map((p, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    return `${medals[i] || ''} ${p.username}: ${p.score} pts`;
  }).join('\n');
  const text = `Just played Sketchy! 🎨\n\n${top3}\n\nPlay free at playsketchy.com`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Sketchy Results', text, url: 'https://playsketchy.com' }); return; } catch {}
  }
  await navigator.clipboard.writeText(text);
  return '✅ Copied!';
}

// Invite button in waiting room
document.getElementById('btn-invite').addEventListener('click', async () => {
  const msg = await shareRoom();
  if (msg) {
    const fb = document.getElementById('invite-feedback');
    fb.textContent = msg;
    setTimeout(() => fb.textContent = '', 2000);
  }
});

// Share results button
document.getElementById('btn-share-result').addEventListener('click', async () => {
  const rows = document.querySelectorAll('.final-score-row');
  const scores = [...rows].map(r => ({
    username: r.querySelector('span:first-child').textContent.replace(/[🥇🥈🥉]/g, '').trim(),
    score: r.querySelector('span:last-child').textContent
  }));
  const msg = await shareResults(scores);
  if (msg) {
    document.getElementById('btn-share-result').textContent = msg;
    setTimeout(() => document.getElementById('btn-share-result').textContent = '📊 Share Results', 2000);
  }
});

// Copy room link on click
document.getElementById('room-code-display').addEventListener('click', () => {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    const el = document.getElementById('room-code-display');
    const orig = el.textContent;
    el.textContent = '✅ Copied!';
    setTimeout(() => el.textContent = orig, 1500);
  });
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

socket.on('hint', ({ maskedWord }) => {
  if (!isDrawer) {
    document.getElementById('word-display').textContent = maskedWord;
  }
});

socket.on('state:reveal', ({ word, scores, deltas }) => {
  clearInterval(timerInterval);
  document.getElementById('reveal-word').textContent = word;
  // Score delta rows
  if (scores && deltas) {
    const sorted = [...scores].sort((a,b) => b.score - a.score);
    document.getElementById('reveal-scores').innerHTML = sorted.map(p => {
      const d = deltas[p.socketId];
      return `<div class="reveal-score-row">
        <span>${p.avatar || '👤'} ${p.username}</span>
        <span>${p.score} ${d ? `<span class="rdelta">+${d}</span>` : ''}</span>
      </div>`;
    }).join('');
  }
  document.getElementById('reveal-overlay').classList.remove('hidden');
  document.getElementById('chat-input').disabled = false;
  setTimeout(() => document.getElementById('reveal-overlay').classList.add('hidden'), 5000);
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
async function loadProfile(username, returnTo) {
  if (returnTo) profileReturnScreen = returnTo;
  show('screen-profile');
  const res = await fetch(`${SERVER_URL}/profile/${encodeURIComponent(username)}`);
  const d = await res.json();
  if (d.error) { document.getElementById('profile-content').innerHTML = '<p style="color:#94a3b8">User not found</p>'; return; }
  const wr = d.games_played > 0 ? Math.round((d.wins / d.games_played) * 100) : 0;
  document.getElementById('profile-content').innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar">${d.rank.emoji}</div>
      <div>
        <h2>${d.username}</h2>
        <div class="profile-rank">${d.rank.emoji} ${d.rank.name} &bull; ${d.rating} pts</div>
      </div>
    </div>
    <div class="profile-stats">
      <div class="stat-card"><div class="stat-val">${d.games_played}</div><div class="stat-label">Games</div></div>
      <div class="stat-card"><div class="stat-val">${d.wins}</div><div class="stat-label">Wins</div></div>
      <div class="stat-card"><div class="stat-val">${wr}%</div><div class="stat-label">Win Rate</div></div>
    </div>
    <div class="rank-breakdown">
      <h3>Rank Breakdown</h3>
      <div class="rank-row">
        <span>🖌️ Drawing</span>
        <span>${d.drawing_rank.emoji} ${d.drawing_rank.name}</span>
        <span class="rank-pts">${d.drawing_rating} pts</span>
      </div>
      <div class="rank-row">
        <span>💡 Guessing</span>
        <span>${d.guessing_rank.emoji} ${d.guessing_rank.name}</span>
        <span class="rank-pts">${d.guessing_rating} pts</span>
      </div>
      <div class="rank-row overall">
        <span>⭐ Overall</span>
        <span>${d.rank.emoji} ${d.rank.name}</span>
        <span class="rank-pts">${d.rating} pts</span>
      </div>
    </div>
  `;
}

let profileReturnScreen = 'screen-lobby';
document.getElementById('btn-back-from-profile').addEventListener('click', () => show(profileReturnScreen));

async function loadLeaderboard() {
  show('screen-leaderboard');
  const res = await fetch(`${SERVER_URL}/leaderboard`);
  const data = await res.json();
  document.getElementById('leaderboard-body').innerHTML = data
    .map((p, i) => `<tr>
      <td>${i + 1}</td>
      <td style="cursor:pointer;color:#818cf8" onclick="loadProfile('${p.username}')">${getRank(p.rating).emoji} ${p.username}</td>
      <td>${p.rating}</td>
      <td>${p.wins}</td>
      <td>${p.games_played}</td>
    </tr>`).join('');
}

document.getElementById('btn-back-lobby').addEventListener('click', () => show('screen-lobby'));
document.getElementById('btn-my-profile-btn').addEventListener('click', () => {
  if (user && user.username) loadProfile(user.username);
});

document.getElementById('btn-logout').addEventListener('click', () => {
  user = null;
  drawOrder = [];
  currentDrawerId = null;
  roomId = null;
  history.replaceState(null, '', window.location.pathname);
  show('screen-auth');
  // Reset guest input
  document.getElementById('guest-username-main').value = '';
  document.getElementById('quick-start').classList.remove('hidden');
  document.getElementById('auth-forms').classList.add('hidden');
});
