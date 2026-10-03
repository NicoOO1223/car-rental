import os

from dotenv import load_dotenv

load_dotenv()

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")

# Signing secret of the Stripe webhook endpoint (Dashboard > Developers >
# Webhooks, "whsec_..."). Without it the webhook route refuses every request
# rather than processing unverified payloads.
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")

# Signs staff login JWTs (see app/services/auth.py). Required, like
# DATABASE_URL — an insecure default here would be worse than failing
# loudly, since this is what actually gates access to the whole app.
SECRET_KEY = os.getenv("SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is not set")

# Shared with the two web apps' servers, which sit between the browser and this
# API. When set, a request carrying it may name the visitor's real address
# (X-Visitor-IP), so the per-address limits count the visitor and not the web
# app's server. Unset, nothing is trusted and the platform's address is used.
TRUSTED_PROXY_SECRET = os.getenv("TRUSTED_PROXY_SECRET") or None

# "production" turns off the interactive API docs and adds HSTS. Anything
# else (including unset) behaves like local development.
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"
