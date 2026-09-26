# Database backup & restore

## What's automated

`.github/workflows/db-backup.yml` runs daily (03:17 UTC) and does two things:

1. **`backup` job** — runs `deploy/backup/backup.sh`, which `pg_dump`s the production database and uploads it (`.dump`, `pg_restore`-compatible custom format) to the `pg-backups` container in the `backupStorage` account defined in `deploy/main.bicep`. A lifecycle policy on that container tiers backups to Cool after 7 days and deletes them after 35 days, so ~35 daily backups exist at any time — well beyond Postgres Flexible Server's own 35-day PITR window (`deploy/main.bicep`'s `backup.backupRetentionDays`), and stored independently of the server itself.
2. **`restore-drill` job** (runs right after) — downloads whichever backup is currently newest in storage and restores it into a disposable `postgres:16` container that lives only for the duration of the GitHub Actions job, then runs `alembic upgrade head`, `deploy/backup/verify_restore.py` (checks every expected table exists and has data), and the full backend `pytest` suite against it. This never touches production — it's proof that what's actually sitting in blob storage right now is restorable, not just that the backup step exited 0.

Both jobs can also be triggered manually (`workflow_dispatch`) from the Actions tab.

## Setup

Since stacks are provisioned from manifests, `deploy/provision.ps1` does everything below for you: it creates the GitHub Environment `stack-<slug>` with these variables and the password secret, and grants the CI login its roles. The steps are kept here so you can see what was set up and do it by hand if you have to.

Per stack:

1. Grant the GitHub OIDC identity write access to the backup storage account (this can't be expressed in bicep because the identity is the GitHub Actions federated service principal, which isn't itself a bicep-managed resource):
   ```
   az role assignment create --assignee <AZURE_CLIENT_ID's objectId> \
     --role "Storage Blob Data Contributor" --scope <backup storage account resource ID>
   ```
   This is why `backup.sh` and the drill use `az storage blob upload/download/list --auth-mode login` rather than a storage account key — no long-lived credential needed, consistent with how `deploy-backend`/`deploy-frontend` already authenticate.
2. These are set on the stack's GitHub Environment (not on the repository):
   - **Variables**: `POSTGRES_HOST` (the Flexible Server FQDN, from `deploy/outputs.json` → `postgresServerFqdn`), `POSTGRES_ADMIN_USER` (`carrentaladmin`), `POSTGRES_DB_NAME` (`car_rental`), `BACKUP_STORAGE_ACCOUNT` (from `outputs.json` → `backupStorageAccountName`), `BACKUP_CONTAINER_NAME` (`pg-backups`).
   - **Secret**: `POSTGRES_ADMIN_PASSWORD` — the same value already cached at `deploy/.pgpassword`.

## How the backup job reaches the database

The database does **not** accept connections from the internet. `deploy/main.bicep` has one firewall rule, `AllowAllAzureServices` (`0.0.0.0`), which is what lets the Container Apps in. GitHub-hosted runners are not an Azure service, so the `backup` job opens a rule for its own public IP right before `pg_dump` and deletes it in an `if: always()` step afterwards. The rule is named `gha-backup-<run id>`, so a leftover from a killed run is easy to spot with `az postgres flexible-server firewall-rule list`.

This needs two things, both one-time:

1. The GitHub OIDC identity may create and delete firewall rules on this one server and nothing else. `deploy/main.bicep` defines a custom role for that; `provision.ps1` passes the CI identity's object ID to `main.bicep`, which assigns it (or set `backupPrincipalObjectId` when deploying the Bicep file directly).
2. The environment variable `RESOURCE_GROUP` so the job knows where the server lives.

`AllowAllAzureServices` still admits resources belonging to other Azure customers, so the password and SSL remain a real boundary. Closing that fully means a VNet with a private endpoint and moving the backup job inside it, which is a larger change that has not been made.

## Restoring in a real emergency (against production — not the drill)

The drill above never touches production on purpose. If you actually need to restore production data:

1. Pick the backup to restore from: `az storage blob list --auth-mode login --account-name <BACKUP_STORAGE_ACCOUNT> --container-name pg-backups --output table` (sorted by name, which is timestamp-prefixed).
2. Download it: `az storage blob download --auth-mode login --account-name <BACKUP_STORAGE_ACCOUNT> --container-name pg-backups --name <blob> --file restore.dump`.
3. **Restore into a fresh scratch database on the real server first — do not restore over the live `car_rental` database directly.** Create one (`az postgres flexible-server db create --server-name <postgresServerFqdn's server name> --resource-group car-rental-rg --database-name car_rental_restore_check`), then `pg_restore --no-owner --no-privileges -d "postgresql://carrentaladmin:<password>@<host>:5432/car_rental_restore_check?sslmode=require" restore.dump`.
4. Run `alembic upgrade head` against that scratch database (`DATABASE_URL` pointed at it) to confirm it's compatible with the currently-deployed backend before doing anything else.
5. Only once that's verified, decide how to cut over (e.g. rename databases, or point the backend's `DATABASE_URL` Container App secret at the verified restore) — this is a judgment call specific to the incident, not something to script blindly.

Note: restoring from an operator's own machine (rather than from a GitHub Actions job) means your own IP isn't covered by the firewall rule — you'll need a temporary firewall rule for your IP (`az postgres flexible-server firewall-rule create`), which you should remove again afterward.

## Changing the retention numbers

- Blob backup retention: `deploy/main.bicep`'s `backupLifecyclePolicy` resource (`tierToCool`/`delete` `daysAfterModificationGreaterThan`).
- Postgres native PITR: `deploy/main.bicep`'s `postgres` resource, `properties.backup.backupRetentionDays` (max 35 on Flexible Server).
