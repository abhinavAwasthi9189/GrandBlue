const { WebSocketServer } = require('ws');
const { getMemberState, isActiveMember, getActiveMembers } = require('./studyState');

const STALE_MS = 3 * 60 * 1000;
const CLEANUP_INTERVAL = 60 * 1000;

module.exports = async function (fastify, opts) {
  const db = fastify.db;
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map();

  function parseCookies(header) {
    const out = {};
    for (const part of (header || '').split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    }
    return out;
  }

  function decodeSessionId(value) {
    const prefix = '@fastify/session:v1.';
    if (value.startsWith(prefix)) {
      try {
        const decoded = JSON.parse(Buffer.from(value.slice(prefix.length), 'base64url').toString());
        if (Array.isArray(decoded) && decoded.length === 2 && typeof decoded[0] === 'string') {
          return decoded[0];
        }
      } catch {}
    }
    return value;
  }

  fastify.server.on('upgrade', (req, socket, head) => {
    const m = req.url.match(/^\/ws\/group\/(\d+)$/);
    if (!m) return;
    const groupId = Number(m[1]);
    const sessionCookie = parseCookies(req.headers.cookie).sessionId;
    if (!sessionCookie) { socket.destroy(); return; }
    const unsigned = opts.cookieSigner.unsign(sessionCookie);
    if (!unsigned.valid) { socket.destroy(); return; }
    const storeId = decodeSessionId(unsigned.value);
    opts.sessionStore.get(storeId, (err, session) => {
      if (err || !session || !session.userId) { socket.destroy(); return; }
      if (!isActiveMember(db, groupId, session.userId)) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.userId = session.userId;
        ws.groupId = groupId;
        if (!connections.has(groupId)) connections.set(groupId, new Set());
        connections.get(groupId).add(ws);
        ws.send(JSON.stringify({
          type: 'state',
          members: getActiveMembers(db, groupId).map(r => getMemberState(db, r.id)),
        }));
        ws.on('close', () => {
          const set = connections.get(groupId);
          if (set) { set.delete(ws); if (set.size === 0) connections.delete(groupId); }
        });
      });
    });
  });

  function broadcast(groupId, message) {
    const set = connections.get(groupId);
    if (!set) return;
    const data = JSON.stringify(message);
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }

  function broadcastUser(userId) {
    const groups = db.prepare(
      "SELECT group_id FROM memberships WHERE user_id = ? AND status = 'active'"
    ).all(userId);
    const state = getMemberState(db, userId);
    for (const g of groups) broadcast(g.group_id, { type: 'update', member: state });
  }

  fastify.post('/group/:id/start', async (req, reply) => {
    const groupId = Number(req.params.id);
    if (!isActiveMember(db, groupId, req.session.userId)) {
      return reply.code(403).send({ ok: false });
    }
    const open = db.prepare(
      'SELECT 1 FROM sessions WHERE user_id = ? AND end_ms IS NULL'
    ).get(req.session.userId);
    if (open) return reply.code(400).send({ ok: false, error: 'already studying' });
    const now = Date.now();
    db.prepare(
      'INSERT INTO sessions (user_id, start_ms, end_ms, last_heartbeat_ms) VALUES (?, ?, NULL, ?)'
    ).run(req.session.userId, now, now);
    broadcastUser(req.session.userId);
    return reply.send({ ok: true });
  });

  fastify.post('/group/:id/stop', async (req, reply) => {
    const groupId = Number(req.params.id);
    if (!isActiveMember(db, groupId, req.session.userId)) {
      return reply.code(403).send({ ok: false });
    }
    const info = db.prepare(
      'UPDATE sessions SET end_ms = ? WHERE user_id = ? AND end_ms IS NULL'
    ).run(Date.now(), req.session.userId);
    if (info.changes === 0) return reply.code(400).send({ ok: false, error: 'not studying' });
    broadcastUser(req.session.userId);
    return reply.send({ ok: true });
  });

  fastify.post('/group/:id/heartbeat', async (req, reply) => {
    const groupId = Number(req.params.id);
    if (!isActiveMember(db, groupId, req.session.userId)) {
      return reply.code(403).send({ ok: false });
    }
    const info = db.prepare(
      'UPDATE sessions SET last_heartbeat_ms = ? WHERE user_id = ? AND end_ms IS NULL'
    ).run(Date.now(), req.session.userId);
    return reply.send({ ok: info.changes > 0 });
  });

  setInterval(() => {
    const cutoff = Date.now() - STALE_MS;
    const stale = db.prepare(
      'SELECT id, user_id FROM sessions WHERE end_ms IS NULL AND last_heartbeat_ms < ?'
    ).all(cutoff);
    for (const s of stale) {
      db.prepare('UPDATE sessions SET end_ms = last_heartbeat_ms WHERE id = ?').run(s.id);
      broadcastUser(s.user_id);
    }
    if (stale.length) fastify.log.info('closed %d stale sessions', stale.length);
  }, CLEANUP_INTERVAL);
};