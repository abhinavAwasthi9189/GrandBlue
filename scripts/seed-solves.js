const db = require('../server/db');
const { getWeekStartIST, WEEK_MS } = require('../server/studyState');

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const PROBLEMS = [
  ['two-sum', 'Easy'],
  ['reverse-integer', 'Medium'],
  ['palindrome-number', 'Easy'],
  ['roman-to-integer', 'Easy'],
  ['longest-common-prefix', 'Easy'],
  ['valid-parentheses', 'Easy'],
  ['merge-two-sorted-lists', 'Easy'],
  ['remove-duplicates-from-sorted-array', 'Easy'],
  ['remove-element', 'Easy'],
  ['find-the-index-of-the-first-occurrence-in-a-string', 'Easy'],
  ['search-insert-position', 'Easy'],
  ['length-of-last-word', 'Easy'],
  ['plus-one', 'Easy'],
  ['add-binary', 'Easy'],
  ['sqrtx', 'Easy'],
  ['climbing-stairs', 'Easy'],
  ['remove-duplicates-from-sorted-list', 'Easy'],
  ['merge-sorted-array', 'Easy'],
  ['same-tree', 'Easy'],
  ['symmetric-tree', 'Easy'],
  ['maximum-depth-of-binary-tree', 'Easy'],
  ['convert-sorted-array-to-binary-search-tree', 'Easy'],
  ['balanced-binary-tree', 'Easy'],
  ['minimum-depth-of-binary-tree', 'Easy'],
  ['path-sum', 'Easy'],
  ['pascals-triangle', 'Easy'],
  ['valid-palindrome', 'Easy'],
  ['single-number', 'Easy'],
  ['linked-list-cycle', 'Easy'],
  ['intersection-of-two-linked-lists', 'Easy'],
  ['majority-element', 'Easy'],
  ['excel-sheet-column-number', 'Easy'],
  ['reverse-linked-list', 'Easy'],
  ['contains-duplicate', 'Easy'],
  ['contains-duplicate-ii', 'Easy'],
  ['invert-binary-tree', 'Easy'],
  ['summary-ranges', 'Easy'],
  ['happy-number', 'Easy'],
  ['count-primes', 'Easy'],
  ['isomorphic-strings', 'Easy'],
  ['remove-linked-list-elements', 'Easy'],
  ['add-digits', 'Easy'],
  ['missing-number', 'Easy'],
  ['ugly-number', 'Easy'],
  ['move-zeroes', 'Easy'],
  ['word-pattern', 'Easy'],
  ['nim-game', 'Easy'],
  ['third-maximum-number', 'Easy'],
  ['add-strings', 'Easy'],
  ['number-of-segments-in-a-string', 'Easy'],
  ['longest-substring-without-repeating-characters', 'Medium'],
  ['longest-palindromic-substring', 'Medium'],
  ['zigzag-conversion', 'Medium'],
  ['string-to-integer-atoi', 'Medium'],
  ['container-with-most-water', 'Medium'],
  ['integer-to-roman', 'Medium'],
  ['3sum', 'Medium'],
  ['letter-combinations-of-a-phone-number', 'Medium'],
  ['remove-nth-node-from-end-of-list', 'Medium'],
  ['generate-parentheses', 'Medium'],
  ['swap-nodes-in-pairs', 'Medium'],
  ['divide-two-integers', 'Medium'],
  ['next-permutation', 'Medium'],
  ['search-in-rotated-sorted-array', 'Medium'],
  ['find-first-and-last-position-of-element-in-sorted-array', 'Medium'],
  ['combination-sum', 'Medium'],
  ['rotate-image', 'Medium'],
  ['group-anagrams', 'Medium'],
  ['unique-paths', 'Medium'],
  ['set-matrix-zeroes', 'Medium'],
  ['search-a-2d-matrix', 'Medium'],
  ['sort-colors', 'Medium'],
  ['subsets', 'Medium'],
  ['word-search', 'Medium'],
  ['subsets-ii', 'Medium'],
  ['decode-ways', 'Medium'],
  ['reverse-linked-list-ii', 'Medium'],
  ['restore-ip-addresses', 'Medium'],
  ['binary-tree-inorder-traversal', 'Medium'],
  ['validate-binary-search-tree', 'Medium'],
  ['binary-tree-level-order-traversal', 'Medium'],
  ['maximum-depth-of-binary-tree', 'Easy'],
  ['construct-binary-tree-from-preorder-and-inorder-traversal', 'Medium'],
  ['populating-next-right-pointers-in-each-node', 'Medium'],
  ['flatten-binary-tree-to-linked-list', 'Medium'],
  ['gas-station', 'Medium'],
  ['triangle', 'Medium'],
  ['best-time-to-buy-and-sell-stock-ii', 'Medium'],
  ['best-time-to-buy-and-sell-stock-iii', 'Hard'],
  ['binary-tree-maximum-path-sum', 'Hard'],
  ['valid-number', 'Hard'],
  ['word-ladder-ii', 'Hard'],
  ['median-of-two-sorted-arrays', 'Hard'],
  ['merge-k-sorted-lists', 'Hard'],
  ['reverse-nodes-in-k-group', 'Hard'],
  ['trapping-rain-water', 'Hard'],
  ['n-queens', 'Hard'],
  ['wildcard-matching', 'Hard'],
  ['scramble-string', 'Hard'],
  ['minimum-window-substring', 'Hard'],
  ['largest-rectangle-in-histogram', 'Hard'],
  ['maximal-rectangle', 'Hard'],
  ['word-ladder', 'Hard'],
  ['longest-consecutive-sequence', 'Medium'],
  ['candy', 'Hard'],
];

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
const insertSolve = db.prepare(
  'INSERT OR IGNORE INTO solved_problems (user_id, slug, difficulty, solved_at_ms) VALUES (?, ?, ?, ?)'
);

const existingSolves = db.prepare(
  'SELECT slug FROM solved_problems WHERE user_id = ? AND solved_at_ms >= ? AND solved_at_ms < ?'
);

const insertIfNew = db.transaction((userId, slug, difficulty, solvedAt) => {
  const row = db.prepare(
    'SELECT 1 FROM solved_problems WHERE user_id = ? AND slug = ? AND solved_at_ms >= ? AND solved_at_ms < ?'
  ).get(userId, slug, currentWeekStart, currentWeekStart + WEEK_MS);
  if (row) return false;
  insertSolve.run(userId, slug, difficulty, solvedAt);
  return true;
});

let created = 0;

for (const member of members) {
  const numSolves = 3 + Math.floor(Math.random() * 8);
  const used = new Set();
  for (let i = 0; i < numSolves; i++) {
    const idx = Math.floor(Math.random() * PROBLEMS.length);
    const slug = PROBLEMS[idx][0];
    if (used.has(slug)) continue;
    used.add(slug);
    const difficulty = PROBLEMS[idx][1];
    const solvedAt = currentWeekStart + Math.floor(Math.random() * WEEK_MS);
    if (insertIfNew(member.id, slug, difficulty, solvedAt)) created++;
  }
}

console.log(`Seeded ${created} fake solves across ${members.length} member(s) for the current week.`);
console.log('Visit /group/:id/leetwars to see the leaderboard.');
db.close();