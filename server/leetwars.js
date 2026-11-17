const { getWeekStartIST, WEEK_MS, isActiveMember } = require('./studyState');

const LEETCODE_API = 'https://leetcode.com/graphql';
const POLL_INTERVAL_MS = 20 * 60 * 1000;
const BATCH_DELAY_MS = 1500;
const XP_MAP = { Easy: 10, Medium: 25, Hard: 50 };

const difficultyCache = new Map();

async function fetchDifficulty(slug) {
  if (difficultyCache.has(slug)) return difficultyCache.get(slug);
  const q = { query: `{ question(titleSlug: "${slug}") { difficulty } }` };
  try {
    const r = await fetch(LEETCODE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(q),
    });
    const d = await r.json();
    const diff = d?.data?.question?.difficulty || null;
    if (diff) difficultyCache.set(slug, diff);
    return diff;
  } catch { return null; }
}

async function fetchRecentSubmissions(leetcodeUsername) {
  const q = {
    query: `query recentAcSubmissions($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        id titleSlug title timestamp
      }
    }`,
    variables: { username: leetcodeUsername, limit: 20 },
  };
  const r = await fetch(LEETCODE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(q),
  });
  const d = await r.json();
  return d?.data?.recentAcSubmissionList || [];
}

async function checkUserExists(leetcodeUsername) {
  const q = {
    query: `query matchedUser($username: String!) { matchedUser(username: $username) { username } }`,
    variables: { username: leetcodeUsername },
  };
  const r = await fetch(LEETCODE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(q),
  });
  const d = await r.json();
  return !!d?.data?.matchedUser;
}

async function pollUser(db, userId, leetcodeUsername, log) {
  let subs;
  try {
    subs = await fetchRecentSubmissions(leetcodeUsername);
  } catch (err) {
    log.warn('leetwars fetch failed for user %d (%s): %s', userId, leetcodeUsername, err.message || err);
    return;
  }
  if (!subs || subs.length === 0) return;

  const weekStart = getWeekStartIST(Date.now());
  const weekEnd = weekStart + WEEK_MS;

  const existing = new Set(
    db.prepare(
      'SELECT slug FROM solved_problems WHERE user_id = ? AND solved_at_ms >= ? AND solved_at_ms < ?'
    ).all(userId, weekStart, weekEnd).map(r => r.slug)
  );

  for (const sub of subs) {
    const slug = sub.titleSlug;
    const solvedAt = parseInt(sub.timestamp, 10) * 1000;
    if (!slug || existing.has(slug)) continue;
    if (solvedAt < weekStart) continue;

    let difficulty = await fetchDifficulty(slug);
    if (!difficulty) continue;
    if (!XP_MAP[difficulty]) continue;

    db.prepare(
      'INSERT OR IGNORE INTO solved_problems (user_id, slug, difficulty, solved_at_ms) VALUES (?, ?, ?, ?)'
    ).run(userId, slug, difficulty, solvedAt);
    existing.add(slug);
  }
}

function startPoller(fastify) {
  const db = fastify.db;
  const log = fastify.log;

  async function tick() {
    const users = db.prepare(
      'SELECT id, leetcode_username FROM users WHERE leetcode_username IS NOT NULL AND leetcode_username != ?'
    ).all('');
    for (let i = 0; i < users.length; i++) {
      await pollUser(db, users[i].id, users[i].leetcode_username, log);
      if (i < users.length - 1) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), POLL_INTERVAL_MS);
}

function getDailyLeetwars(db, groupId, weekStart) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const members = db.prepare(`
    SELECT u.id, u.username, u.leetcode_username, u.avatar
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.status = 'active'
    ORDER BY u.username
  `).all(groupId);

  const days = [];
  for (let d = 0; d < 7; d++) {
    const dayStart = weekStart + d * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const label = new Date(dayStart + 5.5 * 60 * 60 * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });

    const dayData = members.map(m => {
      const solves = db.prepare(`
        SELECT difficulty FROM solved_problems
        WHERE user_id = ? AND solved_at_ms >= ? AND solved_at_ms < ?
      `).all(m.id, dayStart, dayEnd);
      const xp = solves.reduce((sum, s) => sum + (XP_MAP[s.difficulty] || 0), 0);
      return { userId: m.id, username: m.username, xp, solves: solves.length };
    });
    days.push({ label, data: dayData });
  }
  return { days, members: members.map(m => ({ userId: m.id, username: m.username, leetcode_username: m.leetcode_username, hasAvatar: !!m.avatar })) };
}

function getLeaderboard(db, groupId, weekStart, weekEnd) {
  return db.prepare(`
    SELECT u.id, u.username, u.leetcode_username, u.avatar,
      COALESCE(SUM(CASE sp.difficulty WHEN 'Easy' THEN 10 WHEN 'Medium' THEN 25 WHEN 'Hard' THEN 50 END), 0) AS xp,
      COUNT(sp.slug) AS solved_count
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN solved_problems sp ON sp.user_id = u.id
      AND sp.solved_at_ms >= ? AND sp.solved_at_ms < ?
    WHERE m.group_id = ? AND m.status = 'active'
    GROUP BY u.id
    ORDER BY xp DESC, u.username
  `).all(weekStart, weekEnd, groupId);
}

function getMemberSolves(db, userId, weekStart, weekEnd) {
  return db.prepare(`
    SELECT slug, difficulty, solved_at_ms
    FROM solved_problems
    WHERE user_id = ? AND solved_at_ms >= ? AND solved_at_ms < ?
    ORDER BY solved_at_ms
  `).all(userId, weekStart, weekEnd);
}

module.exports = async function (fastify, opts) {
  const db = fastify.db;

  fastify.post('/profile/leetcode', async (req, reply) => {
    if (!req.session.userId) return reply.code(401).send({ ok: false });
    const { leetcode_username } = req.body;

    if (leetcode_username) {
      let exists;
      try {
        exists = await checkUserExists(leetcode_username);
      } catch (err) {
        fastify.log.warn('leetwars username check failed: %s', err.message || err);
        return reply.send({ ok: false, error: 'Could not reach LeetCode. Try again.' });
      }
      if (!exists) {
        return reply.send({ ok: false, error: 'LeetCode user not found' });
      }
    }

    db.prepare('UPDATE users SET leetcode_username = ? WHERE id = ?')
      .run(leetcode_username || null, req.session.userId);

    if (leetcode_username) {
      pollUser(db, req.session.userId, leetcode_username, fastify.log).catch(() => {});
    }

    return reply.send({ ok: true });
  });

  fastify.get('/leetwars', async (req, reply) => {
    if (!req.session.userId) return reply.redirect('/login');
    const user = db.prepare('SELECT leetcode_username FROM users WHERE id = ?').get(req.session.userId);
    const pendingInviteCount = db.prepare(
      "SELECT COUNT(*) AS cnt FROM memberships WHERE user_id = ? AND status = 'invited'"
    ).get(req.session.userId).cnt;
    return reply.view('leetwars', {
      session: req.session,
      group: null,
      membership: null,
      leaderboard: [],
      solvesMap: {},
      behind: [],
      quota: 0,
      pendingInviteCount,
      hasLeetcode: !!user.leetcode_username,
      leetcodeUsername: user.leetcode_username || '',
    });
  });

  fastify.get('/group/:id/leetwars', async (req, reply) => {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
    if (!group) return reply.callNotFound();
    const membership = db.prepare(
      'SELECT * FROM memberships WHERE group_id = ? AND user_id = ?'
    ).get(req.params.id, req.session.userId);
    if (!membership || membership.status !== 'active') return reply.redirect('/group/' + req.params.id);

    const weekStart = getWeekStartIST(Date.now());
    const weekEnd = weekStart + WEEK_MS;

    const leaderboard = getLeaderboard(db, req.params.id, weekStart, weekEnd);
    const solvesMap = {};
    for (const entry of leaderboard) {
      solvesMap[entry.id] = getMemberSolves(db, entry.id, weekStart, weekEnd);
    }

    const quota = group.weekly_quota || 0;
    const behind = [];
    for (const e of leaderboard) {
      if (e.leetcode_username && e.solved_count < quota) {
        behind.push({ id: e.id, username: e.username, avatar: e.avatar, solved: e.solved_count, owed: quota - e.solved_count, notLinked: false });
      } else if (!e.leetcode_username) {
        behind.push({ id: e.id, username: e.username, avatar: e.avatar, solved: 0, owed: quota, notLinked: true });
      }
    }

    const user = db.prepare('SELECT leetcode_username FROM users WHERE id = ?').get(req.session.userId);
    const hasLeetcode = !!user.leetcode_username;
    const leetcodeUsername = user.leetcode_username || '';
    const pendingInviteCount = db.prepare(
      "SELECT COUNT(*) AS cnt FROM memberships WHERE user_id = ? AND status = 'invited'"
    ).get(req.session.userId).cnt;

    return reply.view('leetwars', {
      session: req.session,
      group,
      membership,
      pendingInviteCount,
      leaderboard,
      solvesMap,
      behind,
      quota,
      hasLeetcode,
      leetcodeUsername,
    });
  });

  fastify.get('/api/group/:id/leetwars/daily', async (req, reply) => {
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

    const result = getDailyLeetwars(db, groupId, weekStart);
    return reply.send({ ok: true, weekStart, days: result.days, members: result.members });
  });

  if (!fastify.leetwarsStarted) {
    fastify.leetwarsStarted = true;
    startPoller(fastify);
  }
};