# STATUS — Build step 6 done + systemd service

## Run
`node server/index.js` — listens on `0.0.0.0:3000` (or `$PORT`)

Set these env vars for push notifications:
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Push/nudge silently no-ops (no error) when VAPID keys are missing, so the app works without them for testing.

## Changes in step 6

### Database
- `push_subscriptions(id, user_id, endpoint, keys_json, created_at)` — unique endpoint per device
- `nudges(id, from_user, to_user, group_id, created_at)` — indexed on `(from_user, to_user, group_id)` for cooldown lookups

### New file: `server/push.js`
- `GET /push/vapid-public-key` — returns the VAPID public key (no auth, used by the browser before subscribing)
- `POST /push/subscribe` — saves a push subscription for the current user (auth required)
- `POST /push/unsubscribe` — removes a subscription (auth required)
- `POST /group/:id/nudge/:userId` — nudge endpoint: checks both users are active members, enforces 10-minute cooldown, logs the nudge, sends push to all target subscriptions, deletes subscriptions that return 404/410

### Modified: `server/index.js`
- Registers the `push.js` plugin

### Modified: `server/db.js`
- Creates `push_subscriptions` and `nudges` tables

### Modified: `web/dist/sw.js`
- Added `push` event handler: shows notification with generic "Time to study together" text, opens group page on click
- Added `notificationclick` event handler: focuses existing window or opens new one

### Modified: `views/group.ejs`
- Notification section: status text + "Turn on notifications" button (only shows when permission is `default`)
- Permission check on page load; `requestPermission()` only when button is tapped (iPhone requirement)
- `GET /push/vapid-public-key` → subscribe with `applicationServerKey`
- Nudge column in members table: button next to non-studying members
- Nudge UI feedback: green "Nudged!" on success, red error message on failure/cooldown (clears after 4 s)
- Nudge button is hidden while the member is studying (re-evaluated on each WS update + render call)

### New dependency
- `web-push` — used server-side to send push notifications with VAPID

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
