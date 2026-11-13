const crypto = require('crypto');
const studyState = require('./studyState');

module.exports = async function (fastify, opts) {
  fastify.addHook('onRequest', async (req, reply) => {
    if (!req.session.userId) return reply.redirect('/login');
  });

  fastify.get('/create-group', async (req, reply) => {
    return reply.view('create-group', { session: req.session });
  });

  fastify.post('/create-group', async (req, reply) => {
    const { name, weekly_quota } = req.body;
    if (!name || name.trim().length < 1) {
      return reply.view('create-group', { session: req.session, error: 'Group name required' });
    }
    const quota = parseInt(weekly_quota, 10) || 0;
    const now = Date.now();

    const insert = fastify.db.transaction(() => {
      const info = fastify.db.prepare(
        'INSERT INTO groups (name, owner_id, weekly_quota, created_at) VALUES (?, ?, ?, ?)'
      ).run(name.trim(), req.session.userId, quota, now);

      fastify.db.prepare(
        'INSERT INTO memberships (group_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(info.lastInsertRowid, req.session.userId, 'admin', 'active', now);
    });
    insert();

    return reply.redirect('/');
  });

  fastify.get('/group/:id', async (req, reply) => {
    const group = fastify.db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
    if (!group) return reply.callNotFound();

    const membership = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ?'
    ).get(req.params.id, req.session.userId);
    if (!membership) {
      return reply.view('group', { session: req.session, group, membership: null, members: [], pendingRequests: [], isMember: false });
    }

    let members = [];
    if (membership.status === 'active') {
      members = studyState.getActiveMembers(fastify.db, req.params.id).map(m => ({
        ...studyState.getMemberState(fastify.db, m.id),
        role: m.role,
      }));
    }

    let pendingRequests = [];
    if (membership.role === 'admin' && membership.status === 'active') {
      pendingRequests = fastify.db.prepare(`
        SELECT u.id, u.username, m.created_at
        FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = ? AND m.status = 'requested' ORDER BY m.created_at
      `).all(req.params.id);
    }

    const inviteLinks = fastify.db.prepare(`
      SELECT code, expires_at FROM invites WHERE group_id = ? AND expires_at > ?
    `).all(req.params.id, Date.now());

    return reply.view('group', { session: req.session, group, membership, members, pendingRequests, inviteLinks, isMember: true, error: req.query.error || null });
  });

  fastify.post('/group/:id/invite', async (req, reply) => {
    const { username } = req.body;
    if (!username) return reply.redirect('/group/' + req.params.id);

    const group = fastify.db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
    if (!group) return reply.redirect('/');

    const membership = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ? AND role = ? AND status = ?'
    ).get(req.params.id, req.session.userId, 'admin', 'active');
    if (!membership) return reply.redirect('/group/' + req.params.id);

    const target = fastify.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!target) return reply.redirect('/group/' + req.params.id);

    const existing = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ?'
    ).get(req.params.id, target.id);
    if (existing) return reply.redirect('/group/' + req.params.id);

    const cap = fastify.db.transaction(() => {
      const active = fastify.db.prepare(
        "SELECT COUNT(*) AS cnt FROM memberships WHERE group_id = ? AND status = 'active'"
      ).get(req.params.id).cnt;

      if (active >= 15) {
        throw new Error('Group is full (max 15 active members)');
      }

      fastify.db.prepare(
        'INSERT INTO memberships (group_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(req.params.id, target.id, 'member', 'invited', Date.now());
    });

    try {
      cap();
    } catch (e) {
      return reply.redirect('/group/' + req.params.id + '?error=' + encodeURIComponent(e.message));
    }

    return reply.redirect('/group/' + req.params.id);
  });

  fastify.get('/invite-link/:id', async (req, reply) => {
    const group = fastify.db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
    if (!group) return reply.redirect('/');

    const membership = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ? AND role = ? AND status = ?'
    ).get(req.params.id, req.session.userId, 'admin', 'active');
    if (!membership) return reply.redirect('/');

    const code = crypto.randomBytes(4).toString('hex');
    const now = Date.now();
    fastify.db.prepare(
      'INSERT INTO invites (code, group_id, created_by, expires_at) VALUES (?, ?, ?, ?)'
    ).run(code, req.params.id, req.session.userId, now + 7 * 24 * 60 * 60 * 1000);

    return reply.redirect('/group/' + req.params.id);
  });

  fastify.get('/join/:code', async (req, reply) => {
    const invite = fastify.db.prepare(
      'SELECT i.*, g.name AS group_name FROM invites i JOIN groups g ON g.id = i.group_id WHERE i.code = ?'
    ).get(req.params.code);

    if (!invite || invite.expires_at < Date.now()) {
      return reply.view('join', { session: req.session, error: 'Invalid or expired invite link' });
    }

    const existing = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ?'
    ).get(invite.group_id, req.session.userId);
    if (existing) return reply.redirect('/');

    const cap = fastify.db.transaction(() => {
      const active = fastify.db.prepare(
        "SELECT COUNT(*) AS cnt FROM memberships WHERE group_id = ? AND status = 'active'"
      ).get(invite.group_id).cnt;

      if (active >= 15) {
        throw new Error('Group is full (max 15 active members)');
      }

      fastify.db.prepare(
        'INSERT INTO memberships (group_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(invite.group_id, req.session.userId, 'member', 'requested', Date.now());
    });

    try {
      cap();
    } catch (e) {
      return reply.view('join', { session: req.session, error: e.message });
    }

    return reply.view('join', { session: req.session, success: 'Join request sent! Waiting for admin approval.', group_id: invite.group_id });
  });

  fastify.post('/group/:id/approve/:userId', async (req, reply) => {
    const membership = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ? AND role = ? AND status = ?'
    ).get(req.params.id, req.session.userId, 'admin', 'active');
    if (!membership) return reply.redirect('/group/' + req.params.id);

    const reqMembership = fastify.db.prepare(
      "SELECT * FROM memberships WHERE group_id = ? AND user_id = ? AND status = 'requested'"
    ).get(req.params.id, req.params.userId);
    if (!reqMembership) return reply.redirect('/group/' + req.params.id);

    const cap = fastify.db.transaction(() => {
      const active = fastify.db.prepare(
        "SELECT COUNT(*) AS cnt FROM memberships WHERE group_id = ? AND status = 'active'"
      ).get(req.params.id).cnt;

      if (active >= 15) {
        throw new Error('Group is full (max 15 active members)');
      }

      fastify.db.prepare(
        "UPDATE memberships SET status = 'active' WHERE group_id = ? AND user_id = ?"
      ).run(req.params.id, req.params.userId);
    });

    try {
      cap();
    } catch (e) {
      return reply.redirect('/group/' + req.params.id + '?error=' + encodeURIComponent(e.message));
    }

    return reply.redirect('/group/' + req.params.id);
  });

  fastify.post('/group/:id/reject/:userId', async (req, reply) => {
    const membership = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ? AND role = ? AND status = ?'
    ).get(req.params.id, req.session.userId, 'admin', 'active');
    if (!membership) return reply.redirect('/group/' + req.params.id);

    fastify.db.prepare(
      'DELETE FROM memberships WHERE group_id = ? AND user_id = ?'
    ).run(req.params.id, req.params.userId);

    return reply.redirect('/group/' + req.params.id);
  });

  fastify.post('/invite/:groupId/accept', async (req, reply) => {
    const m = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ? AND status = ?'
    ).get(req.params.groupId, req.session.userId, 'invited');
    if (!m) return reply.redirect('/');

    const cap = fastify.db.transaction(() => {
      const active = fastify.db.prepare(
        "SELECT COUNT(*) AS cnt FROM memberships WHERE group_id = ? AND status = 'active'"
      ).get(req.params.groupId).cnt;

      if (active >= 15) {
        throw new Error('Group is full (max 15 active members)');
      }

      fastify.db.prepare(
        "UPDATE memberships SET status = 'active' WHERE group_id = ? AND user_id = ?"
      ).run(req.params.groupId, req.session.userId);
    });

    try {
      cap();
    } catch (e) {
      return reply.redirect('/?error=' + encodeURIComponent(e.message));
    }

    return reply.redirect('/group/' + req.params.groupId);
  });

  fastify.post('/invite/:groupId/decline', async (req, reply) => {
    fastify.db.prepare(
      'DELETE FROM memberships WHERE group_id = ? AND user_id = ? AND status = ?'
    ).run(req.params.groupId, req.session.userId, 'invited');

    return reply.redirect('/');
  });

  fastify.post('/group/:id/leave', async (req, reply) => {
    const m = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ?'
    ).get(req.params.id, req.session.userId);
    if (!m) return reply.redirect('/');

    if (m.role === 'admin' && m.status === 'active') {
      const otherAdmins = fastify.db.prepare(
        "SELECT COUNT(*) AS cnt FROM memberships WHERE group_id = ? AND role = 'admin' AND status = 'active' AND user_id != ?"
      ).get(req.params.id, req.session.userId).cnt;

      if (otherAdmins === 0) {
        return reply.view('group', { session: req.session, group: null, membership: m, members: [], error: 'Transfer admin before leaving.' });
      }
    }

    fastify.db.prepare('DELETE FROM memberships WHERE group_id = ? AND user_id = ?').run(req.params.id, req.session.userId);
    return reply.redirect('/');
  });

  fastify.post('/group/:id/settings', async (req, reply) => {
    const membership = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ? AND role = ? AND status = ?'
    ).get(req.params.id, req.session.userId, 'admin', 'active');
    if (!membership) return reply.redirect('/');

    const { weekly_quota } = req.body;
    const quota = parseInt(weekly_quota, 10) || 0;
    fastify.db.prepare('UPDATE groups SET weekly_quota = ? WHERE id = ?').run(quota, req.params.id);
    return reply.redirect('/group/' + req.params.id);
  });

  fastify.post('/group/:id/remove/:userId', async (req, reply) => {
    const membership = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ? AND role = ? AND status = ?'
    ).get(req.params.id, req.session.userId, 'admin', 'active');
    if (!membership) return reply.redirect('/');

    const target = fastify.db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ?'
    ).get(req.params.id, req.params.userId);
    if (!target) return reply.redirect('/');

    if (target.role === 'admin') return reply.redirect('/group/' + req.params.id);

    fastify.db.prepare('DELETE FROM memberships WHERE group_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
    return reply.redirect('/group/' + req.params.id);
  });
};