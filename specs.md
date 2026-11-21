# abs: study together app

Self-hosted PWA for friend groups to study together, see live study time, and compete on LeetCode. Works on iPhone and Android through the browser. Runs on one Debian laptop (hostname `friday`).

## Stack
- Backend: Node (LTS), Fastify, `ws` WebSockets, `better-sqlite3`, `argon2`, `web-push`, `node-cron`
- Frontend: Vite + React PWA (manifest + service worker), served by the same Fastify server from `web/dist`
- One repo: `server/` and `web/`. One process, one SQLite file (`data/abs.db`).
- Keep dependencies few. Ask before adding a new one.

## Fixed rules
- Weeks run Monday 00:00 to Sunday 23:59 in Asia/Kolkata. Store all timestamps as UTC milliseconds; compute week boundaries in IST.
- Max 15 active members per group. Enforce it on the server inside a transaction, never only in the UI.
- Auth: username + password (argon2), httpOnly session cookie. Usernames are unique, lowercase. Invites find people by exact username only (no search/browse).
- Any user can create a group and becomes its admin. Admin sets the weekly quota and approves join requests.
- Realtime events go only to members of that group.
- Push notification text stays generic (for example "Time to study together"), never private details.
- Secrets live in environment variables or `.env`. Never commit `.env`, keys, or the database.

## Data model (SQLite)
- `users(id, username, password_hash, leetcode_username, created_at)`
- `groups(id, name, owner_id, weekly_quota, created_at)`
- `memberships(group_id, user_id, role['admin'|'member'], status['invited'|'requested'|'active'], created_at)`
- `invites(code, group_id, created_by, expires_at)`
- `sessions(id, user_id, start_ms, end_ms NULL, last_heartbeat_ms)`
- `nudges(id, from_user, to_user, group_id, created_at)`
- `push_subscriptions(id, user_id, endpoint, keys_json)`
- `solved_problems(user_id, slug, difficulty, solved_at_ms)` with unique (user_id, slug) per week counting
- Index sessions by (user_id, start_ms) and solved_problems by (user_id, solved_at_ms).

## Study timer
- A session stays open until: the user taps Stop, or the user starts another session (previous session is closed at `Date.now()`), or the user's WebSocket stays disconnected for `MAX_SESSION_HOURS` (env var, default 6).
- When the user's last WebSocket disconnects, the server starts a grace timer of `MAX_SESSION_HOURS`. If the user reconnects before it expires, the timer resets and the session continues uninterrupted (all time counted). If the timer expires, the session is closed with `end_ms = now - MAX_SESSION_HOURS`, so the disconnected grace period is NOT counted as study time.
- Missing heartbeat, phone sleeping, or the app being closed NEVER directly ends a session — they only matter because they cause the WebSocket to disconnect, which starts the grace timer.
- Client sends a heartbeat every 30 s.
- Live view per group: each member with a running timer if studying, otherwise "last studied X ago", plus this week's total. If a studying member's last heartbeat is older than 10 minutes, a small muted "away" hint is shown.
- The server is the only clock. All state messages include `server_now_ms`. The client computes elapsed time as `(server_now_ms - start_ms) + local_time_since_message_arrived`.
- Client: on `visibilitychange` (to visible), `pageshow` and `online`, refetches the current session and reconnects the WebSocket. WebSocket reconnection uses exponential backoff (1 s up to 30 s). Never sends Stop automatically on `pagehide` or `beforeunload`.
- Screen Wake Lock: requested while the timer is visible and running (inside try/catch), re-requested on visibility visible, released on Stop.
- When the user taps Stop on a session older than 3 hours, a dialog appears with a time picker defaulting to now (min: `start + 1 min`, max: now).
- Nudge button sits next to members who are not studying. Cooldown: one nudge per (sender, target) per 10 minutes.
- History: weekly totals for past weeks per person (group view).
- `GET /api/session/current` returns the current open session or null, plus `server_now_ms`.

## Leetwars
- Poll every 20 min per linked account with LeetCode's unofficial GraphQL `recentAcSubmissionList`; store new accepted solves.
- Count a problem once per person per week. XP: Easy 10, Medium 25, Hard 50.
- Weekly leaderboard by XP, plus each person's solved list. "Behind on quota" list shows who still owes how many (quota = number of problems, set by the group admin), with a nudge button.
- LeetCode data may lag by one polling interval. Handle failures quietly and retry later.

## Screens
Login/register, home (my groups + invites), create group, group page (live timers, nudge, week total), group settings (quota, members, invite link, approve requests), Leetwars tab, install-to-Home-Screen prompt, notification permission screen.

## Build order (each step must run before the next starts)
1. Project skeleton, SQLite setup, register/login/logout. Done when two accounts can log in.
2. Groups: create, invite by username, invite code, request/approve, 15-member cap. Done when the cap is rejected server-side.
3. Study timer with WebSocket live view and heartbeat cleanup. Done when two phones see each other's timers live.
4. Weekly totals and history.
5. HTTPS exposure (Tailscale Funnel) and PWA install on iPhone and Android.
6. Web push and the nudge button.
7. Leetwars polling, XP, leaderboard, quota list.
8. Nightly SQLite backup to the other laptop.

## Project rules
- Don't read or edit .env, shell rc files, or the database file directly.
- Ask before breaking schema changes, deleting files, or adding dependencies.
- After each build step, update STATUS.md and say how to check it by hand.

