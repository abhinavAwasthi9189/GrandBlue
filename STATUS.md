# STATUS — Build step 3 done

## Run
`node server/index.js` — listens on `0.0.0.0:3000`

## Main files
- `server/index.js` — Fastify app, session/plugin/route registration
- `server/db.js` — SQLite setup (`data/abs.db`), schema + indexes
- `server/auth.js` — register, login, logout
- `server/groups.js` — create group, invite, invite link, join, approve/reject, leave, remove, settings
- `server/study.js` — WebSocket server, timer start/stop/heartbeat, stale session cleanup
- `server/studyState.js` — shared functions: week-IST boundary, member state, active-member queries
- `views/` — EJS templates

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

## Tables
- `users(id, username, password_hash, leetcode_username, created_at)`
- `sessions(id, user_id, start_ms, end_ms, last_heartbeat_ms)` — indexed on `(user_id, start_ms)`
- `groups(id, name, owner_id, weekly_quota, created_at)`
- `memberships(group_id, user_id, role, status, created_at)`
- `invites(code, group_id, created_by, expires_at)`

## WebSocket protocol
- `state` — full member list sent on connect: `{type:"state", members:[{userId,username,studying,startMs,lastEndMs,weekTotalMs}]}`
- `update` — single-member change: `{type:"update", member:{...}}`
- Broadcast on timer start/stop/cleanup to all groups the user belongs to.

## Known problems (unchanged)
- Session cookie invalidated on server restart (dev secret changes). Set `SESSION_SECRET` env var.
- Invite link code is shown but not yet copy-to-clipboard friendly on mobile.
- No rate limiting or brute-force protection on auth routes.
- No CSP/helmet headers.
- Pause and stop are the same server-side action (both close the session); "resume" calls start.