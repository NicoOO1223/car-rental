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

# "production" turns off the interactive API docs and adds HSTS. Anything
# else (including unset) behaves like local development.
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"
