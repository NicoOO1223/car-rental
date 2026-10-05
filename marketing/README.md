# Marketing site

The public landing page for the rental software: home, request-a-demo form, privacy and terms. Next.js 16, Tailwind v4, mostly prerendered; the only server code is the demo-request route. **English only for now**; Italian and Polish are a catalogue file each once a native speaker has read them.

It is a draft on purpose: the brand, prices, contact details and legal pages are placeholders, and **the site is never indexable while they are**. `npm run check:launch` lists exactly what is still missing.

## Run it

```
cd marketing
npm ci
npm run dev          # http://localhost:3000 (stop the staff panel first, or use -p 3030)
npm run build && npm start
```

| Script | What it does |
|---|---|
| `npm test` | Unit tests: the form's whole decision flow, the claims the page may make, SEO output, CSP, screenshots, the deploy files |
| `npm run smoke` | The built site in a real browser, desktop and phone: navigation, the form (also by keyboard), bot defences, headers, axe accessibility |
| `npm run lighthouse` | Lighthouse on a phone and a desktop profile; every category must be at least 90 |
| `npm run check:launch` | Fails until the brand, contact, legal details, prices and unconfirmed copy are settled |
| `npm run screens` | Rebuilds the fictional demo business and recaptures every screenshot (needs Docker; see below) |

## Where things live

| Path | What |
|---|---|
| `content/brand.ts` | The one place the name, contact and legal details live. A rename is an edit here (and the accent colour in `app/globals.css`) |
| `content/plans.ts` | Plans and prices. Prices stay `null` ("Ask for a quote") until `PRICES_CONFIRMED` |
| `content/claims.ts` | What the page must never say (not shipped yet); `tests/claims.test.ts` scans the copy |
| `content/launch.ts` | Copy still waiting for the owner or a lawyer, and the enabled languages |
| `messages/en.json` | All the copy |
| `lib/demoRequest.ts` | The demo form's decisions, with every outside thing injected so it is testable |
| `scripts/` | Screenshots, the demo stack, smoke test, Lighthouse |

## The demo form

`POST /api/demo` is the only write path. It sends two emails (to the owner, then an acknowledgement to the visitor) and **stores nothing**. In order: content type and size, `Origin`, a rate limit (5 per 10 minutes and 20 per day per address), a honeypot, a signed form-open time (a post within three seconds is dropped silently), validation with an email-header-injection guard, then Cloudflare Turnstile. A failing owner email tells the visitor to write instead; a failing acknowledgement does not. Without a Turnstile secret, or without a mail service, a production build refuses to send rather than run open.

Settings are read when a request arrives; see "The marketing site" in `deploy/PROVISIONING.md` for the list.

## Screenshots and the demo business

Every screenshot is of a **fictional** business, "Isola Rent", built by `backend/seed_marketing_demo.py` on an isolated stack (`scripts/demo-stack.ps1`: its own database and ports 8010, 3010 and 3012; it never touches the dev stack). The vehicles are our own illustrations (`scripts/make-demo-assets.mjs`), so there is no photo licence to track. Before any image is saved, `capture-screens.mjs` checks the page text: every email must be `@example.com`, no real-looking plate or phone, and nothing from `scripts/real-values.local.txt`, **your own gitignored deny-list** (one real surname, email, phone or plate per line). Review every shot yourself before the site goes public.

The checkout shot saves a return condition, so it needs a fresh seed: `npm run screens` reseeds first.

## Before it goes public

1. Choose the name and domain, and put them in `content/brand.ts` (`placeholder: false`).
2. Fill the contact email and the legal entity, address, VAT number and country.
3. Have the lawyer approve the privacy and terms pages (`legalReviewed: true`).
4. Decide the prices in `content/plans.ts` and set `PRICES_CONFIRMED`.
5. Confirm the copy listed in `content/launch.ts` (setup time, cancellation, data at the end of a contract, the reply-time promise) and empty that list.
6. Italian and Polish: native review, then add the catalogs and the language to `ENABLED_LANGUAGES`.
7. Create the Turnstile widget and the mail domain; run `deploy/provision-marketing.ps1`.
8. Watch the CSP reports for a clean week, then `-EnforceCsp`.
9. Set `SITE_URL` and `SITE_INDEXABLE=true` for the build; `npm run check:launch` must pass (the workflow runs it).
