const webpush = require('web-push');
const { isActiveMember } = require('./studyState');
const rateLimit = require('./rateLimit');

const testPushRL = rateLimit({ max: 5, windowMs: 60_000 });

const ALLOWED_PUSH_HOSTS = [
  'fcm.googleapis.com',
  '.push.apple.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
];

function isAllowedPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_PUSH_HOSTS.some(h =>
      h.startsWith('.') ? url.hostname.endsWith(h) : url.hostname === h
    );
  } catch { return false; }
}

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:abs@example.com';

const VAPID_CFG = VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY;
if (VAPID_CFG) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const VAPID_SUBJECT_VALID = VAPID_SUBJECT.startsWith('mailto:') || VAPID_SUBJECT.startsWith('https://');

const COOLDOWN_MS = 10 * 60 * 1000;

function requireAuth(req, reply) {
  if (!req.session.userId) {
    reply.code(401).send({ ok: false });
    return false;
  }
  return true;
}

async function sendPush(db, userId, title, body, url) {
  if (!VAPID_CFG) return;
  const subs = db.prepare(
    'SELECT endpoint, keys_json FROM push_subscriptions WHERE user_id = ?'
  ).all(userId);
  const payload = JSON.stringify({ title, body, icon: '/icon.svg', data: { url } });
  for (const sub of subs) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: JSON.parse(sub.keys_json),
      }, payload);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      }
    }
  }
}

module.exports = async function (fastify, opts) {
  const db = fastify.db;

  fastify.decorate('sendPush', (userId, title, body, url) => sendPush(db, userId, title, body, url));

  if (VAPID_CFG) {
    fastify.log.info('VAPID keys present; public key starts with: %s', VAPID_PUBLIC_KEY.slice(0, 6));
    fastify.log.info('VAPID_SUBJECT valid (starts with mailto: or https://): %s', VAPID_SUBJECT_VALID);
  } else {
    fastify.log.warn('VAPID keys not set — push notifications disabled. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
  }

  fastify.get('/push/vapid-public-key', async (req, reply) => {
    return reply.send({ key: VAPID_PUBLIC_KEY || '' });
  });

  fastify.post('/api/push/test', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    { const r = testPushRL(req, reply); if (r !== true) return r; }

    const subs = db.prepare(
      'SELECT id, endpoint, keys_json FROM push_subscriptions WHERE user_id = ?'
    ).all(req.session.userId);

    if (subs.length === 0) {
      return reply.send({ ok: true, results: [] });
    }

    const payload = JSON.stringify({
      title: 'GrandBlue Test',
      body: 'GrandBlue Test',
      icon: '/icon.svg',
      data: { url: '/' },
    });

    const results = [];
    for (const sub of subs) {
      const result = { id: sub.id, host: '', status: 0, error: null };
      try {
        const url = new URL(sub.endpoint);
        result.host = url.hostname;
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: JSON.parse(sub.keys_json),
        }, payload);
        result.status = 201;
      } catch (err) {
        result.status = err.statusCode || 0;
        result.error = err.body || err.message || String(err);
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
        }
      }
      results.push(result);
    }
    return reply.send({ ok: true, results });
  });

  fastify.get('/push/status', async (req, reply) => {
    if (!req.session.userId) return reply.send({ subscribed: false });
    const sub = fastify.db.prepare(
      'SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1'
    ).get(req.session.userId);
    return reply.send({ subscribed: !!sub, vapidConfigured: !!VAPID_CFG });
  });

  fastify.post('/push/subscribe', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return reply.code(400).send({ ok: false });
    }
    if (!isAllowedPushEndpoint(endpoint)) {
      return reply.code(400).send({ ok: false, error: 'invalid endpoint' });
    }

    const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
    if (existing) {
      db.prepare('UPDATE push_subscriptions SET keys_json = ? WHERE id = ?')
        .run(JSON.stringify(keys), existing.id);
      return reply.send({ ok: true });
    }

    db.prepare(
      'INSERT INTO push_subscriptions (user_id, endpoint, keys_json, created_at) VALUES (?, ?, ?, ?)'
    ).run(req.session.userId, endpoint, JSON.stringify(keys), Date.now());

    return reply.send({ ok: true });
  });

  fastify.post('/push/unsubscribe', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { endpoint } = req.body;
    if (!endpoint) return reply.code(400).send({ ok: false });

    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
      .run(endpoint, req.session.userId);

    return reply.send({ ok: true });
  });

  fastify.post('/group/:id/nudge/:userId', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const groupId = Number(req.params.id);
    const targetId = Number(req.params.userId);
    const senderId = req.session.userId;

    if (senderId === targetId) {
      return reply.send({ ok: false, error: 'Cannot nudge yourself' });
    }

    if (!isActiveMember(db, groupId, senderId) || !isActiveMember(db, groupId, targetId)) {
      return reply.send({ ok: false, error: 'Both users must be active members' });
    }

    const recent = db.prepare(
      'SELECT 1 FROM nudges WHERE from_user = ? AND to_user = ? AND group_id = ? AND created_at > ?'
    ).get(senderId, targetId, groupId, Date.now() - COOLDOWN_MS);

    if (recent) {
      return reply.send({ ok: false, error: 'Cooldown active. Try again later.' });
    }

    const now = Date.now();
    db.prepare(
      'INSERT INTO nudges (from_user, to_user, group_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(senderId, targetId, groupId, now);

    // Real-time nudge via WebSocket
    if (typeof fastify.broadcastToGroup === 'function') {
      fastify.broadcastToGroup(groupId, {
        type: 'nudge',
        fromUserId: senderId,
        fromUsername: req.session.username || 'Someone',
        targetUserId: targetId,
      });
    }

    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      const subs = db.prepare(
        'SELECT endpoint, keys_json FROM push_subscriptions WHERE user_id = ?'
      ).all(targetId);

      const targetUsername = db.prepare('SELECT username FROM users WHERE id = ?').get(targetId);
      const targetName = targetUsername ? targetUsername.username : String(targetId);

      fastify.log.info('nudge sender=%d target=%d subs=%d', senderId, targetId, subs.length);

      if (subs.length === 0) {
        fastify.log.warn('nudge: target %d has zero subscriptions', targetId);
        return reply.send({ ok: true, noPush: true, targetName });
      }

      const senderName = req.session.username || 'Someone';
      const nudgeType = req.body && req.body.type === 'leetwars' ? 'leetwars' : 'study';
      const body = nudgeType === 'leetwars'
        ? senderName + ' says its time for another Leetcode problem!!'
        : senderName + ' calling you to study. Tap to join the session.';

      const payload = JSON.stringify({
        title: 'GrandBlue',
        body,
        icon: '/icon.svg',
        data: { url: '/group/' + groupId },
      });

      for (const sub of subs) {
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: JSON.parse(sub.keys_json),
          }, payload);
          fastify.log.info('nudge send to %s ok', sub.endpoint.slice(0, 40));
        } catch (err) {
          fastify.log.warn(
            'nudge send to %s status=%s body=%s',
            sub.endpoint.slice(0, 40),
            err.statusCode || '?',
            err.body || err.message || ''
          );
          if (err.statusCode === 404 || err.statusCode === 410) {
            db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
            fastify.log.info('deleted stale subscription for %s', sub.endpoint.slice(0, 40));
          }
        }
      }
    }

    return reply.send({ ok: true });
  });
};
