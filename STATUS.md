# STATUS — Study session lifetime rework

## Changes

### Study session lifetime rework

- **Heartbeat-based cleanup removed**: sessions are no longer closed after 3 minutes without a heartbeat. `last_heartbeat_ms` is now only "last seen" info.

- **Max session duration**: `MAX_SESSION_HOURS` env var (default 6). A once-a-minute job closes sessions older than `start_ms + MAX_SESSION_HOURS`, setting `end_ms` to `start_ms + MAX_SESSION_HOURS`.

- **Start closes previous session**: starting a new session now first closes any existing open session (instead of returning 400 "already studying").

- **Stop route accepts `endMs`**: the `POST /group/:id/stop` handler accepts an optional `endMs` body parameter for the "Did you stop earlier?" dialog. Validated: not before `start + 1 min`, not in the future; falls back to `Date.now()`.

- **`GET /api/session/current`**: new endpoint returning `{ session: { start_ms, last_heartbeat_ms } | null, server_now_ms }`.

- **`server_now_ms` in all state messages**: every WebSocket `state`/`update` message and the initial WS handshake include `server_now_ms`. The client computes elapsed time as `(server_now_ms - start_ms) + (Date.now() - received_at)`.

- **`getMemberState` now includes `lastHeartbeatMs`**: the client uses it to show a muted "away" hint when last seen is > 10 min.

- **WebSocket exponential backoff**: reconnection delay starts at 1 s, doubles per attempt, capped at 30 s. Resets to 1 s on successful open.

- **Session/state refetch on visibility**: `visibilitychange` (to visible), `pageshow`, and `online` events trigger a WebSocket reconnect and a call to `GET /api/session/current`. No auto-stop on `pagehide` or `beforeunload`.

- **Screen Wake Lock**: requested via `navigator.wakeLock.request('screen')` inside try/catch when studying, re-requested on visibility visible, released on Stop.

- **Stop dialog for old sessions**: if a session is >= 3 hours old, tapping Stop shows a dialog with a `datetime-local` input. Defaults to now, min = `start + 1 min`, max = now.

- **Mini-timer uses server time**: `absMiniTimer.show()` now accepts `serverNowMs` and `serverNowReceivedAt` to align the mini-timer with server time.

### Modified files
- `server/study.js` — rewritten cleanup, new stop body param, new API, server_now_ms in WS messages
- `server/studyState.js` — `lastHeartbeatMs` added to `getMemberState`
- `views/group.ejs` — all client changes (WS backoff, wake lock, stop dialog, server time calc, refetch on visibility)
- `views/_layout_close.ejs` — mini-timer uses server time when available
- `specs.md` — study timer section updated

## Run
`node server/index.js` — listens on `127.0.0.1:3000` (or `$PORT`)

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

## Security changes applied (2026-11-17)
- CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy via `@fastify/helmet`
- Cache-Control: no-store on HTML pages
- Origin header check on POST/PUT/DELETE (CSRF defense)
- Session ID regenerated on login/register
- Login timing oracle fixed (always runs argon2)
- Push subscription endpoints validated against known push service hostnames (SSRF fix)
- LeetCode username validated with regex before API call
- Invite codes now 64 bits (was 32 bits)
- Rate limiter on invite-by-username (prevents enumeration)
- VAPID keys removed from start.sh
- Group page member data served via `data-*` attribute instead of raw `<%-`
- Server listens on 127.0.0.1:3000 (was 0.0.0.0:3000)

## Push diagnostics added (2026-11-17)

### Server diagnostics (`server/push.js`)
- **Startup logging**: logs whether VAPID keys are present, first 6 chars of public key, whether `VAPID_SUBJECT` starts with `mailto:` or `https://`. Never logs the private key.
- **`POST /api/push/test`** (logged-in only, rate-limited 5/min): sends `"abs test"` to every saved subscription of the caller. Returns JSON with one entry per subscription: `id`, `host` (hostname only), `status` (HTTP status from push service), `error` (body if any). Deletes subscription on 404/410.
- **Nudge logging**: logs one line per nudge: sender id, target id, number of target's subscriptions, status code for each send. If target has zero subscriptions: logs a warning and returns `{ ok: true, noPush: true, targetName: "..." }` so the UI shows `"<name> hasn't turned on notifications"` instead of "Nudged!".

### Client diagnostics
- **`/push-debug` page** (logged-in only): shows live:
  - `Notification.permission`
  - Whether the app is installed (`display-mode: standalone`)
  - Service worker state: registered, scope, active/waiting, script URL
  - Push subscription status: whether `pushManager.getSubscription()` returns one, its endpoint host
  - Whether the server has this endpoint saved for the current user (via `GET /push/subscriptions-for-user`)
  - First 6 characters of the VAPID public key
  - Buttons: "Turn on notifications", "Re-subscribe" (unsubscribe → subscribe → save), "Send test notification to me" (calls `/api/push/test` and shows results inline)
- **Service worker** (`web/dist/sw.js`): push handler always calls `showNotification` inside `event.waitUntil` with generic title/body if payload is missing or unparseable; `notificationclick` handler focuses open window or opens `/`; `skipWaiting()` and `clients.claim()`; version string `sw-v2`. Served with `Cache-Control: no-cache`.
- **Subscription hygiene** in `views/you.ejs`: subscribe when permission is granted; `pushsubscriptionchange` listener re-subscribes and saves the new endpoint; logout handler deletes the device's subscription before navigating.

### How to use the debug page
1. Navigate to `/push-debug` while logged in.
2. Read the diagnostics panel top-to-bottom:
   - **Notification.permission**: `granted` = browser allows notifications; `denied` = blocked by user (must unblock in browser settings); `default` = never asked.
   - **Installed**: `true` if the page is running as a standalone PWA (added to Home Screen). Notifications may not work in a browser tab on iOS — must be installed.
   - **SW registered**: `yes` means the service worker is installed. If `no`, the SW failed to register (check console, HTTPS, or path).
   - **SW scope**: should be `/` for the SW to control the whole app.
   - **SW state**: `active` means it's running. `waiting` means a newer version is ready but the old one is still in control (close all tabs).
   - **SW version**: shows the script URL; check for `sw-v2` in the response body.
   - **Push subscription**: `yes` with an endpoint host means the browser has a valid push subscription. `none` means no subscription — click "Turn on notifications".
   - **Endpoint host**: the push service (e.g. `fcm.googleapis.com`). If unexpected, something is wrong.
   - **Saved on server**: `yes` with count means the server has this device's subscription on record. `no` means the subscription isn't saved — click "Re-subscribe".
   - **VAPID public key**: first 6 chars tell you which key the page is using; must match the server's env var.
3. If "Saved on server" shows `no` but the browser has a subscription, click **"Re-subscribe"** — it unsubscribes, subscribes fresh, and saves to the server.
4. Click **"Send test notification to me"** to fire a test push. The results table shows each subscription's id, host, status code, and error. Status 201 = delivered to the push service. 404/410 = stale subscription (auto-deleted). Other codes = push service rejected it (check VAPID keys, endpoint validity).
5. If no notification arrives after a 201, check: device notifications are enabled in the OS, the browser has notification permission, and the PWA is installed (not just a browser tab on iOS).

## How to test by hand

1. **Start a session**: open a group page, tap "Start studying". Verify the timer counts up and `GET /api/session/current` returns `{ session: { start_ms, last_heartbeat_ms }, server_now_ms }`.

2. **Stop a session (< 3h)**: tap "Stop" within 3 hours of starting. Verify the timer stops and the session state returns to "Not studying". Check `GET /api/session/current` returns `{ session: null, server_now_ms }`.

3. **Stop dialog (> 3h)**: set `MAX_SESSION_HOURS=0.1` in `.env`, restart, start a session, wait 6+ minutes (10% of 1h = 6 min), tap Stop. Verify the "Did you stop earlier?" dialog appears with a time picker. Pick a time 2 minutes ago, confirm. Verify the session closes with that end time.

4. **Start closes previous**: while studying in group A, tap Start on group B. Verify the previous session is closed (end_ms set to now) and a new session starts.

5. **Max-duration cleanup**: set `MAX_SESSION_HOURS=0.001` (~3.6 seconds) in `.env`, start a session, wait 5 seconds. Verify the session is auto-closed at `start_ms + 3.6 s` and the timer stops.

6. **WebSocket disconnect**: start studying, kill the server (`Ctrl+C`), wait for "Reconnecting…" to show, restart the server. Verify the WebSocket reconnects within 30 s (exponential backoff 1 s → 2 s → 4 s → … → 30 s), and the timer continues counting from the server time.

7. **Tab hidden then visible**: start studying, switch to another tab for 10+ seconds, come back. Verify the timer is correct (no jump from local clock drift) and the WebSocket reconnected.

8. **Away hint**: start studying, stop the heartbeat (block `/group/:id/heartbeat` in dev tools or kill the network). After 10+ minutes, verify the member's status shows "Studying · away" in muted color.

9. **Screen Wake Lock**: on a device that supports it (Chrome desktop/mobile), start studying, verify the screen does not turn off. Tap Stop, verify the lock is released.

10. **`server_now_ms` accuracy**: open the WebSocket in browser dev tools Network tab. Verify every WS message contains `server_now_ms`. Compare local `Date.now()` vs `server_now_ms` — they should be close.

### Known problems (unchanged)
- Session cookie invalidated on server restart (dev secret changes). Set `SESSION_SECRET` env var.
- Invite link code is shown but not yet copy-to-clipboard friendly on mobile.
- Pause and stop are the same server-side action (both close the session); "resume" calls start.
- Rate limiter resets on server restart (in-memory, not shared across processes).
- Mini-timer Pause/Stop buttons on mobile are 30px tall (below 44px tap target). Fixing requires restructuring the mini-timer bar layout.
