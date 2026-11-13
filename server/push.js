const webpush = require('web-push');
const { isActiveMember } = require('./studyState');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:abs@example.com';

const VAPID_CFG = VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY;
if (VAPID_CFG) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const COOLDOWN_MS = 10 * 60 * 1000;

function requireAuth(req, reply) {
  if (!req.session.userId) {
    reply.code(401).send({ ok: false });
    return false;
  }
  return true;
}

module.exports = async function (fastify, opts) {
  const db = fastify.db;

  if (!VAPID_CFG) {
    fastify.log.warn('VAPID keys not set — push notifications disabled. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
  }

  fastify.get('/push/vapid-public-key', async (req, reply) => {
    return reply.send({ key: VAPID_PUBLIC_KEY || '' });
  });

  fastify.post('/push/subscribe', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return reply.code(400).send({ ok: false });
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

    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      const subs = db.prepare(
        'SELECT endpoint, keys_json FROM push_subscriptions WHERE user_id = ?'
      ).all(targetId);

      const payload = JSON.stringify({
        title: 'abs',
        body: 'Time to study together',
        icon: '/icon.svg',
        data: { url: '/group/' + groupId },
      });

      for (const sub of subs) {
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: JSON.parse(sub.keys_json),
          }, payload);
        } catch (err) {
          fastify.log.warn('push send failed to %s: %s', sub.endpoint.slice(0, 40), err.message || err);
          if (err.statusCode === 404 || err.statusCode === 410) {
            db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
            fastify.log.info('deleted stale subscription %s', sub.endpoint.slice(0, 40));
          }
        }
      }
    }

    return reply.send({ ok: true });
  });
};
