const { getWeekStartIST, WEEK_MS, weekTotalForUser } = require('./studyState');

const DAY_MS = 24 * 60 * 60 * 1000;

function getTodayTotal(db, userId) {
  const istNow = Date.now() + 5.5 * 60 * 60 * 1000;
  const startOfDayIST = new Date(istNow);
  startOfDayIST.setUTCHours(0, 0, 0, 0);
  const startMs = startOfDayIST.getTime() - 5.5 * 60 * 60 * 1000;
  return weekTotalForUser(db, userId, startMs);
}

function getStreak(db, userId) {
  const todayStart = (() => {
    const istNow = Date.now() + 5.5 * 60 * 60 * 1000;
    const d = new Date(istNow);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() - 5.5 * 60 * 60 * 1000;
  })();
  let streak = 0;
  for (let i = 0; ; i++) {
    const dayStart = todayStart - i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const dayTotal = db.prepare(`
      SELECT COALESCE(SUM(MIN(COALESCE(end_ms, ?), dayEnd) - MAX(start_ms, dayStart)), 0) AS total
      FROM sessions WHERE user_id = ? AND start_ms < dayEnd AND (end_ms IS NULL OR end_ms > dayStart)
    `).get(dayEnd, userId, dayEnd, dayStart).total;
    if (dayTotal > 0) { streak++; }
    else if (i > 0) break;
    else { streak = 0; break; }
    if (i > 365) break;
  }
  return streak;
}

function getBestWeek(db, userId) {
  const now = Date.now();
  const best = db.prepare(`
    WITH weeks AS (
      SELECT
        ((start_ms + ?) / ?) AS week_num,
        COALESCE(SUM(MIN(COALESCE(end_ms, ?), (week_num + 1) * ? - ?) - MAX(start_ms, week_num * ? - ?)), 0) AS total_ms
      FROM sessions WHERE user_id = ? AND end_ms IS NOT NULL
      GROUP BY week_num
    )
    SELECT MAX(total_ms) AS best FROM weeks
  `).get(5.5 * 60 * 60 * 1000, WEEK_MS, now, WEEK_MS, 5.5 * 60 * 60 * 1000, WEEK_MS, 5.5 * 60 * 60 * 1000, userId);
  return best.best || 0;
}

function getLast8Weeks(db, userId) {
  const weekStart = getWeekStartIST();
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const ws = weekStart - i * WEEK_MS;
    const we = ws + WEEK_MS;
    const total = db.prepare(`
      SELECT COALESCE(SUM(MIN(COALESCE(end_ms, ?), ?) - MAX(start_ms, ?)), 0) AS total
      FROM sessions WHERE user_id = ? AND start_ms < ? AND (end_ms IS NULL OR end_ms > ?)
    `).get(we, we, ws, userId, we, ws).total;
    weeks.push({ weekStart: ws, totalMs: total });
  }
  return weeks;
}

function getLast7Days(db, userId) {
  const todayStart = (() => {
    const istNow = Date.now() + 5.5 * 60 * 60 * 1000;
    const d = new Date(istNow);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() - 5.5 * 60 * 60 * 1000;
  })();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const ds = todayStart - i * DAY_MS;
    const de = ds + DAY_MS;
    const total = db.prepare(`
      SELECT COALESCE(SUM(MIN(COALESCE(end_ms, ?), ?) - MAX(start_ms, ?)), 0) AS total
      FROM sessions WHERE user_id = ? AND start_ms < ? AND (end_ms IS NULL OR end_ms > ?)
    `).get(de, de, ds, userId, de, ds).total;
    const label = new Date(ds + 5.5 * 60 * 60 * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
    days.push({ label, totalMs: total });
  }
  return days;
}

module.exports = async function (fastify, opts) {
  const db = fastify.db;

  fastify.get('/api/me/stats', async (req, reply) => {
    if (!req.session.userId) return reply.code(401).send({ ok: false });
    const userId = req.session.userId;
    const user = db.prepare('SELECT id, username, leetcode_username FROM users WHERE id = ?').get(userId);
    if (!user) return reply.code(404).send({ ok: false });

    const weekStart = getWeekStartIST();
    const thisWeek = weekTotalForUser(db, userId, weekStart);
    const today = getTodayTotal(db, userId);
    const streak = getStreak(db, userId);
    const bestWeek = getBestWeek(db, userId);
    const last8Weeks = getLast8Weeks(db, userId);
    const last7Days = getLast7Days(db, userId);

    // LeetCode stats
    let leetcode = null;
    if (user.leetcode_username) {
      const solved = db.prepare(`
        SELECT difficulty, COUNT(*) AS cnt FROM solved_problems
        WHERE user_id = ? AND solved_at_ms >= ? AND solved_at_ms < ?
        GROUP BY difficulty
      `).all(userId, weekStart, weekStart + WEEK_MS);
      const byDifficulty = { Easy: 0, Medium: 0, Hard: 0 };
      let xpThisWeek = 0;
      for (const s of solved) {
        byDifficulty[s.difficulty] = s.cnt;
        const xpMap = { Easy: 10, Medium: 25, Hard: 50 };
        xpThisWeek += s.cnt * (xpMap[s.difficulty] || 0);
      }
      const last5Solves = db.prepare(`
        SELECT slug, difficulty, solved_at_ms FROM solved_problems
        WHERE user_id = ? ORDER BY solved_at_ms DESC LIMIT 5
      `).all(userId).map(s => ({ slug: s.slug, difficulty: s.difficulty, solvedAt: s.solved_at_ms }));

      // LeetCode weekly 7-day chart
      const weekSolves7 = [];
      const todayStart = (() => {
        const istNow = Date.now() + 5.5 * 60 * 60 * 1000;
        const d = new Date(istNow);
        d.setUTCHours(0, 0, 0, 0);
        return d.getTime() - 5.5 * 60 * 60 * 1000;
      })();
      for (let i = 6; i >= 0; i--) {
        const ds = todayStart - i * 86400000;
        const de = ds + 86400000;
        const count = db.prepare(
          'SELECT COUNT(*) AS cnt FROM solved_problems WHERE user_id = ? AND solved_at_ms >= ? AND solved_at_ms < ?'
        ).get(userId, ds, de).cnt;
        const label = new Date(ds + 5.5 * 60 * 60 * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
        weekSolves7.push({ label, count });
      }

      leetcode = {
        username: user.leetcode_username,
        byDifficulty,
        xpThisWeek,
        last5Solves,
        weekSolves7,
      };
    }

    const membershipCount = db.prepare(
      "SELECT COUNT(*) AS cnt FROM memberships WHERE user_id = ? AND status = 'active'"
    ).get(userId).cnt;

    return reply.send({
      ok: true,
      username: user.username,
      membershipCount,
      today: { totalMs: today },
      thisWeek: { totalMs: thisWeek },
      streak,
      bestWeekMs: bestWeek,
      last8Weeks,
      last7Days,
      leetcode,
    });
  });
};
