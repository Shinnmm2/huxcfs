<!-- coderabbit-ai-generated:v1 -->

# TheCondo server browser

The app provides guest profiles and persistent server listings. Public listings appear in the browser; unlisted listings are accessible to anyone with their link. The application does not run a game server or connect players to a game yet.

## Run locally

Requires Node.js 24. Run `npm start`, then open `http://localhost:3000/play`. The backend creates `data/condo.sqlite`. Set `DATABASE_PATH` to change the database file location; use a persistent disk in production and back it up. `PORT` controls the HTTP port.

Guest sessions are stored in the browser. The database stores a hash of the session token. Clearing browser storage loses access to that guest's profile and server management; there is no account recovery or username verification.

## Connect GitHub Pages to a backend

Deploy this Node app on a host with HTTPS and persistent storage. Set `ALLOWED_ORIGINS=https://shinnmm2.github.io` on the backend (a comma-separated list supports multiple exact origins). Set the GitHub repository Actions variable `CONDO_API_BASE_URL` to the backend's public HTTPS origin, without a trailing path, and run the Pages deployment workflow. The site will show `CONNECTED` when the API responds. If no backend URL is configured, the static site remains in demo mode; a configured but unreachable backend shows offline instead.

These listings are not game servers: a game service and its connection protocol must be integrated before the Join button can connect players. Guest sessions, anonymous server creation, and unlisted links are not a substitute for verified accounts, access controls, moderation, rate limiting, or abuse protection. Add those controls before opening the backend to untrusted traffic.

## Test

Run `npm ci`, `npx playwright install chromium`, and `npm test`. The tests cover the API, session ownership, cross-origin access, database persistence, shared and unlisted listings, browser interactions, and the static Pages build.
