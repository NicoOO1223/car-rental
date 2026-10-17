FROM python:3.14-slim

WORKDIR /app

# System deps for psycopg (libpq) — psycopg-binary ships its own libpq, but
# keeping this here documents the dependency and covers the fallback wheel.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY alembic/ alembic/
COPY alembic.ini .
COPY docker-entrypoint.sh .
# Not used by the running server — only kept so `az containerapp exec`
# can seed demo data or create a staff login on a deployed instance.
COPY seed.py .
COPY create_staff_user.py .
COPY setup_business.py .
COPY create_app_role.py .
COPY check_reservation_overlaps.py .
RUN chmod +x docker-entrypoint.sh

# Run as an unprivileged user so a compromised process cannot modify the
# image filesystem or reach root-only resources.
RUN useradd --system --uid 10001 --no-create-home appuser \
    && chown -R appuser /app
USER appuser

ENV ENVIRONMENT=production

EXPOSE 8000

# Liveness only. The readiness check (/ready) is configured on the Container
# App probes, since it needs the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"

ENTRYPOINT ["./docker-entrypoint.sh"]
