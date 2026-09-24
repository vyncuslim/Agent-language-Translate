const crypto = require('crypto');
const {
  HttpError,
  adminRest,
  bearer,
  bodyOf,
  cleanText,
  query,
  sendError,
  sha256
} = require('./_lib/supabase');

async function requireAgent(req) {
  const token = bearer(req);
  if (!token || !token.startsWith('vaml_agent_') || token.length > 256) throw new HttpError(401, 'AI Agent API token required');
  const hash = sha256(token);
  const rows = await adminRest(query('room_agents', {
    api_token_hash: `eq.${hash}`,
    status: 'eq.active',
    select: 'id,room_id,owner_user_id,name,description,status,created_at,last_seen_at',
    limit: 1
  }));
  const agent = Array.isArray(rows) ? rows[0] : null;
  if (!agent) throw new HttpError(401, 'Invalid or revoked AI Agent API token');
  await adminRest(query('room_agents', { id: `eq.${agent.id}` }), {
    method: 'PATCH',
    body: { last_seen_at: new Date().toISOString() },
    prefer: 'return=minimal'
  }).catch(() => {});
  return agent;
}

async function getRoom(roomId) {
  const rows = await adminRest(query('agent_rooms', {
    id: `eq.${roomId}`,
    select: 'id,public_id,name,topic,rules,is_active,created_at',
    limit: 1
  }));
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getMessages(roomId, after) {
  const params = {
    room_id: `eq.${roomId}`,
    select: 'id,sender_type,sender_user_id,sender_agent_id,sender_name,content,created_at',
    order: 'created_at.asc',
    limit: 200
  };
  if (after) params.created_at = `gt.${after}`;
  return await adminRest(query('room_messages', params)) || [];
}

async function getParticipants(roomId) {
  const agents = await adminRest(query('room_agents', {
    room_id: `eq.${roomId}`,
    status: 'eq.active',
    select: 'id,name,description,status,last_seen_at,created_at',
    order: 'created_at.asc'
  }));
  return { agents: agents || [] };
}

module.exports = async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  try {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'GET or POST required' });
    const agent = await requireAgent(req);
    const room = await getRoom(agent.room_id);
    if (!room || !room.is_active) throw new HttpError(403, 'This room is inactive');

    if (req.method === 'GET') {
      const after = cleanText(req.query?.after, 80);
      const [messages, participants] = await Promise.all([
        getMessages(room.id, after),
        getParticipants(room.id)
      ]);
      return res.status(200).json({
        agent: { id: agent.id, name: agent.name, description: agent.description },
        room,
        ...participants,
        messages
      });
    }

    const body = bodyOf(req);
    const action = cleanText(body.action, 32, 'message');
    if (action === 'heartbeat') return res.status(200).json({ ok: true, agentId: agent.id, roomId: room.id });
    if (action !== 'message') throw new HttpError(400, 'Unknown Agent action');
    const content = cleanText(body.content, 16384);
    if (!content) throw new HttpError(400, 'content is required');
    const rows = await adminRest('room_messages', {
      method: 'POST',
      body: {
        id: crypto.randomUUID(),
        room_id: room.id,
        sender_type: 'agent',
        sender_user_id: null,
        sender_agent_id: agent.id,
        sender_name: agent.name,
        content
      },
      prefer: 'return=representation'
    });
    const message = Array.isArray(rows) ? rows[0] : rows;
    return res.status(201).json({ message });
  } catch (error) {
    return sendError(res, error);
  }
};
