const IST_OFFSET = 5.5 * 60 * 60 * 1000;

function getWeekStartIST(nowMs = Date.now()) {
  const ist = new Date(nowMs + IST_OFFSET);
  const daysSinceMonday = (ist.getUTCDay() + 6) % 7;
  ist.setUTCDate(ist.getUTCDate() - daysSinceMonday);
  ist.setUTCHours(0, 0, 0, 0);
  return ist.getTime() - IST_OFFSET;
}

function getMemberState(db, userId) {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  const active = db.prepare(
    "SELECT start_ms FROM sessions WHERE user_id = ? AND end_ms IS NULL ORDER BY start_ms DESC LIMIT 1"
  ).get(userId);
  const last = db.prepare(
    "SELECT end_ms FROM sessions WHERE user_id = ? AND end_ms IS NOT NULL ORDER BY end_ms DESC LIMIT 1"
  ).get(userId);
  const now = Date.now();
  const weekTotalMs = db.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN end_ms IS NOT NULL THEN end_ms - start_ms ELSE ? - start_ms END
    ), 0) AS total
    FROM sessions WHERE user_id = ? AND start_ms >= ?
  `).get(now, userId, getWeekStartIST(now)).total;

  return {
    userId: user.id,
    username: user.username,
    studying: !!active,
    startMs: active ? active.start_ms : null,
    lastEndMs: last ? last.end_ms : null,
    weekTotalMs,
  };
}

function isActiveMember(db, groupId, userId) {
  return !!db.prepare(
    "SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ? AND status = 'active'"
  ).get(groupId, userId);
}

function getActiveMembers(db, groupId) {
  return db.prepare(`
    SELECT u.id, m.role
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.status = 'active' ORDER BY m.created_at
  `).all(groupId);
}

module.exports = { getWeekStartIST, getMemberState, isActiveMember, getActiveMembers };