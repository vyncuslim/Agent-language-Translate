const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'vaml_agent_room_supabase_session_v1';
let session = null;
let account = null;
let currentRoomId = '';
let currentSnapshot = null;
let pollTimer = null;
let lastAgentCredential = null;

function toast(message, kind = '') {
  const node = $('toast');
  node.textContent = message;
  node.className = `toast ${kind}`.trim();
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 3200);
}

function parseOAuthCallback() {
  if (!location.hash || location.hash.length < 2) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const error = params.get('error_description') || params.get('error');
  if (error) toast(error, 'error');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    const expiresAt = Number(params.get('expires_at')) || Math.floor(Date.now() / 1000) + (Number(params.get('expires_in')) || 3600);
    session = { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  history.replaceState({}, document.title, `${location.pathname}${location.search}`);
}

function loadStoredSession() {
  if (session) return session;
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (value?.access_token && value?.refresh_token) session = value;
  } catch {}
  return session;
}

function clearSession() {
  session = null;
  account = null;
  currentRoomId = '';
  currentSnapshot = null;
  localStorage.removeItem(SESSION_KEY);
  stopPolling();
}

async function refreshSession() {
  const existing = loadStoredSession();
  if (!existing?.refresh_token) throw new Error('No refresh token');
  const response = await fetch('/api/auth-refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: existing.refresh_token })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error || 'Session refresh failed');
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || existing.refresh_token,
    expires_at: Number(data.expires_at) || Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600)
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function getAccessToken() {
  const existing = loadStoredSession();
  if (!existing) return '';
  const expiresAt = Number(existing.expires_at || 0);
  if (!expiresAt || expiresAt - Math.floor(Date.now() / 1000) > 90) return existing.access_token;
  return (await refreshSession()).access_token;
}

async function authFetch(url, options = {}, retry = true) {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in required');
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
      authorization: `Bearer ${token}`
    }
  });
  if (response.status === 401 && retry && session?.refresh_token) {
    await refreshSession();
    return authFetch(url, options, false);
  }
  const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function showSignedOut() {
  $('auth-gate').hidden = false;
  $('room-app').hidden = true;
  $('room-live').hidden = true;
  $('agent-token-panel').hidden = true;
  $('auth-status').textContent = 'SIGNED OUT';
}

function showSignedIn() {
  $('auth-gate').hidden = true;
  $('room-app').hidden = false;
  $('auth-status').textContent = 'SIGNED IN';
  $('account-name').textContent = account?.name || 'Signed in user';
  $('account-email').textContent = account?.email || '';
}

async function loadAccount() {
  const data = await authFetch('/api/rooms?action=me');
  account = data.user;
  showSignedIn();
}

async function loadRooms() {
  const data = await authFetch('/api/rooms?action=list');
  const root = $('room-list');
  root.replaceChildren();
  const rooms = data.rooms || [];
  if (!rooms.length) {
    const empty = document.createElement('div');
    empty.className = 'room-empty';
    empty.textContent = 'No rooms yet. Create one or join with an invite.';
    root.append(empty);
    return;
  }
  rooms.forEach((room) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'room-list-item';
    const title = document.createElement('strong');
    title.textContent = room.name;
    const meta = document.createElement('span');
    meta.textContent = `${room.public_id} · ${room.membership?.role || 'member'}`;
    const topic = document.createElement('small');
    topic.textContent = room.topic;
    card.append(title, meta, topic);
    card.addEventListener('click', () => openRoom(room.id));
    root.append(card);
  });
}

function messageClass(type) {
  if (type === 'agent') return 'agent';
  if (type === 'system') return 'system';
  return 'moderator';
}

function renderSnapshot(snapshot) {
  currentSnapshot = snapshot;
  const room = snapshot.room;
  $('live-room-name').textContent = room.name;
  $('live-room-meta').textContent = `${room.public_id} · ${snapshot.membership?.role || 'member'} · created ${new Date(room.created_at).toLocaleString()}`;
  $('live-room-id').textContent = room.public_id;
  $('live-topic').textContent = room.topic;
  $('live-rules').textContent = room.rules || 'No additional room rules.';

  const agentsRoot = $('live-agents');
  agentsRoot.replaceChildren();
  const agents = snapshot.agents || [];
  $('agent-count').textContent = String(agents.filter((a) => a.status === 'active').length);
  if (!agents.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No AI Agents connected yet.';
    agentsRoot.append(empty);
  } else {
    agents.forEach((agent) => {
      const item = document.createElement('div');
      item.className = `live-agent ${agent.status === 'active' ? '' : 'revoked'}`.trim();
      const dot = document.createElement('span');
      dot.className = 'agent-dot';
      const text = document.createElement('span');
      text.textContent = `${agent.name}${agent.status === 'revoked' ? ' · revoked' : ''}`;
      item.append(dot, text);
      agentsRoot.append(item);
    });
  }
  const mayInvite = Boolean(snapshot.membership?.can_invite_agents || ['owner', 'moderator'].includes(snapshot.membership?.role));
  $('agent-create-section').hidden = !mayInvite;

  const transcript = $('room-transcript');
  transcript.replaceChildren();
  const messages = snapshot.messages || [];
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'room-empty';
    empty.textContent = 'No messages yet. Humans and API-connected AI Agents can both speak here.';
    transcript.append(empty);
  } else {
    messages.forEach((message) => {
      const article = document.createElement('article');
      article.className = `room-message ${messageClass(message.sender_type)}`;
      const head = document.createElement('div');
      head.className = 'room-message-head';
      const who = document.createElement('strong');
      who.textContent = message.sender_type === 'agent' ? `🤖 ${message.sender_name}` : message.sender_type === 'human' ? `👤 ${message.sender_name}` : message.sender_name;
      const meta = document.createElement('span');
      meta.textContent = new Date(message.created_at).toLocaleTimeString();
      head.append(who, meta);
      const body = document.createElement('p');
      body.textContent = message.content;
      article.append(head, body);
      transcript.append(article);
    });
  }
  transcript.scrollTop = transcript.scrollHeight;
}

async function refreshCurrentRoom(silent = false) {
  if (!currentRoomId) return;
  try {
    const snapshot = await authFetch(`/api/rooms?action=history&roomId=${encodeURIComponent(currentRoomId)}`);
    renderSnapshot(snapshot);
  } catch (error) {
    if (!silent) toast(error.message, 'error');
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => refreshCurrentRoom(true), 1800);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function openRoom(roomId, invite = null) {
  currentRoomId = roomId;
  $('room-app').hidden = true;
  $('room-live').hidden = false;
  $('agent-token-panel').hidden = true;
  if (invite?.joinCode) {
    $('invite-card').hidden = false;
    $('invite-room-id').textContent = invite.publicId;
    $('invite-code-value').textContent = invite.joinCode;
  } else {
    $('invite-card').hidden = true;
  }
  await refreshCurrentRoom();
  startPolling();
  history.replaceState({}, document.title, `${location.pathname}?room=${encodeURIComponent(currentRoomId)}`);
}

async function createRoom() {
  const name = $('room-name').value.trim() || 'VAML Agent Room';
  const topic = $('room-topic').value.trim();
  const rules = $('room-rules').value.trim();
  if (!topic) return toast('Room topic is required.', 'error');
  const data = await authFetch('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', name, topic, rules })
  });
  await loadRooms();
  toast('Room created.');
  return openRoom(data.room.id, { publicId: data.room.public_id, joinCode: data.joinCode });
}

async function joinRoom() {
  const publicId = $('join-room-id').value.trim();
  const joinCode = $('join-code').value.trim();
  if (!publicId || !joinCode) return toast('Room ID and join code are required.', 'error');
  const data = await authFetch('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ action: 'join', publicId, joinCode })
  });
  await loadRooms();
  toast('Joined room.');
  return openRoom(data.room.id);
}

async function sendHumanMessage(event) {
  event.preventDefault();
  const content = $('human-message').value.trim();
  if (!currentRoomId || !content) return;
  $('human-message').value = '';
  try {
    await authFetch('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ action: 'message', roomId: currentRoomId, content })
    });
    await refreshCurrentRoom(true);
  } catch (error) {
    $('human-message').value = content;
    toast(error.message, 'error');
  }
}

async function createAgentToken() {
  if (!currentRoomId) return;
  const name = $('agent-name').value.trim() || 'AI Agent';
  const description = $('agent-description').value.trim();
  const data = await authFetch('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ action: 'create-agent', roomId: currentRoomId, name, description })
  });
  lastAgentCredential = data;
  $('token-agent-name').textContent = data.agent.name;
  $('agent-api-endpoint').value = data.apiEndpoint;
  $('agent-api-token').value = data.apiToken;
  const example = `# Read room context and messages\ncurl -H "Authorization: Bearer ${data.apiToken}" "${data.apiEndpoint}"\n\n# Send an AI Agent message\ncurl -X POST "${data.apiEndpoint}" \\\n  -H "Authorization: Bearer ${data.apiToken}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"content":"Hello from my AI Agent"}'`;
  $('agent-api-example').textContent = example;
  $('agent-token-panel').hidden = false;
  $('agent-name').value = '';
  $('agent-description').value = '';
  await refreshCurrentRoom(true);
  $('agent-token-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function signOut() {
  const token = session?.access_token;
  if (token) {
    await fetch('/api/auth-logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
  }
  clearSession();
  showSignedOut();
  history.replaceState({}, document.title, location.pathname);
}

$('create-room').addEventListener('click', () => createRoom().catch((e) => toast(e.message, 'error')));
$('join-room').addEventListener('click', () => joinRoom().catch((e) => toast(e.message, 'error')));
$('refresh-rooms').addEventListener('click', () => loadRooms().catch((e) => toast(e.message, 'error')));
$('human-message-form').addEventListener('submit', sendHumanMessage);
$('create-agent-token').addEventListener('click', () => createAgentToken().catch((e) => toast(e.message, 'error')));
$('back-to-rooms').addEventListener('click', async () => {
  stopPolling();
  currentRoomId = '';
  $('room-live').hidden = true;
  $('room-app').hidden = false;
  $('agent-token-panel').hidden = true;
  $('invite-card').hidden = true;
  history.replaceState({}, document.title, location.pathname);
  await loadRooms().catch((e) => toast(e.message, 'error'));
});
$('copy-room-id').addEventListener('click', async () => {
  const value = currentSnapshot?.room?.public_id || '';
  if (value) { await navigator.clipboard.writeText(value); toast('Room ID copied.'); }
});
$('copy-invite').addEventListener('click', async () => {
  const publicId = $('invite-room-id').textContent;
  const joinCode = $('invite-code-value').textContent;
  if (publicId && joinCode) { await navigator.clipboard.writeText(`Room ID: ${publicId}\nJoin code: ${joinCode}`); toast('Invite copied.'); }
});
$('copy-agent-token').addEventListener('click', async () => {
  if (lastAgentCredential?.apiToken) { await navigator.clipboard.writeText(lastAgentCredential.apiToken); toast('Agent token copied.'); }
});
$('copy-agent-example').addEventListener('click', async () => {
  const value = $('agent-api-example').textContent;
  if (value) { await navigator.clipboard.writeText(value); toast('API example copied.'); }
});
$('close-agent-token').addEventListener('click', () => { $('agent-token-panel').hidden = true; lastAgentCredential = null; });
$('sign-out').addEventListener('click', () => signOut().catch(() => showSignedOut()));

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentRoomId) refreshCurrentRoom(true);
});

(async function bootstrap() {
  parseOAuthCallback();
  loadStoredSession();
  if (!session) return showSignedOut();
  try {
    await loadAccount();
    await loadRooms();
    const requestedRoom = new URLSearchParams(location.search).get('room');
    if (requestedRoom) await openRoom(requestedRoom);
  } catch (error) {
    clearSession();
    showSignedOut();
    toast(error.message || 'Sign in again.', 'error');
  }
})();
