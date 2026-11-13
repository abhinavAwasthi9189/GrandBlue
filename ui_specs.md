# abs UI spec (mobile first, then desktop)

Read together with specs.md. This file describes screens and layout only. Backend rules in specs.md still apply.

## Principles
- YouTube-like: bottom tab bar, cards, lots of whitespace, one main action per screen.
- Server-rendered EJS pages. Same HTML structure on mobile and desktop; the desktop layout is CSS only, using media queries at min-width 900px.
- Dark theme by default, light theme through prefers-color-scheme. All colours, spacing, radii and font sizes are CSS variables in one file (`public/css/tokens.css`).
- Touch targets at least 44px. Inputs use font-size 16px or more (stops iOS zoom). Respect iPhone safe areas with env(safe-area-inset-*). No horizontal page scroll.
- Each person gets a fixed colour (from their user id), used on every graph and avatar. Avatars are coloured circles with initials. No photo uploads.
- Time format: "2h 05m" for totals, live HH:MM:SS for running timers. Weeks and days are Monday to Sunday in IST.
- Charts: Chart.js, downloaded once into `public/vendor/` and served from our own server (no CDN). Ask before adding it.
- Every list has an empty state, a loading state, and an error state with a retry.

## Navigation
- Bottom tab bar with two tabs: **Groups** (left) and **You** (right). Visible on all top-level screens and inside a group (Groups stays highlighted).
- Pending invites show as a small badge on the Groups tab.
- **Mini timer bar** sits just above the tab bar while the user is studying: running time, Pause, Stop. Tapping it opens the group they started in. A study session belongs to the user, so one timer counts for every group.
- Group pages use top tabs (Members, Study, Leetwars) with real URLs, so the back button works.

## Screens

### 1. Login / Register
Centered card, app name "abs", username, password, signup code (register only), clear error messages. A link switches between login and register.

### 2. Groups tab (home)
- Top bar: "Groups". Right side: "Join with code" icon.
- Pending invites at the top as cards: group name, who invited, Accept / Decline.
- Pending requests the user has sent show as a muted "Requested" row.
- One card per group: name, members (e.g. 7/15), "3 studying now", my time this week, and a small rank badge.
- Floating "+" button at the bottom right, above the tab bar. It opens a bottom sheet: group name, weekly quota (problems), Create.
- "Join with code" opens a bottom sheet with a code field.
- Empty state: "No groups yet. Create one or join with a code."

### 3. You tab
- Header: initials avatar, username, "Member of N groups".
- Study section: today, this week, current streak (days with any study), best week. Bar chart of the last 8 weeks. Line or bar chart of the last 7 days.
- LeetCode section:
  - Not linked: short explanation and the "Enter your LeetCode username" form.
  - Linked: username with Change / Unlink, solved counts by difficulty (Easy / Medium / Hard), XP this week, a 7-day solves chart, and the last 5 solved problems.
- Settings list: notifications on/off (with status), install to Home Screen, change password, log out.

### 4. Group page
- Top bar: back arrow, group name, settings icon (admin) or menu (member: Leave group).
- Top tabs: **Members**, **Study**, **Leetwars**.
- A "Start studying" button appears inside the group header when the user isn't studying, and becomes the running timer with Pause / Stop when they are.

**Members tab**
- Live list of members: initials avatar, name, "Admin" badge, status dot (green = studying now with a running timer, otherwise "last studied 2h ago"), time this week, and a nudge button on people who are not studying.
- Admin only: "Join requests" section with Approve / Reject; "Invite by username" field; "Invite link / code" with copy button; a menu on each member to remove them.
- Footer: Leave group.

**Study tab**
- Week picker (previous / next week, default this week).
- Leaderboard by study time: rank, name, time, a thin bar showing the share of the leader's time.
- Comparison line graph: one line per member, Monday to Sunday, daily study time. Your own line is thicker. Tapping a name in the legend shows or hides that line.
- History: list of past weeks with each person's total, newest first (existing history data).

**Leetwars tab**
- Quota card: "You: 3 of 5 problems this week" with a progress bar.
- Leaderboard by XP: rank, name, XP, problems solved.
- "Behind on quota" list: name, how many they still owe, nudge button, and "not linked" for people without a LeetCode account.
- Comparison line graph: one line per member, daily XP gained (or cumulative XP) Monday to Sunday, with the same legend toggles.
- Recent solves feed: who solved what, difficulty chip, XP, time ago.

**Group settings (admin)**
Group name, weekly quota, invite code (regenerate), members list, delete group (with confirmation).

### 5. Extra screens the app needs
- Install prompt (Android button, iPhone steps) and notification permission prompt, shown once and from the You tab afterward.
- Confirmation dialogs for leave, remove member, delete group, unlink LeetCode.
- A friendly "reconnecting" strip when the live connection drops.
- 404 and error pages that match the style.

## Data endpoints needed for the graphs
All return JSON, check the session cookie, and only answer for members of the group.
- `GET /api/me/stats`: today, this week, streak, best week, last 8 weeks totals, last 7 days, LeetCode counts by difficulty, XP this week, last 5 solves.
- `GET /api/group/:id/study/daily?week=YYYY-MM-DD`: per member, minutes for each day Monday to Sunday (sessions split at IST midnight).
- `GET /api/group/:id/leetwars/daily?week=YYYY-MM-DD`: per member, XP and solves per day, plus the recent solves feed.

## Desktop layout (min-width 900px, same HTML)
- The bottom tab bar becomes a left sidebar with the same two items, and the mini timer bar moves to the bottom of the sidebar.
- Content is centred, max width about 1100px.
- Groups tab: group cards in a grid; "+" becomes a "New group" button in the top bar; bottom sheets become centred dialogs.
- You tab: study and LeetCode sections side by side.
- Group page: top tabs stay. On Study and Leetwars, the leaderboard sits on the left and the comparison graph on the right.
- Hover states, keyboard focus outlines, and wider tables. Charts get larger.
- Between 600px and 899px (small tablets, phones in landscape): keep the mobile layout, but let cards use two columns.
