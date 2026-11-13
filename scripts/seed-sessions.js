const db = require('../server/db');
const { getWeekStartIST, WEEK_MS } = require('../server/studyState');

const WEEKS_BACK = 8;
const insertSession = db.prepare(`
  INSERT INTO sessions (user_id, start_ms, end_ms, last_heartbeat_ms)
  VALUES (?, ?, ?, ?)
`);

const members = db.prepare(`
  SELECT u.id, u.username
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.status = 'active'
  ORDER BY m.group_id, u.username
`).all();

if (members.length === 0) {
  console.log('No active members found. Register users and join a group first.');
  process.exit(0);
}

const now = Date.now();
const currentWeekStart = getWeekStartIST(now);

let created = 0;

for (const member of members) {
  for (let w = 1; w <= WEEKS_BACK; w++) {
    const weekStart = currentWeekStart - w * WEEK_MS;
    // 1-4 sessions per person per week
    const sessions = 1 + Math.floor(Math.random() * 4);
    for (let s = 0; s < sessions; s++) {
      const startMs = weekStart + Math.floor(Math.random() * (WEEK_MS - 2 * 60 * 60 * 1000));
      let endMs = startMs + (30 * 60 * 1000) + Math.floor(Math.random() * (90 * 60 * 1000));
      // ~20% of sessions cross the Monday boundary into the next week
      const weekEnd = weekStart + WEEK_MS;
      if (endMs > weekEnd && Math.random() < 0.2) {
        endMs = weekEnd + Math.floor(Math.random() * (60 * 60 * 1000));
      } else {
        endMs = Math.min(endMs, weekEnd);
      }
      insertSession.run(member.id, startMs, endMs, endMs);
      created++;
    }
  }
}

console.log(`Seeded ${created} fake sessions across ${members.length} member(s).`);
console.log(`(past ${WEEKS_BACK} weeks, ~20% cross the Monday boundary)`);
db.close();