const IST_OFFSET = 5.5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const { GROUP_COLORS } = require('./colors');

function getWeekStartIST(nowMs = Date.now()) {
  const ist = new Date(nowMs + IST_OFFSET);
  const daysSinceMonday = (ist.getUTCDay() + 6) % 7;
  ist.setUTCDate(ist.getUTCDate() - daysSinceMonday);
  ist.setUTCHours(0, 0, 0, 0);
  return ist.getTime() - IST_OFFSET;
}

function weekTotalForUser(db, userId, weekStart) {
  const weekEnd = weekStart + WEEK_MS;
  const now = Date.now();
  return db.prepare(`
    SELECT COALESCE(SUM(
      MIN(COALESCE(end_ms, ?), ?) - MAX(start_ms, ?)
    ), 0) AS total
    FROM sessions
    WHERE user_id = ?
      AND start_ms < ?
      AND (end_ms IS NULL OR end_ms > ?)
  `).get(now, weekEnd, weekStart, userId, weekEnd, weekStart).total;
}

function getMemberState(db, userId) {
  const user = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(userId);
  const active = db.prepare(
    "SELECT start_ms, last_heartbeat_ms FROM sessions WHERE user_id = ? AND end_ms IS NULL ORDER BY start_ms DESC LIMIT 1"
  ).get(userId);
  const last = db.prepare(
    "SELECT end_ms FROM sessions WHERE user_id = ? AND end_ms IS NOT NULL ORDER BY end_ms DESC LIMIT 1"
  ).get(userId);
  const nowMs = Date.now();
  return {
    userId: user.id,
    username: user.username,
    hasAvatar: !!user.avatar,
    studying: !!active,
    startMs: active ? active.start_ms : null,
    lastHeartbeatMs: active ? active.last_heartbeat_ms : null,
    lastEndMs: last ? last.end_ms : null,
    weekTotalMs: weekTotalForUser(db, userId, getWeekStartIST(nowMs)),
  };
}

function isActiveMember(db, groupId, userId) {
  return !!db.prepare(
    "SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ? AND status = 'active'"
  ).get(groupId, userId);
}

function getActiveMembers(db, groupId) {
  return db.prepare(`
    SELECT u.id, m.role, m.color_index
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.status = 'active' ORDER BY m.created_at
  `).all(groupId).map(r => ({
    id: r.id,
    role: r.role,
    color: GROUP_COLORS[r.color_index] || GROUP_COLORS[0],
  }));
}

function weekTotalsForGroup(db, groupId, weekStart, weekEnd) {
  const now = Date.now();
  return db.prepare(`
    SELECT u.id, u.username,
      COALESCE(SUM(
        MIN(COALESCE(s.end_ms, ?), ?) - MAX(s.start_ms, ?)
      ), 0) AS total_ms
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN sessions s ON s.user_id = u.id
      AND s.start_ms < ?
      AND (s.end_ms IS NULL OR s.end_ms > ?)
    WHERE m.group_id = ? AND m.status = 'active'
    GROUP BY u.id
    ORDER BY u.username
  `).all(now, weekEnd, weekStart, weekEnd, weekStart, groupId);
}

module.exports = { getWeekStartIST, WEEK_MS, weekTotalForUser, getMemberState, isActiveMember, getActiveMembers, weekTotalsForGroup };