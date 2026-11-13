# STATUS — Build step 4 done

## Run
`node server/index.js` — listens on `0.0.0.0:3000`

## Main files
- `server/index.js` — Fastify app, session/plugin/route registration
- `server/db.js` — SQLite setup (`data/abs.db`), schema + indexes
- `server/auth.js` — register, login, logout
- `server/groups.js` — create group, invite, invite link, join, approve/reject, leave, remove, settings
- `server/study.js` — WebSocket server, timer start/stop/heartbeat, stale session cleanup
- `server/studyState.js` — shared functions: week-IST boundary, boundary-aware week totals in SQL, member state, active-member queries
- `server/history.js` — weekly history route with pagination
- `scripts/seed-sessions.js` — fills fake sessions for past weeks to test history
- `views/` — EJS templates (`history.ejs` added)

## Routes
- `GET/POST /register`, `/login`, `GET /logout`
- `GET/POST /create-group`, `GET /group/:id`
- `POST /group/:id/invite`, `/invite/:groupId/accept`, `/invite/:groupId/decline`
- `GET /invite-link/:id`, `GET /join/:code`
- `POST /group/:id/approve/:userId`, `/group/:id/reject/:userId`
- `POST /group/:id/leave`, `/group/:id/remove/:userId`, `/group/:id/settings`
- (**new**) `POST /group/:id/start` — start a study session (must be active member, no open session)
- (**new**) `POST /group/:id/stop` — stop the current study session
- (**new**) `POST /group/:id/heartbeat` — update last_heartbeat_ms
- (**new**) `GET /ws/group/:id` — WebSocket upgrade (checks session cookie, must be active member)
- (**new**) `GET /group/:id/history?page=N` — past weeks' totals, 10 weeks per page, newest first

## Tables
- `users(id, username, password_hash, leetcode_username, created_at)`
- `sessions(id, user_id, start_ms, end_ms, last_heartbeat_ms)` — indexed on `(user_id, start_ms)`
- `groups(id, name, owner_id, weekly_quota, created_at)`
- `memberships(group_id, user_id, role, status, created_at)`
- `invites(code, group_id, created_by, expires_at)`

## Weekly totals
- Weeks are Monday 00:00 to Sunday 23:59 Asia/Kolkata (`getWeekStartIST`).
- Current week per member is shown live on the group page (WS `state`/`update`, `weekTotalMs`), using finished sessions **plus** any running one.
- History page lists past weeks (newest first, 10/page) with each member's total.
- Sessions crossing midnight or the Monday boundary are split in SQL: per week, contribution = `MAX(0, MIN(end_or_now, weekEnd) - MAX(start_ms, weekStart))`, computed directly in the query — no running-total table.

## WebSocket protocol
- `state` — full member list sent on connect: `{type:"state", members:[{userId,username,studying,startMs,lastEndMs,weekTotalMs}]}`
- `update` — single-member change: `{type:"update", member:{...}}`
- Broadcast on timer start/stop/cleanup to all groups the user belongs to.

## Seeding
`node scripts/seed-sessions.js` — creates 1–4 fake sessions per member for the past 8 weeks (~20% cross the Monday boundary to exercise splitting).

## Known problems (unchanged)
- Session cookie invalidated on server restart (dev secret changes). Set `SESSION_SECRET` env var.
- Invite link code is shown but not yet copy-to-clipboard friendly on mobile.
- No rate limiting or brute-force protection on auth routes.
- No CSP/helmet headers.
- Pause and stop are the same server-side action (both close the session); "resume" calls start.