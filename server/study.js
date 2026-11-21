const { WebSocketServer } = require('ws');
const { getWeekStartIST, WEEK_MS, getMemberState, isActiveMember, getActiveMembers } = require('./studyState');

const MAX_SESSION_MS = (parseFloat(process.env.MAX_SESSION_HOURS) || 6) * 3600000;
const CLEANUP_INTERVAL = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = async function (fastify, opts) {
  const db = fastify.db;
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map();
  const userConnCount = new Map();
  const userDisconnectedAt = new Map();

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

  function statePayload(db) {
    const nowMs = Date.now();
    return { server_now_ms: nowMs };
  }

  fastify.server.on('upgrade', (req, socket, head) => {
    const m = req.url.match(/^\/ws\/group\/(\d+)$/);
    if (!m) return;
    const groupId = Number(m[1]);
    const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
    req.url = (isSecure ? 'wss://' : 'ws://') + req.headers.host + req.url;
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
        userConnCount.set(session.userId, (userConnCount.get(session.userId) || 0) + 1);
        userDisconnectedAt.delete(session.userId);
        ws.send(JSON.stringify(Object.assign({
          type: 'state',
          members: getActiveMembers(db, groupId).map(r => getMemberState(db, r.id)),
        }, statePayload(db))));
        ws.on('close', () => {
          const set = connections.get(groupId);
          if (set) { set.delete(ws); if (set.size === 0) connections.delete(groupId); }
          const cnt = userConnCount.get(ws.userId) || 0;
          if (cnt <= 1) {
            userConnCount.delete(ws.userId);
            if (db.prepare('SELECT 1 FROM sessions WHERE user_id = ? AND end_ms IS NULL').get(ws.userId)) {
              userDisconnectedAt.set(ws.userId, Date.now());
            }
          } else {
            userConnCount.set(ws.userId, cnt - 1);
          }
        });
      });
    });
  });

  function broadcast(groupId, message) {
    const set = connections.get(groupId);
    if (!set) return;
    const data = JSON.stringify(Object.assign(message, statePayload(db)));
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }

  fastify.decorate('broadcastToGroup', broadcast);

  function broadcastUser(userId) {
    const groups = db.prepare(
      "SELECT group_id FROM memberships WHERE user_id = ? AND status = 'active'"
    ).all(userId);
    const state = getMemberState(db, userId);
    const payload = Object.assign({ type: 'update', member: state }, statePayload(db));
    for (const g of groups) broadcast(g.group_id, payload);
  }

  fastify.post('/group/:id/start', async (req, reply) => {
    const groupId = Number(req.params.id);
    if (!isActiveMember(db, groupId, req.session.userId)) {
      return reply.code(403).send({ ok: false });
    }
    const now = Date.now();
    db.prepare(
      'UPDATE sessions SET end_ms = ? WHERE user_id = ? AND end_ms IS NULL'
    ).run(now, req.session.userId);
    db.prepare(
      'INSERT INTO sessions (user_id, start_ms, end_ms, last_heartbeat_ms) VALUES (?, ?, NULL, ?)'
    ).run(req.session.userId, now, now);
    broadcastUser(req.session.userId);
    return reply.send({ ok: true, startMs: now });
  });

  fastify.post('/group/:id/stop', async (req, reply) => {
    const groupId = Number(req.params.id);
    if (!isActiveMember(db, groupId, req.session.userId)) {
      return reply.code(403).send({ ok: false });
    }
    const session = db.prepare(
      'SELECT start_ms FROM sessions WHERE user_id = ? AND end_ms IS NULL'
    ).get(req.session.userId);
    if (!session) return reply.code(400).send({ ok: false, error: 'not studying' });
    const now = Date.now();
    let endMs = req.body && req.body.endMs ? parseInt(req.body.endMs, 10) : now;
    if (isNaN(endMs) || endMs > now) endMs = now;
    const minEndMs = session.start_ms + 60000;
    if (endMs < minEndMs) endMs = now;
    db.prepare(
      'UPDATE sessions SET end_ms = ? WHERE user_id = ? AND end_ms IS NULL'
    ).run(endMs, req.session.userId);
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

  fastify.get('/api/session/current', async (req, reply) => {
    if (!req.session.userId) return reply.send({ session: null, server_now_ms: Date.now() });
    const row = db.prepare(
      'SELECT start_ms, last_heartbeat_ms FROM sessions WHERE user_id = ? AND end_ms IS NULL'
    ).get(req.session.userId);
    return reply.send({ session: row || null, server_now_ms: Date.now() });
  });

  function getISTOffset(ms) {
    return ms + 5.5 * 60 * 60 * 1000;
  }

  function dailyTotalsForGroup(db, groupId, weekStart) {
    const members = db.prepare(`
      SELECT u.id, u.username, u.avatar
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ? AND m.status = 'active'
      ORDER BY u.username
    `).all(groupId);

    const now = Date.now();
    const days = [];

    for (let d = 0; d < 7; d++) {
      const dayStart = weekStart + d * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const dayLabel = new Date(getISTOffset(dayStart)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });

      const dayData = members.map(m => {
        const row = db.prepare(`
          SELECT COALESCE(SUM(
            MIN(COALESCE(s.end_ms, ?), ?) - MAX(s.start_ms, ?)
          ), 0) AS total_ms
          FROM sessions s
          WHERE s.user_id = ?
            AND s.start_ms < ?
            AND (s.end_ms IS NULL OR s.end_ms > ?)
        `).get(now, dayEnd, dayStart, m.id, dayEnd, dayStart);
        return { userId: m.id, username: m.username, minutes: Math.round(row.total_ms / 60000) };
      });

      days.push({ label: dayLabel, data: dayData });
    }
    return { days, members: members.map(m => ({ userId: m.id, username: m.username, hasAvatar: !!m.avatar })) };
  }

  fastify.get('/api/group/:id/study/daily', async (req, reply) => {
    const groupId = Number(req.params.id);
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return reply.code(404).send({ ok: false });

    if (!isActiveMember(db, groupId, req.session.userId)) {
      return reply.code(403).send({ ok: false, error: 'not a member' });
    }

    const raw = req.query.week;
    let weekStart;
    if (raw) {
      const parsed = new Date(raw + 'T00:00:00+05:30');
      if (isNaN(parsed.getTime())) return reply.code(400).send({ ok: false, error: 'invalid week' });
      weekStart = parsed.getTime();
    } else {
      weekStart = getWeekStartIST();
    }

    const result = dailyTotalsForGroup(db, groupId, weekStart);
    return reply.send({ ok: true, weekStart, days: result.days, members: result.members });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [userId, disconnectedAt] of userDisconnectedAt) {
      if (now - disconnectedAt >= MAX_SESSION_MS) {
        const endMs = now - MAX_SESSION_MS;
        const info = db.prepare(
          'UPDATE sessions SET end_ms = ? WHERE user_id = ? AND end_ms IS NULL'
        ).run(endMs, userId);
        if (info.changes > 0) {
          broadcastUser(userId);
          fastify.log.info('closed session for user %d (disconnected > MAX_SESSION_HOURS)', userId);
        }
        userDisconnectedAt.delete(userId);
      }
    }
  }, CLEANUP_INTERVAL);
};