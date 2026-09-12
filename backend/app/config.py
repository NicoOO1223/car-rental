import os

from dotenv import load_dotenv

load_dotenv()

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")

# Signs staff login JWTs (see app/services/auth.py). Required, like
# DATABASE_URL — an insecure default here would be worse than failing
# loudly, since this is what actually gates access to the whole app.
SECRET_KEY = os.getenv("SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is not set")
