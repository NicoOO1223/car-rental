# Car rental

An admin app for running a vehicle rental business: bookings, handovers with card or cash payment, security deposits, refunds, return charges, maintenance, customers, and an audit trail. Built to be sold to other rental operators, one stack per customer. The direction and status of each layer live in [docs/ROADMAP.md](docs/ROADMAP.md).

- **Backend:** FastAPI, SQLAlchemy, Alembic, Postgres 16.
- **Frontend:** Next.js (App Router), Tailwind v4.
- **Payments:** Stripe, with a signed webhook.
- **Hosting:** Azure Container Apps, deployed by GitHub Actions on every push to `main`.

## Run it locally

You need Docker, Python 3.12 or newer, and Node 20.

1. Start the database.

   ```
   docker compose up -d postgres
   ```

2. Configure the backend. Copy [backend/.env.example](backend/.env.example) to `backend/.env`, then set `SECRET_KEY` (the file shows how to generate one) and your Stripe **test** key. Everything except card payment works without Stripe.

3. Create the schema and demo data, then your own login.

   ```
   cd backend
   python -m venv .venv
   .venv/Scripts/activate          # macOS and Linux: source .venv/bin/activate
   pip install -r requirements-dev.txt
   alembic upgrade head
   python seed.py
   python create_staff_user.py you@example.com "a-password" --role admin
   uvicorn app.main:app --reload
   ```

   The API is now at http://127.0.0.1:8000, with interactive docs at `/docs`.

4. Run the frontend. Copy [frontend/.env.example](frontend/.env.example) to `frontend/.env.local`, then:

   ```
   cd frontend
   npm ci
   npm run dev
   ```

   Open http://localhost:3000 and sign in.

`docker compose up` also builds and runs the whole stack in containers, as a smoke test of the images.

### Stripe webhooks locally

Card payments are confirmed by a webhook as well as by the browser, so a closed tab does not lose a payment. To try it, install the Stripe CLI and run:

```
stripe listen --forward-to localhost:8000/api/stripe/webhook
```

Put the `whsec_...` secret it prints in `backend/.env` as `STRIPE_WEBHOOK_SECRET`. Without that variable the webhook route answers 503.

## Tests

```
cd backend
pytest
```

The suite never touches your dev database. It creates its own database named after yours with `_test` appended (for example `car_rental_test`), migrates it and seeds it on first use, and refuses to run against any database whose name does not end in `_test`. To start from a clean slate, set `RESET_TEST_DB=1`. To use a different server, set `TEST_DATABASE_URL`.

Frontend checks:

```
cd frontend
npm run lint
npm run typecheck
npm run build
```

## How the pieces fit

| Path | What is there |
|---|---|
| `backend/app/routers` | HTTP endpoints. Thin: parse the request, call a service. |
| `backend/app/services` | Business rules: pricing, availability, payments, refunds, audit. |
| `backend/app/models` | SQLAlchemy tables. Schema changes go through `backend/alembic`. |
| `backend/tests` | The test suite. Real database, real Stripe test mode when a key is set. |
| `frontend/app` | Pages. Most sit behind the login guard. |
| `frontend/components/ui` | Shared building blocks: `DataTable`, `Field`, `Toolbar`, `Pagination`. |
| `deploy` | Azure infrastructure (Bicep), the bootstrap script, backup docs. |
| `.github/workflows` | Deploy, daily backup with restore drill, weekly dependency audit. |

A few conventions worth knowing:

- Admin-editable business rules are called **Configuration**. The word **Settings** is reserved for a future per-user layer.
- Lists that can grow without bound (reservations, customers, the audit log) are paged and filtered on the server.
- Every state change that matters writes an audit entry in the same transaction.

## Setting up a new business

A fresh stack has no locations, no vehicles and no demo data (`seed.py` is for local development only, and refuses to run on a production stack). After creating the first admin login:

1. Open **Configuration, Business** and set the business name, legal details, VAT ID, timezone, format and logo. The name and logo appear on the sign-in page and in the sidebar, and the details are printed on rental agreements.
2. Open **Configuration, Locations** and add each place vehicles are based, with its timezone. Times for a booking are entered and shown in the timezone of the location they happen at.
3. Check **Extras** and the pricing pages. The extras a new stack starts with (additional driver, baby seat and so on) are only starting values from a migration; edit or retire them.
4. Set the VAT rate and whether your prices include VAT under **Business**. From then on every paid rental gets a numbered invoice (and a credit note if it is refunded), downloadable from the reservation page.
5. Have the agreement wording under **Business** reviewed by a lawyer. Until it is filled in, agreements print placeholder terms.

## Configuration reference

Backend, in `backend/.env` locally and as Container App settings when deployed:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Connection string the app runs with. |
| `MIGRATION_DATABASE_URL` | Optional. A login with schema rights, used only to run migrations, so `DATABASE_URL` can be a role that cannot change the schema. |
| `SECRET_KEY` | Signs login tokens. Required. |
| `STRIPE_SECRET_KEY` | Stripe API key. |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook calls. |
| `CORS_ORIGINS` | Comma-separated frontend origins allowed to call the API. |
| `ENVIRONMENT` | `production` turns off `/docs` and adds HSTS. The Docker image sets it. |
| `SENTRY_DSN` | Error tracking. Optional. |

Frontend values are baked in at build time, so a deployed build passes them as Docker build arguments: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`.

## Deploying

Pushing to `main` runs the tests, builds both images, deploys them to Azure, and then smoke-tests the live site. Pull requests run the tests only.

Creating a stack from nothing is [deploy/bootstrap.ps1](deploy/bootstrap.ps1). It needs the Azure CLI, Docker, and an `az login`. Useful parameters:

- `-BackendMinReplicas 1` keeps the backend always running, at a small monthly cost, so there are no cold starts.
- `-AlertEmail you@example.com` sets up monitoring alerts to that address.
- `-BackupPrincipalObjectId <id>` lets the backup workflow open its own database firewall rule.
- `-UseAppRole` switches the running app to the database role that cannot change the schema. See the script's closing notes for the one-time step that creates it.

Backups and the restore drill are described in [deploy/BACKUP_RESTORE.md](deploy/BACKUP_RESTORE.md).
