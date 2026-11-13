const studyState = require('./studyState');

const WEEKS_PER_PAGE = 10;

module.exports = async function (fastify, opts) {
  fastify.get('/group/:id/history', async (req, reply) => {
    const group = fastify.db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
    if (!group) return reply.callNotFound();

    const membership = fastify.db.prepare(
      "SELECT * FROM memberships WHERE group_id = ? AND user_id = ? AND status = 'active'"
    ).get(req.params.id, req.session.userId);
    if (!membership) return reply.redirect('/group/' + req.params.id);

    const page = Math.max(0, parseInt(req.query.page, 10) || 0);
    const weekStart = studyState.getWeekStartIST();
    const baseStart = weekStart - studyState.WEEK_MS - page * WEEKS_PER_PAGE * studyState.WEEK_MS;

    const weeks = [];
    for (let i = 0; i < WEEKS_PER_PAGE; i++) {
      const start = baseStart - i * studyState.WEEK_MS;
      weeks.push({
        label: formatWeekLabel(start),
        totals: studyState.weekTotalsForGroup(
          fastify.db, req.params.id,
          start, start + studyState.WEEK_MS
        ),
      });
    }

    const members = weeks[0].totals.map(t => t.username);
    const pendingInviteCount = fastify.db.prepare(
      "SELECT COUNT(*) AS cnt FROM memberships WHERE user_id = ? AND status = 'invited'"
    ).get(req.session.userId).cnt;

    return reply.view('history', {
      session: req.session,
      group,
      membership,
      weeks,
      members,
      page,
      pendingInviteCount,
      hasNewer: page > 0,
    });
  });
};

function formatWeekLabel(weekStart) {
  const fmt = (ms) => new Date(ms).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
  });
  return fmt(weekStart) + ' – ' + fmt(weekStart + studyState.WEEK_MS - 1);
}