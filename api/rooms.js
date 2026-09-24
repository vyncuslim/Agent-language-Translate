const crypto = require('crypto');
const {
  HttpError,
  adminRest,
  bodyOf,
  cleanText,
  query,
  randomToken,
  requireUser,
  secureEqualHex,
  sendError,
  sha256
} = require('./_lib/supabase');

async function getMembership(roomId, userId) {
  const rows = await adminRest(query('room_members', {
    room_id: `eq.${roomId}`,
    user_id: `eq.${userId}`,
    select: 'room_id,user_id,role,can_invite_agents,joined_at',
    limit: 1
  }));
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function requireMembership(roomId, userId) {
  const membership = await getMembership(roomId, userId);
  if (!membership) throw new HttpError(403, 'You are not a member of this room');
  return membership;
}

async function getRoomById(roomId) {
  const rows = await adminRest(query('agent_rooms', {
    id: `eq.${roomId}`,
    select: 'id,public_id,owner_id,name,topic,rules,is_active,created_at',
    limit: 1
  }));
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getRoomForJoin(publicId) {
  const rows = await adminRest(query('agent_rooms', {
    public_id: `eq.${publicId}`,
    select: 'id,public_id,owner_id,name,topic,rules,join_code_hash,is_active,created_at',
    limit: 1
  }));
  return Array.isArray(rows) ? rows[0] || null : null;
}

function displayName(user) {
  const meta = user && user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  return cleanText(meta.full_name || meta.name || user.email || 'Human', 120, 'Human');
}

async function insertMessage(message) {
  const rows = await adminRest('room_messages', {
    method: 'POST',
    body: { id: crypto.randomUUID(), ...message },
    prefer: 'return=representation'
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function listRooms(userId) {
  const memberships = await adminRest(query('room_members', {
    user_id: `eq.${userId}`,
    select: 'room_id,role,can_invite_agents,joined_at',
    order: 'joined_at.desc',
    limit: 100
  }));
  if (!Array.isArray(memberships) || !memberships.length) return [];
  const ids = memberships.map((m) => m.room_id).filter(Boolean);
  const rooms = await adminRest(query('agent_rooms', {
    id: `in.(${ids.join(',')})`,
    select: 'id,public_id,owner_id,name,topic,rules,is_active,created_at',
    order: 'created_at.desc'
  }));
  const membershipByRoom = new Map(memberships.map((m) => [m.room_id, m]));
  return (Array.isArray(rooms) ? rooms : []).map((room) => ({
    ...room,
    membership: membershipByRoom.get(room.id) || null
  }));
}

async function roomSnapshot(roomId, userId, after) {
  const membership = await requireMembership(roomId, userId);
  const room = await getRoomById(roomId);
  if (!room) throw new HttpError(404, 'Room not found');
  const messageParams = {
    room_id: `eq.${roomId}`,
    select: 'id,room_id,sender_type,sender_user_id,sender_agent_id,sender_name,content,created_at',
    order: 'created_at.asc',
    limit: 200
  };
  if (after) messageParams.created_at = `gt.${after}`;
  const [messages, agents, members] = await Promise.all([
    adminRest(query('room_messages', messageParams)),
    adminRest(query('room_agents', {
      room_id: `eq.${roomId}`,
      select: 'id,room_id,owner_user_id,name,description,status,created_at,last_seen_at',
      order: 'created_at.asc'
    })),
    adminRest(query('room_members', {
      room_id: `eq.${roomId}`,
      select: 'user_id,role,can_invite_agents,joined_at',
      order: 'joined_at.asc'
    }))
  ]);
  return { room, membership, messages: messages || [], agents: agents || [], members: members || [] };
}

async function handleGet(req, res, user) {
  const action = cleanText(req.query?.action, 40, 'list');
  if (action === 'me') {
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email || null,
        name: displayName(user)
      }
    });
  }
  if (action === 'list') return res.status(200).json({ rooms: await listRooms(user.id) });
  if (action === 'history') {
    const roomId = cleanText(req.query?.roomId, 80);
    if (!roomId) throw new HttpError(400, 'roomId is required');
    const after = cleanText(req.query?.after, 80);
    return res.status(200).json(await roomSnapshot(roomId, user.id, after));
  }
  throw new HttpError(400, 'Unknown room action');
}

async function handleCreate(res, user, body) {
  const name = cleanText(body.name, 80, 'AI Agent Room');
  const topic = cleanText(body.topic, 240);
  const rules = cleanText(body.rules, 4000);
  if (!topic) throw new HttpError(400, 'Room topic is required');
  const roomId = crypto.randomUUID();
  const publicId = randomToken('room_', 9);
  const joinCode = randomToken('join_', 18);
  const roomRows = await adminRest('agent_rooms', {
    method: 'POST',
    body: {
      id: roomId,
      public_id: publicId,
      owner_id: user.id,
      name,
      topic,
      rules,
      join_code_hash: sha256(joinCode),
      is_active: true
    },
    prefer: 'return=representation'
  });
  const room = Array.isArray(roomRows) ? roomRows[0] : roomRows;
  try {
    await adminRest('room_members', {
      method: 'POST',
      body: { room_id: roomId, user_id: user.id, role: 'owner', can_invite_agents: true },
      prefer: 'return=minimal'
    });
  } catch (error) {
    await adminRest(query('agent_rooms', { id: `eq.${roomId}` }), { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
    throw error;
  }
  await insertMessage({ room_id: roomId, sender_type: 'system', sender_user_id: null, sender_agent_id: null, sender_name: 'Room system', content: 'Room created.' });
  return res.status(201).json({ room, joinCode });
}

async function handleJoin(res, user, body) {
  const publicId = cleanText(body.publicId || body.roomCode, 80);
  const joinCode = cleanText(body.joinCode, 160);
  if (!publicId || !joinCode) throw new HttpError(400, 'Room ID and join code are required');
  const room = await getRoomForJoin(publicId);
  if (!room || !room.is_active) throw new HttpError(404, 'Room not found or inactive');
  const suppliedHash = sha256(joinCode);
  if (!secureEqualHex(suppliedHash, room.join_code_hash)) throw new HttpError(403, 'Invalid room join code');
  const existing = await getMembership(room.id, user.id);
  if (!existing) {
    await adminRest('room_members', {
      method: 'POST',
      body: { room_id: room.id, user_id: user.id, role: 'member', can_invite_agents: false },
      prefer: 'return=minimal'
    });
    await insertMessage({ room_id: room.id, sender_type: 'system', sender_user_id: null, sender_agent_id: null, sender_name: 'Room system', content: `${displayName(user)} joined the room.` });
  }
  const { join_code_hash, ...safeRoom } = room;
  return res.status(existing ? 200 : 201).json({ room: safeRoom, membership: existing || { role: 'member', can_invite_agents: false } });
}

async function handleHumanMessage(res, user, body) {
  const roomId = cleanText(body.roomId, 80);
  const content = cleanText(body.content, 16384);
  if (!roomId || !content) throw new HttpError(400, 'roomId and content are required');
  await requireMembership(roomId, user.id);
  const room = await getRoomById(roomId);
  if (!room || !room.is_active) throw new HttpError(404, 'Room not found or inactive');
  const message = await insertMessage({
    room_id: roomId,
    sender_type: 'human',
    sender_user_id: user.id,
    sender_agent_id: null,
    sender_name: displayName(user),
    content
  });
  return res.status(201).json({ message });
}

async function handleCreateAgent(req, res, user, body) {
  const roomId = cleanText(body.roomId, 80);
  const name = cleanText(body.name, 80, 'AI Agent');
  const description = cleanText(body.description, 1200);
  if (!roomId) throw new HttpError(400, 'roomId is required');
  const membership = await requireMembership(roomId, user.id);
  if (!membership.can_invite_agents && !['owner', 'moderator'].includes(membership.role)) {
    throw new HttpError(403, 'You do not have permission to add Agents to this room');
  }
  const token = randomToken('vaml_agent_', 32);
  const agentId = crypto.randomUUID();
  const rows = await adminRest('room_agents', {
    method: 'POST',
    body: {
      id: agentId,
      room_id: roomId,
      owner_user_id: user.id,
      name,
      description,
      api_token_hash: sha256(token),
      token_prefix: token.slice(0, 28),
      status: 'active'
    },
    prefer: 'return=representation'
  });
  const agent = Array.isArray(rows) ? rows[0] : rows;
  await insertMessage({ room_id: roomId, sender_type: 'system', sender_user_id: null, sender_agent_id: null, sender_name: 'Room system', content: `${name} was registered as an external AI Agent.` });
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return res.status(201).json({
    agent: { id: agent.id, room_id: agent.room_id, name: agent.name, description: agent.description, status: agent.status, created_at: agent.created_at },
    apiToken: token,
    apiEndpoint: `${proto}://${host}/api/agent`,
    note: 'This token is shown once. Store it securely; only its SHA-256 hash is stored.'
  });
}

async function handleRevokeAgent(res, user, body) {
  const roomId = cleanText(body.roomId, 80);
  const agentId = cleanText(body.agentId, 80);
  if (!roomId || !agentId) throw new HttpError(400, 'roomId and agentId are required');
  const membership = await requireMembership(roomId, user.id);
  const rows = await adminRest(query('room_agents', { id: `eq.${agentId}`, room_id: `eq.${roomId}`, select: 'id,owner_user_id,name,status', limit: 1 }));
  const agent = Array.isArray(rows) ? rows[0] : null;
  if (!agent) throw new HttpError(404, 'Agent not found');
  if (agent.owner_user_id !== user.id && !['owner', 'moderator'].includes(membership.role)) throw new HttpError(403, 'You cannot revoke this Agent');
  await adminRest(query('room_agents', { id: `eq.${agentId}` }), {
    method: 'PATCH',
    body: { status: 'revoked', revoked_at: new Date().toISOString() },
    prefer: 'return=minimal'
  });
  await insertMessage({ room_id: roomId, sender_type: 'system', sender_user_id: null, sender_agent_id: null, sender_name: 'Room system', content: `${agent.name} API access was revoked.` });
  return res.status(200).json({ ok: true });
}

async function handlePost(req, res, user) {
  const body = bodyOf(req);
  const action = cleanText(body.action, 40);
  if (action === 'create') return handleCreate(res, user, body);
  if (action === 'join') return handleJoin(res, user, body);
  if (action === 'message') return handleHumanMessage(res, user, body);
  if (action === 'create-agent') return handleCreateAgent(req, res, user, body);
  if (action === 'revoke-agent') return handleRevokeAgent(res, user, body);
  throw new HttpError(400, 'Unknown room action');
}

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  try {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'GET or POST required' });
    const { user } = await requireUser(req);
    return req.method === 'GET' ? handleGet(req, res, user) : handlePost(req, res, user);
  } catch (error) {
    return sendError(res, error);
  }
};
