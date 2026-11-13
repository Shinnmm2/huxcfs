<!-- coderabbit-ai-generated:v1 -->

# TheCondo server browser

The app provides guest profiles and persistent server listings. Public listings appear in the browser; unlisted listings are accessible to anyone with their link. The application does not run a game server or connect players to a game yet.

## Run locally

Requires Node.js 24. Run `npm start`, then open `http://localhost:3000/play`. The backend creates `data/condo.sqlite`. Set `DATABASE_PATH` to change the database file location; use a persistent disk in production and back it up. `PORT` controls the HTTP port.

Guest sessions are stored in the browser. The database stores a hash of the session token. Clearing browser storage loses access to that guest's profile and server management; there is no account recovery or username verification.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:59d191e41debf3c2ff9391f4c69cdb89293004d3a53cf1b3054859415485644c -->

## Test deployment on Wasmer

The Wasmer package uses the Edge.js QuickJS runtime and Wasmer's managed PostgreSQL database. The existing local Node setup continues to use SQLite. The two databases are separate; existing SQLite data is not automatically copied to PostgreSQL.

1. Install Node.js 24 and the [Wasmer CLI](https://docs.wasmer.io/install).
2. From this repository, run:

   ```sh
   npm ci
   npm run build:wasmer
   wasmer login
   wasmer deploy
   ```

3. Choose your Wasmer account or namespace when prompted. Change `name` in `app.yaml` if the test app name is already taken. The deployment provisions a managed PostgreSQL database in `fr-roub1`. Open the URL printed by Wasmer and visit `/play` to test the website and API together. Check `/api/health` for database readiness.

`npm run build:wasmer` creates `_wasmer/`, a deployment package containing the app and production dependencies, without local SQLite data or Git files. Run it again before each deployment. The CLI deployment requires that directory; importing the repository directly without the build step does not create it.

The supplied `app.yaml` is for testing: `DB_TLS_MODE=unverified` encrypts database traffic but does **not** verify the server certificate, as Wasmer's managed database uses a private CA. Use test data only. For verified TLS, set `DB_TLS_MODE=verify` and provide the trusted CA certificate in `DB_CA_CERT` through Wasmer secrets. Wasmer injects `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, and `DB_PASSWORD` for its managed database. Database setup and deployment can take time.

These listings are not game servers: a game service and its connection protocol must be integrated before the Join button can connect players. Guest sessions, anonymous server creation, and unlisted links are not a substitute for verified accounts, access controls, moderation, rate limiting, or abuse protection. Add those controls before opening the backend to untrusted traffic.

## Connect GitHub Pages to a backend

To use the existing GitHub Pages site with the deployed API, set the GitHub repository Actions variable `CONDO_API_BASE_URL` to the backend's public HTTPS origin, without a trailing path, and run the Pages deployment workflow. The Wasmer configuration allows `https://shinnmm2.github.io` through CORS. The site shows `CONNECTED` when the API responds. If no backend URL is configured, the static site remains in demo mode; a configured but unreachable backend shows offline instead.



<!-- /coderabbit-ai-generated:v1 --><!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:40dcf5797ff1b73acaf8c83e438d5cd2c6aada1e22d9ff03ad88b0b5ba207d78 -->

## Test

Run `npm ci`, `npx playwright install chromium`, and `npm test`. The default suite covers SQLite, API authorization, CORS, browser interactions, and the static Pages build. The PostgreSQL test runs when `TEST_PG_HOST`, `TEST_PG_PORT`, `TEST_PG_DATABASE`, and `TEST_PG_USER` point to a disposable local database; set `TEST_PG_PASSWORD` if needed. This local test uses an unencrypted localhost connection. GitHub Actions runs both suites with a disposable PostgreSQL service.


<!-- /coderabbit-ai-generated:v1 -->