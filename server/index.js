const Fastify = require('fastify');
const path = require('path');

const fastify = Fastify({ logger: true });

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

fastify.register(require('@fastify/session'), {
  secret: process.env.SESSION_SECRET || 'abs-dev-secret-change-in-prod-32chars!!',
  cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  saveUninitialized: false,
});

fastify.register(require('@fastify/view'), {
  engine: { ejs: require('ejs') },
  root: path.join(__dirname, '..', 'views'),
});

fastify.decorate('db', require('./db'));

fastify.register(require('./auth'));

fastify.get('/', async (req, reply) => {
  if (!req.session.userId) return reply.redirect('/login');
  return reply.view('home', { session: req.session });
});

async function start() {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    fastify.log.info(`server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();