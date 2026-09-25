# Roadmap

Status as of 2026-09-25. Update this file whenever a layer ships or a decision changes. Until now the layer scheme lived only in planning sessions and commit messages, so treat this as the single record.

## Direction

The product is being built to sell to other rental operators.

- **Customer:** independent rental operators (B2B).
- **Hosting:** one separate stack per customer first. True multi-tenancy is deferred until real customers exist.
- **Email and SMS:** deferred by decision.
- **Storefront:** a public booking site for renters is in scope.

The earlier layers assumed an internal, staff-only, single-business tool. That assumption no longer holds for the storefront or for per-customer business identity.

## Layer status

Commit references are approximate: layers were grouped into a few large commits.

| Layer | Scope | Status |
|---|---|---|
| L1 | CI gate and error tracking | Shipped |
| L2 | Automated backups and restore drill | Shipped |
| L3 | Roles and audit trail | Shipped |
| L4 | Admin panel | Shipped |
| L5 | User management | Shipped |
| L6 | Configuration (admin-editable business rules) | Shipped, extended with return charges and security deposit |
| L7 | Identity and licence details | Shipped as manual entry |
| L8 | Data export and erasure | Shipped |
| L9 | Email and SMS | Deferred |
| L10 | Finance reporting | Partial: admin revenue page only, scope not audited |
| L11 | Visual redesign | Deferred |

## Next layers

Each layer gets its own planning pass that re-explores the code before any build starts.

**L12 Production hardening.** Needed on every route, and more urgent once a storefront exposes the API to anonymous users.
- Restrict the database firewall, use a least-privilege application role, run containers as non-root, and keep secrets in infrastructure code or Key Vault, including the signing key.
- Add login rate limiting and lockout, security headers, docs off in production, health probes and alerts, and at least one always-on backend replica for paying customers.
- Add Stripe webhooks with signature verification and idempotency keys.
- Add pagination, indexes and connection-pool settings, an isolated test database, and a staging environment.
- Add a root README.

**L13 Business profile and localization.**
- Extend Configuration with business name, logo, address, VAT id, timezone, locale and agreement terms text.
- Replace hardcoded Poland and Sardinia defaults, add VAT and invoice numbering, and move day boundaries from UTC to the business timezone.
- Remove the hardcoded brand name from the app, login page and agreement PDF.

**L14 Per-customer stack automation.**
- Parameterize the Bicep and bootstrap script by customer, with one shared registry and one image for all stacks.
- Move the frontend from build-time to runtime configuration so a single image serves every stack.
- Deploy through a manifest of stacks, with the operator's own demo stack as the canary, and run backups and restore drills per stack.
- Provision a stack with one command: infrastructure, migrations, first admin, customer Stripe keys and a smoke test.

**L15 Public storefront.**
- Add public routes outside the auth guard with an explicit allowlist, and unauthenticated availability, quote, booking and payment endpoints.
- Add rate limiting and bot protection. Unpaid online bookings must expire, because pending reservations block availability and spam could lock the fleet.
- Take payment at booking through webhooks, support guest checkout, capture consent and show a privacy notice, and apply operator branding from L13.
- Confirm on screen with a booking reference and a lookup page until email exists.
- Open questions: auto-confirm on payment versus staff confirmation, and whether the storefront is a route group in the existing app.

**L16 Legal pack.** Not code, and can start now. Terms of service, privacy policy, data-processing agreement, real rental agreement copy and storefront terms.

## Deferred

- Email and SMS (L9). Staff invites and password resets stay admin-driven, receipts and reminders do not exist, and the personal Settings layer stays blocked.
- True multi-tenancy, which becomes relevant after several customers exist.
- In-product billing for the SaaS itself. Invoice the first customers manually.
- The broader visual redesign (L11).

## Naming rule

Admin-editable business rules are called **Configuration**. The name **Settings** is reserved for a future user-facing layer covering personal preferences, notification preferences and self-service data deletion, which needs email delivery first.

## Definition of done for the first customer

- A fresh stack provisions from scratch in one command and passes a smoke test.
- A second stack with a different currency, timezone and branding runs correctly beside the first.
- Every stack restores from its own backup in the drill.
- The hardening checklist passes, including an external port scan of the database.
- A storefront booking completes end to end with a real Stripe test payment confirmed by webhook, including the abandoned-tab case.
- A booking that is never paid expires and frees the car.
