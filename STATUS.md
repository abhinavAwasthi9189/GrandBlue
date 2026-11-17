# STATUS — Build step 6 done + systemd service + all UI steps + Avatar upload + Nudge real-time + Members tab cleanup

## Changes

### Avatar upload (long-press on You page avatar)
- New column `avatar` on users table (INTEGER DEFAULT 0) + migration for existing DBs.
- `POST /avatar` accepts a base64 data URL, saves as `data/avatars/{userId}.jpg`.
- `GET /avatar/:userId` serves the image or 404.
- `avatar` field included in `getMemberState()` (studyState.js) and all member queries (study.js, leetwars.js).
- You page: conditional avatar rendering — `<img>` if set, colored circle + initial otherwise.
- Long-press (mobile) or click (desktop) opens file picker → crop dialog with drag-to-pan, zoom slider, circular preview → saves to server.
- Member list (group.ejs), study leaderboard (group-study.ejs), leetwars leaderboard/behind/solves (leetwars.ejs) all render custom avatars.

### Members tab cleanup
- Removed "last studied X ago" from member rows — only shows weekly total.
- Weekly total text is bold (`.week { font-weight: 700 }`).
- Studying members sorted first (already existed), now also get `.studying` class with accent-tinted background.

### Notification prompts removed from group page
- Notification permission prompt / "Turn on notifications" button removed from group.ejs entirely.
- Notification management now only in You tab → Settings → Notifications.

### Nudge real-time via WebSocket
- `study.js` exposes `broadcastToGroup` via fastify.decorate.
- `push.js` broadcasts `{ type: 'nudge', fromUsername, targetUserId }` to the group over WebSocket after recording a nudge.
- `group.ejs` WebSocket handler shows a toast ("{user} nudged you!") when the target receives a nudge.

### Stats display fix
- Stats fetch error catch now shows "-" instead of "Error" for new users with no data.

## Run
`node server/index.js` — listens on `0.0.0.0:3000` (or `$PORT`)

Set these env vars for push notifications:
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Push/nudge silently no-ops (no error) when VAPID keys are missing, so the app works without them for testing.

## Changes in UI step 4 (Group page shell and Members tab)

### New files
- `views/group-study.ejs` — placeholder Study tab with link to existing history page
- `views/group-settings.ejs` — extracted admin settings page with name edit, quota, invite username, invite codes with copy button, delete group (confirmation dialog)

### Modified: `views/group.ejs`
- **Top bar**: back arrow, group name, settings gear (admin) or "⋯" menu (member).
- **Timer bar**: Start/Stop buttons in the group header, drives the mini timer bar via `window.absMiniTimer`.
- **Top tabs**: Members (active), Study, Leetwars each with their own URL.
- **Members tab**: avatar (coloured from user id hash), name + Admin badge, live status (populated via WebSocket), time this week, Nudge button (hidden when studying), Remove button (admin only, opens confirmation dialog).
- **Admin sections**: join requests (Approve/Reject), invite by username, invite code list with Copy button, Leave group button.
- **Confirmation dialogs**: Leave group (with cancel), Remove member (with member name).
- **Member leave**: Leave group button (non-admin, opens confirmation dialog).
- Copied the existing WebSocket, heartbeat, nudge, and notification logic unchanged.

### Modified: `server/groups.js`
- Added `GET /group/:id/study` — renders `group-study.ejs` placeholder.
- Added `GET /group/:id/settings` — renders `group-settings.ejs` with invite links and pending invite count.
- Settings POST handler now also updates group name.

## Changes in UI step 5 (Study tab)

### New API: `GET /api/group/:id/study/daily?week=YYYY-MM-DD`
- Returns JSON with `days` (7 entries Mon–Sun, each with `label` and `data` array per member in minutes) and `members` (id, username).
- Sessions are split at IST midnight for per-day accuracy.
- Checks session auth and active membership; 403 if not a member.
- Defaults to current week if `week` param omitted.

### Modified: `server/study.js`
- Added `dailyTotalsForGroup()` helper that computes per-day study minutes for all active members.
- Added the `/api/group/:id/study/daily` route.

### Modified: `server/groups.js`
- `/group/:id/study` route now passes `historyWeeks` (10 past weeks from existing history data) and `allMembers` to the template.

### Rewritten: `views/group-study.ejs`
- **Week picker**: prev/next buttons, current week label with IST note. "Next" is disabled beyond current week.
- **Leaderboard**: rank, coloured initial avatar, name (with "(you)" for self), proportional bar showing share of leader's time, total time in monospace.
- **Comparison line graph**: Chart.js line chart, one line per member, Monday–Sunday. My line is thicker (borderWidth 4 vs 2). Custom legend below the chart; tapping a name toggles that dataset visibility (opacity 0.4 when hidden).
- **Past weeks table**: latest 10 past weeks, server-rendered, newest first. Each column per member, monospace times.
- Each member's colour is deterministic from user id (`hueFromId`, same as avatar hashing).

## Changes in UI step 6 (Leetwars tab)

### New API: `GET /api/group/:id/leetwars/daily?week=YYYY-MM-DD`
- Returns JSON with `days` (7 entries Mon–Sun, each with `label` and `data` array per member: `userId`, `username`, `xp`, `solves`) and `members` (id, username, leetcode_username).
- Computes daily XP from `solved_problems` using the existing XP_MAP (Easy=10, Medium=25, Hard=50).
- Checks session auth and active membership; 403 if not a member.
- Defaults to current week if `week` param omitted.

### Modified: `server/leetwars.js`
- Added `getDailyLeetwars()` helper that computes per-day XP and solve count per member for Mon–Sun.
- Added the `/api/group/:id/leetwars/daily` route.

### Rewritten: `views/leetwars.ejs`
- **Week picker**: prev/next buttons, current week label with IST note. "Next" disabled beyond current week.
- **LeetCode link/unlink**: card at top to link, change, or unlink your LeetCode username.
- **Quota card**: "You: X of Y problems this week" with a progress bar (green when complete).
- **XP Leaderboard**: rank, coloured avatar, name with "(you)" self-label, "unlinked" badge for users without LC, proportional XP bar, XP count and solve count.
- **Comparison line graph**: Chart.js line chart, daily XP per member Mon–Sun. My line thicker (borderWidth 4 vs 2). Custom legend toggles visibility.
- **Behind on quota**: list with avatar, name, owed count, "not linked" label for non-LC users, nudge button.
- **Recent solves feed**: latest 20 solves across all members, showing who solved what, difficulty chip, time ago.

## Changes in UI step 3 (You tab)

### New file: `server/stats.js`
- `GET /api/me/stats` — returns JSON with today's total, this week total, streak (consecutive days with study), best week, last 8 weeks (bar chart data), last 7 days (study per day), and LeetCode stats (by-difficulty counts, XP this week, last 5 solves, 7-day solve chart). Session-auth required; returns 401 if unauthenticated.

### New file: `views/change-password.ejs`
- Form with current + new password fields, error/success states.

### New file: `public/vendor/chart.umd.min.js`
- Chart.js 4.4.8 downloaded and served locally (no CDN).

### Modified: `server/index.js`
- Registers `stats.js` plugin.
- `/you` route now renders with `username`, `membershipCount`, `hasLeetcode`, `leetcodeUsername`.
- Added `GET /change-password` and `POST /change-password` routes — validates current password, updates to new password.

### New/modified: `views/you.ejs`
- **Header**: coloured initials avatar (from user id), username, "Member of N groups".
- **Study section**: Today, This week, Streak, Best week — populated via fetch to `/api/me/stats`. Bar charts for last 8 weeks and last 7 days using Chart.js.
- **LeetCode section**: Link form (not linked) or username with Change/Unlink, by-difficulty chips, XP this week, 7-day solves chart, last 5 solves.
- **Settings list**: Notification status with subscribe button, Install app button (beforeinstallprompt + iOS fallback), Change password link, Log out button.

## Changes in UI step 2 (Groups tab / home)

### Modified: `server/index.js`
- Home route now enriches each group with `memberCount` (active members), `studyingNow` (members with an open session), and `myWeekMs` (current user's study time this week) via `studyState` helpers.
- Pending invites now include the inviting admin's username (`invited_by`).

### Modified: `views/home.ejs`
- Group cards show: name, member count (x/15), "N studying now" in green, and my time this week (mono font).
- Pending invite cards show: group name, "Invited by <username>", Accept / Decline buttons.
- "Requested" section still shows groups awaiting admin approval.
- Empty state appears only when no groups, no invites, and no requests exist.
- "Join with code" button in the top bar opens a bottom sheet.
- FAB opens the create-group bottom sheet (name + weekly quota).
- Removed the old list-row group list and the old inline JS that appended a Join button.

## Changes in UI step 1 (foundation)

### New files
- `public/css/tokens.css` — CSS custom properties for the design system (dark default, light via `prefers-color-scheme`). Covers colours, spacing, radii, font sizes, shadows, safe-area insets, sidebar/tab-bar dimensions.
- `public/css/app.css` — shared component classes: `.card`, `.btn` (primary/secondary/danger/ghost), `.chip`, `.list-row`, `.avatar` (with colour-from-id support), `.dialog-overlay`/`.dialog-content` (bottom sheet + centred dialog), `.fab`, `.progress-bar`, `.empty-state`, `.toast`, and the layout shell (`.app-shell`, `.tab-bar`, `.sidebar`, `.mini-timer`).
- `views/_layout.ejs` — shared EJS layout partial with:
  - Left sidebar on screens ≥900px (Groups + You links)
  - Bottom tab bar on mobile (Groups + You with badge)
  - Mini timer bar (hidden by default, activated via `window.absMiniTimer.show()`)
  - `_layout_close.ejs` — closes the shell, includes the mini timer JS that exposes `absMiniTimer` globally
- `views/you.ejs` — placeholder for the You tab (step 2+)

### Modified files
- `server/index.js` — serves `public/` alongside `web/dist/` via `@fastify/static` with multiple root directories; added `GET /you` route
- `server/groups.js` — passes `pendingInviteCount` to group templates for the badge
- `server/history.js` — passes `pendingInviteCount` to history template
- `server/leetwars.js` — passes `pendingInviteCount` to leetwars templates
- `views/login.ejs` — uses `_layout` + `_layout_close`, redesigned as centred card with styled inputs
- `views/register.ejs` — same treatment as login
- `views/home.ejs` — uses layout, redesigned with list rows, FAB for create group, bottom sheets for create/join, badge on tab, styled user area
- `views/group.ejs` — uses layout, redesigned with avatar circles (colour from user id hash), member rows, card-based invites/settings, styled timer/notif bar, top tabs
- `views/history.ejs` — uses layout, redesigned with card table, styled pagination
- `views/leetwars.ejs` — uses layout, redesigned with cards, styled table, inline chips
- `views/create-group.ejs` — uses layout, centred card
- `views/join.ejs` — uses layout, centred success card

### How the new layout works
- Every page inherits `<link>` to tokens.css + app.css via `_layout.ejs`
- The bottom tab bar has two items: Groups (link to `/`) and You (link to `/you`)
- A "mini timer bar" is hidden in the DOM and shown by calling `window.absMiniTimer.show(startMs, groupId)` when the user starts studying on the group page
- Desktop (≥900px): sidebar replaces tab bar, content gets `margin-left: var(--sidebar-width)`
- The badge on Groups tab shows pending invite count (passed as `pendingInviteCount` to each view)

## Changes in UI step 8 (Polish)

### 404 and error pages
- **New file: `views/404.ejs`** — styled error page with "Page not found" message and "Go home" button
- **New file: `views/error.ejs`** — generic error page with dynamic message (exposed in dev, hidden in production)
- **Modified: `server/index.js`** — added `setNotFoundHandler` (renders 404 view) and `setErrorHandler` (renders error view)

### Reconnecting strip
- **Modified: `views/group.ejs`** — WebSocket `connect()` now shows a "Reconnecting…" warning strip (`.reconnecting`) when the connection drops, hides it on `onopen`. Strip is inserted above `.app-main` on first disconnect.

### Loading / empty / error states
- **Modified: `views/group-study.ejs`** — fetch to `/api/group/:id/study/daily` now shows "Failed to load. Retry" and destroys the chart on failure
- **Modified: `views/leetwars.ejs`** — same error treatment for the chart fetch; chart legend area shows retry link on failure
- **Modified: `views/you.ejs`** — stats fetch `.catch()` now sets all stat values to "Error" on API failure

### Phone-width fixes (360px/390px)
- **Modified: `public/css/app.css`**
  - Added `@media (max-width: 400px)` — stat grid collapses to 2 columns, toast/dialog padding reduced, mini timer font smaller
  - Added `.btn-back` — 44×44px tap target for back-arrow links
  - Added `.header-bar`, `.header-actions` — prevent header button wrapping, allow title truncation
  - Added `.you-stats-grid` — used by CSS override at small widths
- **Modified all headers** in `group.ejs`, `group-study.ejs`, `leetwars.ejs`, `history.ejs`, `group-settings.ejs`, `change-password.ejs` — use `.header-bar`, `.btn-back`, truncating title

### Install prompt "shown once"
- **Modified: `views/you.ejs`** — install button visibility now respects `localStorage.getItem('abs-install-shown')`; sets it to `'1'` after first prompt/dismiss

### What was not fixed (intentional)
- Notification permission prompt is **not auto-shown** on first visit — it remains accessible only from the You tab's Settings list, which is the designed flow
- No toast/notification when a nudge fails — nudge already shows inline text feedback on the button
- No animated loading spinners — placeholder "Loading…" text is used everywhere per existing pattern
- No CSP/helmet headers — unchanged from Known problems
- The mini-timer pause/stop buttons at mobile widths are 30px high (`.mini-timer-actions .btn`) — they are `btn-sm` with 30px min-height, which is below 44px. Fix would require restructuring the mini-timer layout; marked as known problem

## systemd service

Service file at `/etc/systemd/system/abs.service`. Commands to install/enable/check:

```bash
sudo mv /tmp/abs.service /etc/systemd/system/abs.service       # install (needs sudo)
sudo systemctl daemon-reload                                    # reload after install
sudo systemctl enable abs                                       # enable on boot
sudo systemctl start abs                                        # start now
sudo systemctl status abs                                       # check status
sudo journalctl -u abs -f                                       # follow logs
```

## Changes in UI step 7 (Desktop layout)

### Modified: `public/css/app.css`
- Added desktop (≥900px) layout overrides:
  - `group-cards` — 2-column grid for group cards on the home page
  - `study-split` — flex row for leaderboard (fixed 320px) + comparison chart (flexible) side by side
  - `you-split` — flex row for Study and LeetCode sections side by side
  - FAB hidden, "New group" button shown in the top bar
  - Centered dialogs on all screens (`.dialog-overlay` already had `align-items: center` at ≥900px)
  - Hover and focus-visible outlines on all interactive elements
- Added tablet (600–899px) media query: `group-cards` becomes a 2-column grid (keeping mobile layout otherwise)

### Modified: `views/home.ejs`
- Wrapped group card container in `.group-cards` for grid layout
- Added `desktop-new-btn` — "New group" button in the top bar (hidden on mobile via CSS)
- Added `mobile-join-row` class on "Join with code" button (hidden on desktop via CSS)
- Added JS click handler for the desktop "New group" button

### Modified: `views/group-study.ejs`
- Wrapped leaderboard + chart cards in `.study-split` div for side-by-side layout ≥900px

### Modified: `views/leetwars.ejs`
- Wrapped leaderboard + chart cards in `.study-split` div for side-by-side layout ≥900px

### Modified: `views/you.ejs`
- Wrapped Study and LeetCode sections in `.you-split` div for side-by-side layout ≥900px

## How to verify at three window widths

| Width range | Expected layout |
|---|---|
| **≥900px** (desktop) | Left sidebar visible, content centred (max 1100px). Home: 2-column group card grid, "Join with code" hidden, FAB hidden, "New group" button in top bar. Study/Leetwars: leaderboard on left, chart on right. You tab: Study and LeetCode side by side. Dialogs centred. |
| **600–899px** (tablet) | Bottom tab bar, mobile layout. Home: 2-column group card grid. Study/Leetwars: leaderboard above chart (stacked). You tab: sections stacked. Dialogs bottom sheets. |
| **<600px** (phone) | Bottom tab bar, single-column cards, bottom sheets, everything stacked. |

1. Run the app with `node server/index.js`
2. Open browser dev tools and toggle device toolbar (or resize the window)
3. At each width band, check the layout matches above

## Known problems (unchanged)
- Session cookie invalidated on server restart (dev secret changes). Set `SESSION_SECRET` env var.
- Invite link code is shown but not yet copy-to-clipboard friendly on mobile.
- No CSP/helmet headers.
- Pause and stop are the same server-side action (both close the session); "resume" calls start.
- Rate limiter resets on server restart (in-memory, not shared across processes).
- No VAPID key generation helper — generate keys with `node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log('Public:',k.publicKey);console.log('Private:',k.privateKey)"`- Nudge/web push: built but unreliable. Fix later (check VAPID env, service worker updates, iPhone Home Screen install, server log on send).
- Mini-timer Pause/Stop buttons on mobile are 30px tall (below 44px tap target). Fixing requires restructuring the mini-timer bar layout.
