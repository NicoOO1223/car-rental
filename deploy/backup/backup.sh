#!/usr/bin/env bash
# Dumps the production Postgres database and uploads it to the backup
# storage account (see deploy/main.bicep's backupStorage resource and
# deploy/BACKUP_RESTORE.md). Runs from .github/workflows/db-backup.yml on a
# schedule, but is also safe to run by hand if you're `az login`'d with
# rights to POSTGRES_HOST and the backup storage account.
set -euo pipefail

: "${POSTGRES_HOST:?}"
: "${POSTGRES_ADMIN_USER:?}"
: "${POSTGRES_ADMIN_PASSWORD:?}"
: "${POSTGRES_DB_NAME:?}"
: "${BACKUP_STORAGE_ACCOUNT:?}"
: "${BACKUP_CONTAINER_NAME:?}"

# The Ubuntu runner image doesn't ship a client matching the server's major
# version (16), and pg_dump/pg_restore need to match or exceed the server's
# version — install the pinned PGDG package rather than trusting whatever
# `apt-get install postgresql-client` happens to resolve to.
if ! command -v pg_dump >/dev/null || [[ "$(pg_dump --version)" != *") 16."* ]]; then
    sudo apt-get update -y
    sudo apt-get install -y wget gnupg lsb-release
    wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
    sudo apt-get update -y
    sudo apt-get install -y postgresql-client-16
fi

# pg_dump/pg_restore speak libpq URIs, not the app's SQLAlchemy dialect
# form (postgresql+psycopg://...) — build a bare postgresql:// URI instead.
DB_URI="postgresql://${POSTGRES_ADMIN_USER}:${POSTGRES_ADMIN_PASSWORD}@${POSTGRES_HOST}:5432/${POSTGRES_DB_NAME}?sslmode=require"

DUMP_FILE="car-rental-$(date -u +%Y%m%d-%H%M%S).dump"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Dumping ${POSTGRES_DB_NAME} from ${POSTGRES_HOST}..."
pg_dump -Fc --no-owner --no-privileges -d "$DB_URI" -f "$WORKDIR/$DUMP_FILE"

echo "Uploading $DUMP_FILE to $BACKUP_STORAGE_ACCOUNT/$BACKUP_CONTAINER_NAME..."
az storage blob upload \
    --auth-mode login \
    --account-name "$BACKUP_STORAGE_ACCOUNT" \
    --container-name "$BACKUP_CONTAINER_NAME" \
    --file "$WORKDIR/$DUMP_FILE" \
    --name "$DUMP_FILE"

echo "Backup complete: $DUMP_FILE"
