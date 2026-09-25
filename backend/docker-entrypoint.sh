#!/bin/sh
set -e

# Migrations need DDL rights; the running app should not have them. When a
# separate migrator role is configured, use it for alembic only and leave
# DATABASE_URL (the DML-only app role) for the server.
echo "Running database migrations..."
if [ -n "$MIGRATION_DATABASE_URL" ]; then
    DATABASE_URL="$MIGRATION_DATABASE_URL" alembic upgrade head
else
    alembic upgrade head
fi

# The Azure ingress terminates TLS and forwards the real client address in
# X-Forwarded-For; without these flags every request looks like it comes
# from the proxy, which would break per-IP login throttling.
echo "Starting server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 \
    --proxy-headers --forwarded-allow-ips="*"
