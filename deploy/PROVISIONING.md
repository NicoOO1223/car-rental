# Provisioning and releasing stacks

Every customer gets their own stack: a resource group holding a database, backup storage, a Container Apps environment and its apps: the backend, the staff frontend and, if the manifest asks for it, the public storefront with a scheduled job (`car-rental-sweeper`) that expires unpaid online bookings. Stacks share one container registry and one image build, so a release is built once and rolled out stack by stack.

| Thing | Where |
|---|---|
| One stack's description (no secrets) | `deploy/stacks/<slug>.json` |
| The shared registry and the CI app id | `deploy/shared.json`, `deploy/shared.bicep` |
| One stack's infrastructure | `deploy/main.bicep` |
| Create or update a stack | `deploy/provision.ps1` |
| Remove a stack | `deploy/deprovision.ps1` |
| What proves a stack is serving | `deploy/smoke-test.sh` |
| The release | `.github/workflows/deploy.yml` and the `.github/actions/deploy-stack` action |

## The manifest

`deploy/stacks/example.json.template` shows every field. Copy it to `deploy/stacks/<slug>.json`.

- `slug` matches the file name and names the GitHub Environment (`stack-<slug>`).
- `canary` is true for exactly one stack, the operator's own. Every release reaches it first. A test fails if there is not exactly one.
- `business` is applied once, to a stack with no administrator: name, legal details, currency, timezone, locale (`it`, `en-GB` and so on), default and document language, VAT rate and whether prices include VAT, and `bookingFlow` (`APPROVAL`, the default for a new stack: every booking is a request staff approve, then an advance is paid if one is due; or `INSTANT`: the renter pays at once on the booking site and the booking confirms itself). Each value is checked with the same rules as the admin screen, so a typo fails the test suite before anything is deployed.
- `storefront` (optional): `{ "enabled": true, "minReplicas": 1 }` adds the public booking site. Without it the stack has no storefront app or sweeper job and releases skip them. One minimum replica is recommended for a customer stack so the site never starts cold; the demo stack uses 0.
- `email` (optional): `{ "domain": "yourcompany.com", "fromUsername": "bookings", "fromName": "Your Company" }` turns on email to renters, sent from `bookings@yourcompany.com` through Azure Communication Services. See "Email" below. `fromUsername` defaults to `bookings` and `fromName` to the business name.
- `legacySecrets` marks a stack that existed before manifests; its secrets are read from the old `deploy/.<name>` files and its live Stripe and database settings are never overwritten by a re-run.
- `sharedEnvironmentStack` (optional, e.g. `"demo"`): joins that other stack's Container Apps environment instead of creating this stack's own. **Not the normal case** — every stack is meant to get its own environment. This exists because an Azure subscription can be capped at one Container Apps environment (in total, or one per region), which a free-trial subscription hits immediately; use it only as a stopgap until that quota is lifted (ask Azure support to raise "Container Apps environments per subscription/region", or move to a paid tier). The database, backups and every other resource stay entirely this stack's own either way — only the compute environment is shared, so this stack's app names get a `car-rental-<slug>-` prefix instead of the usual `car-rental-`, since Container Apps requires ingress names to be unique across everything sharing one environment, not just within one resource group.

## Creating a stack

Prerequisites: `az login`, the `containerapp` extension, `gh auth login`, Docker running, Git Bash.

```
.\deploy\provision.ps1 -Stack acme -AdminEmail owner@acme.example `
    -StripeSecretKey sk_live_... -StripePublishableKey pk_live_... `
    -TurnstileSiteKey 0x4AAA... -TurnstileSecretKey 0x4BBB...
```

Add `-DryRun` first to see every step without changing anything. The script is idempotent: run it again after editing the manifest or the code and it changes only what differs.

What it does:
1. Creates the shared registry (once) and the stack's resource group, database, backup storage and environment.
2. Generates the stack's secrets once, keeps them in `deploy/.stacks/<slug>/` (gitignored) and in the stack's Container App secrets. Nothing secret goes in the repo.
3. Builds the images locally, pushes them to the shared registry and creates the apps (and the sweeper job). They pull with their own managed identity. The storefront image is built from the repository root because it imports the `shared/` folder.
4. Registers the Stripe webhook with the customer's own key and stores its signing secret.
5. Creates the GitHub Environment `stack-<slug>` with its variables and secrets, the CI login for it, and the three Azure roles CI needs on that stack only (update its apps, push to the registry, write its backups).
6. Creates the first administrator and applies the business profile, then removes the one-time password from the app. The login is printed once at the end.
7. Creates the least-privilege database role and switches the app to it.
8. Runs the smoke test.

Without Stripe keys, card payment stays off (cash still works) until the script is run again with them. Without Turnstile keys the public storefront cannot take bookings on a production stack (the backend refuses rather than run without a bot check); create a Turnstile widget in Cloudflare for the storefront address and pass its two keys. The storefront is off for visitors until an admin turns it on in Configuration, Online booking.

## Releasing

Pushing to `main` runs the tests (backend, staff frontend, storefront, browser flow), builds the three images once (tagged with the commit), deploys to the canary, smoke-tests it, then deploys to the other stacks one at a time, each smoke-tested, stopping at the first failure. A migration runs when a backend starts, so a bad one is caught on the canary before any customer sees it.

Each stack deploys through its own GitHub Environment, so it uses that stack's credentials and settings. The frontend's address, Stripe key and error-tracking address are set on the app on every deploy from that environment's variables. Adding a manifest does not deploy anything by itself; provisioning is a deliberate command.

`db-backup.yml` backs up and restore-drills every stack the same way, each inside its own environment.

## Email

Renters get a booking confirmation, a cancellation notice and a receipt with the invoice attached, from the business's own domain. Nothing is sent until the domain is verified, and the stack works the same without it.

1. Put the `email` block in the stack's manifest and run `.\deploy\provision.ps1 -Stack <slug>`. It creates the email service and the domain in Azure and prints the DNS records (a verification record, SPF and two DKIM records).
2. Whoever manages the domain's DNS adds those records. Verification can take from a few minutes to a day.
3. Run `provision.ps1` again. It asks Azure to verify the records, waits up to three minutes, and once they are verified links the domain, stores the connection string as the backend's `email-connection-string` secret, and sets `EMAIL_FROM_ADDRESS`. If the records are not verified yet it says so and leaves email off; run it again later.

How it behaves: an email is queued in the same transaction as the booking or payment it is about, so it exists if and only if that happened, and a background sender inside the backend sends it. A failed send is retried at growing intervals (1 minute, 5, 30, 2 hours, 6) and given up on after six tries; given-up messages stay in the `email_messages` table with the error. Several backend replicas can run at once without sending anything twice. A stack with the backend scaled to zero sends when it next wakes up, so customer stacks should keep a minimum of one replica.

Each renter's emails are written in their own language: the one they used on the website, or the one staff chose when making the booking, falling back to the business default language (Configuration > Business). Links in emails (view or manage a booking, the privacy page) point to the storefront; `provision.ps1` sets `STOREFRONT_URL` on the backend for that, and a stack without a storefront simply has no such links. The Italian and Polish wording is a draft that a native speaker should read.

The sixteen emails (pinned by `backend/tests/test_email_catalogue.py`) are: to renters, request received (a booking was asked for and staff will answer), payment requested (staff approved it and the advance has to be paid by a deadline, with the link), payment window ended (the advance was not paid in time), booking confirmed, changed (held five minutes and merged), cancelled, receipt, pickup reminder (every five minutes the backend queues those that are due; one replica does it, guarded by a database lock), agreement copy, return summary and refund notice; to the business, new online booking, online cancellation and needs attention (to the alert recipients set in Configuration > Email); and for storefront accounts, confirm your email and reset your password. The two account emails cannot be switched off, and their links need `STOREFRONT_URL`: without it they are not sent, and nobody could confirm an address. Their links carry the token after a `#`, so it never reaches a server log; the token is also in the queued message text, as with any email body.

**Day to day it is run from the app, not from here.** Once the domain is verified, an administrator uses Configuration > Email to:
- see whether sending works (sender, sent, waiting, failed), pause and resume it, choose where replies go, and send a connection test;
- switch each email on or off, and reword it in each language: a subject and a body written as normal text, with values to click in and a preview, plus a real test send of that one email to themselves;
- reword the reusable parts (what was paid online, the cancellation policy, what to bring, the link to manage the booking, the sign-off), which also take their line out of an email when they have nothing to say;
- look at recent emails and send a failed one again.

Only the one-off step above (creating and verifying the sending domain and storing the connection) stays in provisioning, because it needs Azure rights the application does not have.

## The marketing site

The public landing page (`marketing/`) is **not a customer stack**: no manifest, no canary, no database, no customer data. It is one Container App in its own resource group, `marketing-rg`, so removing a customer stack can never touch it.

| Thing | Where |
|---|---|
| Its settings (no secrets) | `deploy/marketing.json` |
| Its infrastructure | `deploy/marketing.bicep` (the app and a pull identity) and `deploy/marketing-acrpull.bicep` (the registry role) |
| Create or update it | `deploy/provision-marketing.ps1` |
| Its release | `.github/workflows/marketing.yml` (separate from `deploy.yml`) |

```
.\deploy\provision-marketing.ps1 -DryRun                    # every step, nothing changed
.\deploy\provision-marketing.ps1 -Staging                   # a noindex site with the placeholders
.\deploy\provision-marketing.ps1 -TurnstileSiteKey 0x4AAA... -TurnstileSecretKey 0x4BBB...
```

What it does: creates the resource group; deploys the pull identity and lets it pull from the shared registry (phase 1, then waits a minute for the role); sets up email when `marketing.json` names a mail domain (the same two-pass DNS flow as a customer stack, with `email.bicep`); builds and pushes the image; deploys the app (phase 2) into the **canary stack's Container Apps environment**, because a subscription can be capped at one; adds a custom domain with a managed certificate once `siteDomain` is set (it prints the CNAME and `asuid` TXT records first); creates the GitHub Environment `marketing` with its OIDC login and just two roles (update this app, push to the registry); and smoke-tests the live site.

It refuses a real deployment while `marketing.json` holds placeholders (`notifyAddress` on `example.com`, no `siteDomain`); `-Staging` deploys anyway, and the site is **never indexable while the brand in `marketing/content/brand.ts` is a placeholder**, whatever the configuration says.

Settings the app reads: `FORM_SECRET` (generated once, kept in `deploy/.marketing/` and as an app secret), `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (without the secret the form **refuses** to send in production rather than run open), `ACS_CONNECTION_STRING` and `MAIL_FROM_ADDRESS` (without them the form tells the visitor to write instead), `DEMO_NOTIFY_ADDRESS`, `SITE_URL` and `SITE_INDEXABLE` (baked into the pages when the image is built), and `CSP_ENFORCE` (`-EnforceCsp`; report-only until a clean week of `csp-violation` log lines, found with `ContainerAppConsoleLogs_CL | where Log_s startswith "csp-violation"`). Two switches exist for the automated browser tests only, `ALLOW_NO_TURNSTILE` and `ALLOW_FILE_MAILER`; a test fails if either appears in anything that deploys.

Cost: the app scales to zero (`minReplicas: 0`; about 0 to 2 USD a month, a visitor may wait a second or two after a quiet spell). Keep one replica warm (about 6 USD a month) if the form must answer instantly. At most two replicas run, because the form's rate limit is per replica.

## Removing a stack

`.\deploy\deprovision.ps1 -Stack acme` deletes the resource group (its database and backups), the GitHub Environment and the CI credentials, after you type the stack's name. It refuses the canary and never touches the shared registry.

## Not done yet

- A second real stack has not been provisioned. Doing so, with a different currency, timezone and branding, and restoring it from its own backup, is the remaining proof for the definition of done.
- Stacks use the default `azurecontainerapps.io` address. Custom domains are not automated for customer stacks (the marketing site's is, in `provision-marketing.ps1`).
- The database still admits Azure services broadly. A private network is a separate change.
- The storefront does not yet pass the visitor's address to the API the way the staff app does (`TRUSTED_PROXY_SECRET` is provisioned for the backend and the staff app only), so its per-address limits still see the storefront server's address.
