# Production Deploy

Images are built once from a temporary source checkout, then the source is
deleted. The server keeps only `docker-compose.runtime.yml`, `.env`, and the
named Docker volume for Postgres data — no application source tree.

## First deploy / rebuilding after code changes

Run these from a throwaway clone (`~/rhino-src` on the server), NOT the
runtime directory:

```bash
git clone git@github.com:ravinmuthukumarane/rhino.git ~/rhino-src
cd ~/rhino-src
cp /path/to/.env .env            # same secrets as the runtime directory
docker compose build             # builds rhino-postgres, rhino-backend, rhino-frontend
```

Copy the runtime files into the permanent ops directory (only needed once —
after the first deploy these files rarely change):

```bash
mkdir -p ~/rhino
cp ~/rhino-src/docker-compose.runtime.yml ~/rhino/docker-compose.yml
cp ~/rhino-src/.env ~/rhino/.env
cd ~/rhino
docker compose up -d
```

Verify containers are healthy (`docker compose ps`, `docker compose logs -f`),
then it's safe to delete the throwaway clone:

```bash
rm -rf ~/rhino-src
```

The running containers and images are unaffected — they live in Docker's
image/container store, not in that directory.

## Updating after future code changes

Repeat the same steps: fresh clone → `docker compose build` → copy the new
`docker-compose.runtime.yml` (if it changed) into `~/rhino` → from `~/rhino`,
`docker compose up -d` (picks up newly built `:latest` images) → delete the
clone again.

## Caveat

This keeps a readable git working tree off the server, but Docker images are
not a secrecy boundary — the backend image still contains the compiled JS and
the frontend image the built static bundle, since that's what actually runs.
Anyone with shell access to the server could extract an image's filesystem.
This setup avoids a browsable/editable source tree and a stale dependency on
it continuing to exist; it doesn't cryptographically hide the code.

## First-boot-only Postgres init

`backend/src/db/schema.sql`, `timescale.sql`, and `seed.sql` are baked into
the `rhino-postgres` image at build time (see `backend/src/db/Dockerfile`) and
run automatically only when the `postgres_data` volume is empty (first boot).
To re-run them against a fresh database, remove the volume:
`docker compose down -v` (this deletes all data — confirm before running).
