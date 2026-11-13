<!-- coderabbit-ai-generated:v1 -->

# TheCondo server browser

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:97bdc40957c0ffcfd19d422929b800a566f8743f80d09e63731251b5f5aedea1 -->

The app provides guest profiles and persistent server listings. Public listings appear in the browser; unlisted listings are accessible to anyone with their link. Listings can link to a Roblox experience; the app does not create or reserve a Roblox game server.

<!-- /coderabbit-ai-generated:v1 -->

## Run locally

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:efa3b99d58a3b118c740096b951fae503025e7b792070be6e274ff3de0a6bb74 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:7421cb40fdc723e649cf04416f889b9dacc6c423051c71c6fe3daeac9ff7b4d6 -->

Requires Node.js 24. Run `npm start`, then open `http://localhost:3000/home` for the dashboard, `/login` for profile verification, or `/play` for the server browser. The backend creates `data/condo.sqlite`. Set `DATABASE_PATH` to change the database file location; use a persistent disk in production and back it up. `PORT` controls the HTTP port. Friends are not connected yet.

<!-- /coderabbit-ai-generated:v1 -->

<!-- /coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:f540651ccea17bc4913c7476ec402d4ec527fd96364086ee0cdac4b240705cd1 -->

Guest sessions are stored in the browser; the database stores a hash of the session token. Clearing browser storage loses access to an unverified guest's profile and server management. A verified account can be recovered with its recovery code, which is shown once and replaced whenever it is used. Save the new code in a safe place. Existing guest listings are linked to the verified account.

## Enable Roblox verification

Create a Cloudflare Turnstile widget for each website hostname. Configure the backend with `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `TURNSTILE_HOSTNAMES` (a comma-separated list of allowed frontend hostnames, such as `shinnmm2.github.io` and your Wasmer hostname). Put the secret in your hosting provider's secret settings; do not commit it. Verification remains unavailable until all three settings are present. For GitHub Pages, also connect the frontend to the deployed backend as described below.

The app checks a short-lived phrase in the account's public Roblox profile. It never asks for a Roblox password. Cloudflare's public test keys may be used locally with `ALLOW_TURNSTILE_TEST_KEYS=1` and `NODE_ENV` set to a value other than `production`; use real keys for public deployment. CAPTCHA alone does not provide complete abuse protection.

<!-- /coderabbit-ai-generated:v1 -->

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

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:ac07d481c03580e3ba739f16bc7a52074afead6bafb9fc859a45491b285142ac -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:8b8316b938523c113d89589e9b032d22bd7fd576017845e055c7ef06997369eb -->

Use the Create page at `/create` (or `create.html` on GitHub Pages) to choose a listing image, visibility, displayed player limit, and an optional public Roblox game URL or Place ID. To change the link later, open My servers and choose Edit Roblox game. The selected image and displayed limit do not change the Roblox game. The Join dialog links to the Roblox game page and offers a Web Play beta link. Roblox controls Web Play access and browser support; its creator beta is limited to eligible creators and testers. A listing links to an experience, not a particular running Roblox server, and unlisted listings are not private Roblox servers.

Automatic `.rbxl` uploading, publishing, and Roblox server provisioning are not implemented. Publish the file to an experience using Roblox Studio and enter its Place ID or URL when creating a listing.

<!-- /coderabbit-ai-generated:v1 -->

Guest sessions, anonymous server creation, and unlisted links are not a substitute for access controls, moderation, rate limiting, or abuse protection. Add those controls before opening the backend to untrusted traffic.

<!-- /coderabbit-ai-generated:v1 -->

## Connect GitHub Pages to a backend

To use the existing GitHub Pages site with the deployed API, set the GitHub repository Actions variable `CONDO_API_BASE_URL` to the backend's public HTTPS origin, without a trailing path, and run the Pages deployment workflow. The Wasmer configuration allows `https://shinnmm2.github.io` through CORS. The site shows `CONNECTED` when the API responds. If no backend URL is configured, the static site remains in demo mode; a configured but unreachable backend shows offline instead.



<!-- /coderabbit-ai-generated:v1 --><!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:40dcf5797ff1b73acaf8c83e438d5cd2c6aada1e22d9ff03ad88b0b5ba207d78 -->

## Test

Run `npm ci`, `npx playwright install chromium`, and `npm test`. The default suite covers SQLite, API authorization, CORS, browser interactions, and the static Pages build. The PostgreSQL test runs when `TEST_PG_HOST`, `TEST_PG_PORT`, `TEST_PG_DATABASE`, and `TEST_PG_USER` point to a disposable local database; set `TEST_PG_PASSWORD` if needed. This local test uses an unencrypted localhost connection. GitHub Actions runs both suites with a disposable PostgreSQL service.


<!-- /coderabbit-ai-generated:v1 -->