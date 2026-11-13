const fs = require('fs');
const path = require('path');
const Fastify = require('fastify');

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

const staticDir = path.join(__dirname, '..', 'web', 'dist');
if (require('fs').existsSync(staticDir)) {
  fastify.register(require('@fastify/static'), {
    root: staticDir,
    prefix: '/',
    wildcard: false,
  });
}

const { Signer } = require('@fastify/cookie');
const sessionPlugin = require('@fastify/session');
const SESSION_SECRET = process.env.SESSION_SECRET || 'abs-dev-secret-change-in-prod-32chars!!';
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

fastify.decorate('db', require('./db'));

fastify.register(require('./auth'));
fastify.register(require('./groups'));
fastify.register(require('./study'), { sessionStore, cookieSigner });
fastify.register(require('./history'));
fastify.register(require('./push'));

fastify.get('/', async (req, reply) => {
  if (!req.session.userId) return reply.redirect('/login');

  const myGroups = fastify.db.prepare(`
    SELECT g.id, g.name, g.weekly_quota, g.created_at, m.role, m.status
    FROM memberships m JOIN groups g ON g.id = m.group_id
    WHERE m.user_id = ? AND m.status = 'active'
    ORDER BY g.name
  `).all(req.session.userId);

  const pendingInvites = fastify.db.prepare(`
    SELECT g.id, g.name, m.status, m.created_at
    FROM memberships m JOIN groups g ON g.id = m.group_id
    WHERE m.user_id = ? AND m.status = 'invited'
  `).all(req.session.userId);

  const pendingRequests = fastify.db.prepare(`
    SELECT g.id, g.name, m.status, m.created_at
    FROM memberships m JOIN groups g ON g.id = m.group_id
    WHERE m.user_id = ? AND m.status = 'requested'
  `).all(req.session.userId);

  return reply.view('home', { session: req.session, myGroups, pendingInvites, pendingRequests, error: req.query.error || null });
});

async function start() {
  try {
    const port = parseInt(process.env.PORT, 10) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();