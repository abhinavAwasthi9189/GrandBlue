const argon2 = require('argon2');

module.exports = async function (fastify, opts) {
  fastify.get('/register', async (req, reply) => {
    if (req.session.userId) return reply.redirect('/');
    return reply.view('register');
  });

  fastify.post('/register', async (req, reply) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return reply.view('register', { error: 'Username and password required' });
    }
    if (username.length < 2 || password.length < 4) {
      return reply.view('register', { error: 'Username min 2 chars, password min 4 chars' });
    }

    const existing = fastify.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return reply.view('register', { error: 'Username taken' });
    }

    const hash = await argon2.hash(password);
    const createdAt = Date.now();
    fastify.db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(username, hash, createdAt);

    req.session.userId = fastify.db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
    req.session.username = username;
    return reply.redirect('/');
  });

  fastify.get('/login', async (req, reply) => {
    if (req.session.userId) return reply.redirect('/');
    return reply.view('login');
  });

  fastify.post('/login', async (req, reply) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return reply.view('login', { error: 'Username and password required' });
    }

    const user = fastify.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return reply.view('login', { error: 'Invalid credentials' });
    }

    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) {
      return reply.view('login', { error: 'Invalid credentials' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    return reply.redirect('/');
  });

  fastify.get('/logout', async (req, reply) => {
    req.session.destroy();
    return reply.redirect('/login');
  });
};