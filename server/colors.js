const GROUP_COLORS = [
  'hsl(0, 65%, 55%)',     // Red
  'hsl(25, 75%, 50%)',    // Orange
  'hsl(45, 85%, 55%)',    // Gold
  'hsl(95, 55%, 42%)',    // Green
  'hsl(160, 55%, 42%)',   // Teal
  'hsl(195, 65%, 50%)',   // Cyan
  'hsl(220, 60%, 55%)',   // Blue
  'hsl(260, 55%, 58%)',   // Violet
  'hsl(300, 50%, 55%)',   // Purple
  'hsl(330, 65%, 52%)',   // Pink
  'hsl(15, 70%, 50%)',    // Vermillion
  'hsl(40, 85%, 50%)',    // Amber
  'hsl(180, 50%, 40%)',   // Dark teal
  'hsl(120, 40%, 45%)',   // Olive
  'hsl(280, 40%, 55%)',   // Lavender
];

function assignColorIndex(db, groupId) {
  const used = db.prepare(
    "SELECT color_index FROM memberships WHERE group_id = ? AND status = 'active' AND color_index IS NOT NULL"
  ).all(groupId).map(r => r.color_index);
  for (let i = 0; i < 15; i++) {
    if (!used.includes(i)) return i;
  }
  return 0;
}

module.exports = { GROUP_COLORS, assignColorIndex };