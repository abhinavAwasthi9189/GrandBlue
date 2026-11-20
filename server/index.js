const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Fastify = require('fastify');
const studyState = require('./studyState');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      const v = m[2].replace(/^["']|["']$/g, '');
      process.env[m[1]] = v;
    }
  }
}

const fastify = Fastify({
  logger: true,
  trustProxy: (addr) => addr === '127.0.0.1' || addr === '::1',
});

fastify.register(require('@fastify/formbody'));
fastify.register(require('@fastify/cookie'));



fastify.register(require('@fastify/helmet'), {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://leetcode.com"],
      connectSrc: ["'self'", "https://leetcode.com"],
      frameAncestors: ["'none'"],
    },
  },
  xFrameOptions: { action: 'deny' },
  xContentTypeOptions: true,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: false,
});

// Serve static files from both web/dist and public/
const staticDirs = [
  path.join(__dirname, '..', 'web', 'dist'),
  path.join(__dirname, '..', 'public'),
].filter(d => require('fs').existsSync(d));
if (staticDirs.length > 0) {
  fastify.register(require('@fastify/static'), {
    root: staticDirs,
    prefix: '/',
    wildcard: false,
  });
}

const AVATAR_DIR = path.join(__dirname, '..', 'data', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const { Signer } = require('@fastify/cookie');
const sessionPlugin = require('@fastify/session');
if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in .env or environment');
  process.exit(1);
}
const SESSION_SECRET = process.env.SESSION_SECRET;
const sessionStore = new sessionPlugin.Store();
const cookieSigner = new Signer(SESSION_SECRET, 'sha256');

fastify.register(sessionPlugin, {
  secret: SESSION_SECRET,
  store: sessionStore,
  cookie: { secure: 'auto', httpOnly: true, sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
  saveUninitialized: false,
});

fastify.register(require('@fastify/view'), {
  engine: { ejs: require('ejs') },
  root: path.join(__dirname, '..', 'views'),
});

fastify.addHook('onSend', async (req, reply, payload) => {
  if (req.url.startsWith('/ws/')) return;
  if (req.url === '/sw.js') {
    reply.header('Cache-Control', 'no-cache');
    return;
  }
  if (/\.(js|css|png|jpg|svg|ico|webmanifest)$/.test(req.url)) return;
  reply.header('Cache-Control', 'no-store');
});

fastify.decorate('db', require('./db'));

fastify.register(require('./auth'));
fastify.register(require('./groups'));
fastify.register(require('./study'), { sessionStore, cookieSigner });
fastify.register(require('./history'));
fastify.register(require('./push'));

fastify.get('/push-debug', async (req, reply) => {
  if (!req.session.userId) return reply.redirect('/login');
  return reply.view('push-debug', { session: req.session });
});

fastify.get('/push/subscriptions-for-user', async (req, reply) => {
  if (!req.session.userId) return reply.send({ endpoints: [], count: 0 });
  const rows = fastify.db.prepare(
    'SELECT endpoint FROM push_subscriptions WHERE user_id = ?'
  ).all(req.session.userId);
  return reply.send({ endpoints: rows.map(r => r.endpoint), count: rows.length });
});
fastify.register(require('./leetwars'));
fastify.register(require('./stats'));

// Serve avatar images
fastify.get('/avatar/:userId', async (req, reply) => {
  const filePath = path.join(AVATAR_DIR, req.params.userId + '.png');
  if (fs.existsSync(filePath)) {
    return reply.type('image/png').send(fs.readFileSync(filePath));
  }
  return reply.code(404).send('Not found');
});

// Upload avatar (accepts base64 data URL)
fastify.post('/avatar', async (req, reply) => {
  if (!req.session.userId) return reply.code(401).send({ ok: false });
  const { image } = req.body;
  if (!image || !image.startsWith('data:image/')) {
    return reply.send({ ok: false, error: 'Invalid image data' });
  }
  const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) return reply.send({ ok: false, error: 'Unsupported format' });
  const buffer = Buffer.from(matches[2], 'base64');
  const filePath = path.join(AVATAR_DIR, req.session.userId + '.png');
  fs.writeFileSync(filePath, buffer);
  fastify.db.prepare('UPDATE users SET avatar = 1 WHERE id = ?').run(req.session.userId);
  return reply.send({ ok: true });
});

fastify.get('/', async (req, reply) => {
  if (!req.session.userId) return reply.redirect('/login');

  const db = fastify.db;
  const userId = req.session.userId;

  const myGroups = db.prepare(`
    SELECT g.id, g.name, g.weekly_quota, g.created_at, m.role, m.status
    FROM memberships m JOIN groups g ON g.id = m.group_id
    WHERE m.user_id = ? AND m.status = 'active'
    ORDER BY g.name
  `).all(userId).map(g => {
    const activeMembers = db.prepare(
      "SELECT COUNT(*) AS cnt FROM memberships WHERE group_id = ? AND status = 'active'"
    ).get(g.id).cnt;

    const studyingNow = db.prepare(`
      SELECT COUNT(*) AS cnt FROM sessions s
      JOIN memberships m ON m.user_id = s.user_id AND m.group_id = ? AND m.status = 'active'
      WHERE s.end_ms IS NULL
    `).get(g.id).cnt;

    const weekStart = studyState.getWeekStartIST();
    const myWeekMs = studyState.weekTotalForUser(db, userId, weekStart);

    return { ...g, memberCount: activeMembers, studyingNow, myWeekMs };
  });

  const pendingInvites = db.prepare(`
    SELECT g.id, g.name, m.created_at, inviter.username AS invited_by
    FROM memberships m
    JOIN groups g ON g.id = m.group_id
    JOIN memberships m2 ON m2.group_id = g.id AND m2.role = 'admin' AND m2.status = 'active'
    JOIN users inviter ON inviter.id = m2.user_id
    WHERE m.user_id = ? AND m.status = 'invited'
  `).all(userId);

  const pendingRequests = db.prepare(`
    SELECT g.id, g.name, m.status, m.created_at
    FROM memberships m JOIN groups g ON g.id = m.group_id
    WHERE m.user_id = ? AND m.status = 'requested'
  `).all(userId);

  const user = db.prepare('SELECT leetcode_username FROM users WHERE id = ?').get(userId);
  const hasLeetcode = !!user.leetcode_username;

  return reply.view('home', { session: req.session, myGroups, pendingInvites, pendingRequests, hasLeetcode, error: req.query.error || null });
});

fastify.get('/you', async (req, reply) => {
  if (!req.session.userId) return reply.redirect('/login');
  const db = fastify.db;
  const userId = req.session.userId;
  const user = db.prepare('SELECT id, username, leetcode_username, avatar FROM users WHERE id = ?').get(userId);
  const membershipCount = db.prepare(
    "SELECT COUNT(*) AS cnt FROM memberships WHERE user_id = ? AND status = 'active'"
  ).get(userId).cnt;
  const hasLeetcode = !!user.leetcode_username;
  return reply.view('you', { session: req.session, username: user.username, membershipCount, hasLeetcode, leetcodeUsername: user.leetcode_username || '', hasAvatar: !!user.avatar });
});

fastify.get('/change-password', async (req, reply) => {
  if (!req.session.userId) return reply.redirect('/login');
  return reply.view('change-password', { session: req.session, error: null });
});

fastify.post('/change-password', async (req, reply) => {
  if (!req.session.userId) return reply.redirect('/login');
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return reply.view('change-password', { session: req.session, error: 'Both fields required' });
  }
  if (new_password.length < 4) {
    return reply.view('change-password', { session: req.session, error: 'New password min 4 chars' });
  }
  const argon2 = require('argon2');
  const user = fastify.db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const valid = await argon2.verify(user.password_hash, current_password);
  if (!valid) {
    return reply.view('change-password', { session: req.session, error: 'Current password is wrong' });
  }
  const hash = await argon2.hash(new_password);
  fastify.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
  return reply.view('change-password', { session: req.session, success: true });
});

fastify.setNotFoundHandler(async (req, reply) => {
  return reply.view('404', { session: req.session || {} });
});

fastify.setErrorHandler(async (err, req, reply) => {
  if (reply.statusCode === 404) return reply.view('404', { session: req.session || {} });
  const message = process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message;
  return reply.view('error', { session: req.session || {}, message });
});

async function start() {
  try {
    const port = parseInt(process.env.PORT, 10) || 3000;
    await fastify.listen({ port, host: '127.0.0.1' });
    fastify.log.info(`server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();