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
- `business` is applied once, to a stack with no administrator: name, legal details, currency, timezone, locale (`it`, `en-GB` and so on), default and document language, VAT rate and whether prices include VAT. Each value is checked with the same rules as the admin screen, so a typo fails the test suite before anything is deployed.
- `storefront` (optional): `{ "enabled": true, "minReplicas": 1 }` adds the public booking site. Without it the stack has no storefront app or sweeper job and releases skip them. One minimum replica is recommended for a customer stack so the site never starts cold; the demo stack uses 0.
- `legacySecrets` marks a stack that existed before manifests; its secrets are read from the old `deploy/.<name>` files and its live Stripe and database settings are never overwritten by a re-run.

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

## Removing a stack

`.\deploy\deprovision.ps1 -Stack acme` deletes the resource group (its database and backups), the GitHub Environment and the CI credentials, after you type the stack's name. It refuses the canary and never touches the shared registry.

## Not done yet

- A second real stack has not been provisioned. Doing so, with a different currency, timezone and branding, and restoring it from its own backup, is the remaining proof for the definition of done.
- Stacks use the default `azurecontainerapps.io` address. Custom domains are not automated.
- The database still admits Azure services broadly. A private network is a separate change.
