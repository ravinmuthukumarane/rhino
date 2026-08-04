# Production Deploy — Reference

Live at **https://rhino.sentinel.lk**. Server: `ems_admin@4.193.171.2`
(SSH key already configured locally). Repo: `ravinmuthukumarane/rhino` on
GitHub.

Images are built once from a temporary source checkout, then the checkout
is deleted. The server's permanent `~/rhino/` directory keeps only
`docker-compose.yml`, `nginx.conf`, `.env`, and Docker's own volumes
(Postgres data, Let's Encrypt certs) — no application source tree persists
there. See "Why no source tree on the server" at the bottom for the
reasoning.

## Quick reference: routine code change → live

This is the sequence for "I edited some files, now ship it." Run steps 1-2
locally, the rest over SSH.

**1. Commit and push.** Stage specific files (never `git add -A` — this repo
has a `script/` directory with unrelated files a collaborator edits
concurrently; blind `-A` will scoop those up).

```bash
git add <specific files>
git commit -m "..."
git push origin main
```

**2. Check repo visibility.** `git clone` on the server needs either a public
repo or the deploy key added. If you hit `Permission denied (publickey)` or
a 404, the repo is currently private — ask the user to make it public
temporarily (fastest) or add the deploy key at
`github.com/ravinmuthukumarane/rhino/settings/keys` (key is at
`~/.ssh/rhino_deploy_key.pub` on the server, already generated).

**3. Clone fresh and build.**

```bash
ssh ems_admin@4.193.171.2 "rm -rf ~/rhino-src && git clone --depth 1 https://github.com/ravinmuthukumarane/rhino.git ~/rhino-src && cp ~/rhino/.env ~/rhino-src/.env && cd ~/rhino-src && docker compose build backend frontend"
```

Swap `backend frontend` for just the service(s) that actually changed
(`postgres` too if `backend/src/db/*.sql` changed — see the migration note
below, a fresh Postgres image alone does **not** touch the live database).

**4. If `docker-compose.runtime.yml` or `frontend/nginx.conf` changed**, copy
the updated file(s) into the runtime directory:

```bash
scp docker-compose.runtime.yml ems_admin@4.193.171.2:~/rhino/docker-compose.yml
scp frontend/nginx.conf ems_admin@4.193.171.2:~/rhino/nginx.conf
```

**5. Recreate containers and verify.**

```bash
ssh ems_admin@4.193.171.2 "cd ~/rhino && docker compose up -d && sleep 3 && docker compose logs backend --tail 20"
```

Look for `[DB] Connected`, `[MQTT] Connected to broker`/`Subscribed`, no
stack traces. Then:

```bash
curl -s https://rhino.sentinel.lk/api/health
```

**6. Clean up the source clone** (containers/images are unaffected — they
live in Docker's store, not this directory):

```bash
ssh ems_admin@4.193.171.2 "rm -rf ~/rhino-src"
```

## Database migrations (schema changes to an already-running DB)

`schema.sql`/`timescale.sql`/`seed.sql` only run automatically when the
`postgres_data` volume is **empty** (fresh server). The production volume
already has real data, so a new column/table added to `schema.sql` needs to
be applied by hand with `ALTER TABLE`/`UPDATE` — rebuilding the postgres
image alone does nothing to existing data.

Pattern used throughout this project: write a small Node script using `pg`
(same package the backend already has installed), copy it into the running
`rhino-backend` container, run it there (it already has `DB_PASSWORD` as an
env var and can reach Postgres via the service name `postgres`), then
delete it:

```bash
# write your script to /tmp/migrate.js locally first, then:
scp /tmp/migrate.js ems_admin@4.193.171.2:~/migrate.js
ssh ems_admin@4.193.171.2 "docker cp ~/migrate.js rhino-backend:/app/migrate.js && \
  docker exec rhino-backend node migrate.js && \
  docker exec rhino-backend rm migrate.js && rm ~/migrate.js"
```

Inside the script, connect with:

```js
const { Pool } = require('pg');
const pool = new Pool({ host: 'postgres', port: 5432, database: 'rhino', user: 'rhinoadminuser', password: process.env.DB_PASSWORD });
```

Always wrap multi-statement migrations in `BEGIN`/`COMMIT`/`ROLLBACK` so a
failure partway through doesn't leave the schema half-migrated. Apply to the
dev database too if one is in use (`172.235.8.137`, reachable directly, no
SSH needed) to keep them in sync.

## Why no source tree on the server

This keeps a readable/editable git working tree off the server, but Docker
images are not a secrecy boundary — the backend image still contains the
compiled JS and the frontend image the built static bundle, since that's
what actually runs. Anyone with shell access could extract an image's
filesystem. The point is avoiding a stale, browsable source checkout and a
standing dependency on it continuing to exist — not hiding the code.

## First deploy on a brand-new server

```bash
ssh <user>@<new-server> "git clone https://github.com/ravinmuthukumarane/rhino.git ~/rhino-src && cd ~/rhino-src"
# copy a real .env into ~/rhino-src/.env (see .env.example for the required vars)
ssh <user>@<new-server> "cd ~/rhino-src && docker compose build"
ssh <user>@<new-server> "mkdir -p ~/rhino && cp ~/rhino-src/docker-compose.runtime.yml ~/rhino/docker-compose.yml && cp ~/rhino-src/frontend/nginx.conf ~/rhino/nginx.conf && cp ~/rhino-src/.env ~/rhino/.env && cd ~/rhino && docker compose up -d"
```

Verify with `docker compose ps` / `docker compose logs -f`, then
`rm -rf ~/rhino-src`. On first boot (empty `postgres_data` volume), Postgres
auto-runs `schema.sql` → `timescale.sql` → `seed.sql` — hypertables,
compression, and seed data all set up with no manual step.

## HTTPS (Let's Encrypt) — bootstrap sequence for a new domain

`nginx.conf` in the repo is the end state (redirects 80→443, serves TLS on
443). It references cert files that won't exist on a brand-new domain, so
deploying it directly crashes nginx. Bootstrap order:

1. Deploy a temporary HTTP-only `nginx.conf` — same as the repo version's
   port-80 server block, but serving the app directly (no redirect) plus the
   `/.well-known/acme-challenge/` location. Confirm `http://<domain>/` works.
2. Issue the cert against that running config:
   ```bash
   docker compose exec certbot certbot certonly --webroot -w /var/www/certbot \
     -d <domain> --email <contact-email> --agree-tos --no-eff-email --non-interactive
   ```
3. Deploy the real `nginx.conf` (from the repo) and `docker compose restart frontend`.
4. Update `FRONTEND_URL` in `.env` to `https://<domain>`, then `docker compose up -d`
   (recreates only the backend, to pick up the new env var).

Renewal is a systemd timer on the server (no cron available on this box):
`/etc/systemd/system/rhino-cert-renew.{service,timer}`, daily, runs
`certbot renew --webroot -w /var/www/certbot --quiet` then
`nginx -s reload` in the frontend container. Check with
`systemctl list-timers rhino-cert-renew.timer` and
`journalctl -u rhino-cert-renew.service`.

## Reference: what's actually running

- **Postgres**: TimescaleDB (`timescale/timescaledb:latest-pg16` base),
  bound to `127.0.0.1:5432` only (not internet-reachable).
- **Backend**: Node/Express, bound to `127.0.0.1:5000` only — all real
  traffic goes through nginx. Consumes MQTT from EMQX (`ENABLE_MQTT=true`,
  `MQTT_BROKER_URL=mqtt://host.docker.internal:1883`, reaching the EMQX
  container that runs directly on the host, outside this compose project).
- **Frontend**: nginx serving the built static bundle + reverse-proxying
  `/api` and `/socket.io` to the backend. Ports 80/443 are the only ones
  actually exposed to the internet.
- **EMQX** (MQTT broker): a separate `docker run` container on the host,
  not part of this compose project. Ports 1883 (MQTT) and 18083 (dashboard)
  are open in `ufw`.
