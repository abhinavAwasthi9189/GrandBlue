# STATUS — Build step 6 done + systemd service + UI step 1 (foundation)

## Run
`node server/index.js` — listens on `0.0.0.0:3000` (or `$PORT`)

Set these env vars for push notifications:
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Push/nudge silently no-ops (no error) when VAPID keys are missing, so the app works without them for testing.

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

## Known problems (unchanged)
- Session cookie invalidated on server restart (dev secret changes). Set `SESSION_SECRET` env var.
- Invite link code is shown but not yet copy-to-clipboard friendly on mobile.
- No CSP/helmet headers.
- Pause and stop are the same server-side action (both close the session); "resume" calls start.
- Rate limiter resets on server restart (in-memory, not shared across processes).
- No VAPID key generation helper — generate keys with `node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log('Public:',k.publicKey);console.log('Private:',k.privateKey)"`- Nudge/web push: built but unreliable. Fix later (check VAPID env, service worker updates, iPhone Home Screen install, server log on send).
