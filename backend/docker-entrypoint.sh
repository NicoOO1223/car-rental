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

# First-run setup of a new stack (its first administrator and business
# profile), from values the provisioning script sets. Does nothing unless
# they are set, and nothing once the stack has an administrator. A failure
# is reported but does not stop the server: the stack is still usable, and
# the log line says what to fix.
python setup_business.py || echo "WARNING: stack setup failed, see above"

# The Azure ingress terminates TLS and forwards the real client address in
# X-Forwarded-For; without these flags every request looks like it comes
# from the proxy, which would break per-IP login throttling.
echo "Starting server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 \
    --proxy-headers --forwarded-allow-ips="*"
