# STATUS — Build step 5 done

## Run
`node server/index.js` — listens on `0.0.0.0:3000` (or `$PORT`)

## Changes in step 5

### Signup code
- `SIGNUP_CODE` env var: if set, registration requires the matching code. If unset (dev), anyone can register.
- Register form conditionally shows the `signup_code` field.

### Rate limiting
- `server/rateLimit.js` — simple in-memory per-IP rate limiter.
- Login: max 10 attempts per 60 s window (returns 429 with error page).
- Register: max 5 attempts per 60 s window.

### Secure cookies & proxy
- `trustProxy: 1` when `NODE_ENV=production` or `TRUST_PROXY` is set.
- Session cookie: `secure`, `httpOnly`, `sameSite: 'Lax'`.
- WebSocket upgrade handler checks `x-forwarded-proto` for `wss://` behind a proxy.

### PWA
- `web/dist/site.webmanifest` — name "abs", standalone display, theme colour `#6366f1`, SVG icons at 192/512 plus maskable.
- `web/dist/icon.svg` and `web/dist/icon-maskable.svg` — indigo gradient "A".
- `web/dist/sw.js` — caches only `/`, `/login`, `/register` (static shell). Never caches API calls (`/group/*`, `/ws/*`).
- All EJS views include `_head.ejs` partial with theme-color, apple-touch-icon (SVG), manifest link, iOS meta tags (`apple-mobile-web-app-capable`).
- Install prompt on home page: Android uses `beforeinstallprompt` event; iOS shows "Share then Add to Home Screen" instructions.

### New files
- `server/rateLimit.js`
- `views/_head.ejs`
- `web/dist/site.webmanifest`
- `web/dist/sw.js`
- `web/dist/icon.svg`
- `web/dist/icon-maskable.svg`

### Modified files
- `server/index.js` — trustProxy, port from env, secure cookie config
- `server/auth.js` — signup code, rate limiting on POST /login and /register
- `server/study.js` — WebSocket proxy detection via x-forwarded-proto
- `views/login.ejs`, `views/register.ejs`, `views/home.ejs`, `views/group.ejs`, `views/create-group.ejs`, `views/history.ejs`, `views/join.ejs` — include `_head`, install prompt on home, signup code field on register

## Known problems (unchanged)
- Session cookie invalidated on server restart (dev secret changes). Set `SESSION_SECRET` env var.
- Invite link code is shown but not yet copy-to-clipboard friendly on mobile.
- No CSP/helmet headers.
- Pause and stop are the same server-side action (both close the session); "resume" calls start.
- Rate limiter resets on server restart (in-memory, not shared across processes).
