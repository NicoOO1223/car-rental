FROM python:3.12-slim

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
# can seed demo data into a fresh deployment on demand.
COPY seed.py .
RUN chmod +x docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
