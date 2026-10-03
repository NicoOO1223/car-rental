# Content-Security-Policy: reading the reports and switching to enforcing

Both web apps (the staff app and the storefront) send a Content-Security-Policy.
It starts **report-only**: the browser blocks nothing, but reports what it would
have blocked to `/api/csp-report` on the same app, which writes one line per
violation to the container log. A stack is switched to **enforcing** with one
setting, once its reports have been clean.

## Reading the reports

In Log Analytics (the stack's workspace):

```kusto
ContainerAppConsoleLogs_CL
| where Log_s startswith "csp-violation"
| extend report = parse_json(substring(Log_s, strlen("csp-violation ")))
| summarize count() by tostring(report["violated-directive"]), tostring(report["blocked-uri"])
| order by count_ desc
```

Each line has `document-uri`, `blocked-uri`, `violated-directive`, `source-file` and
`line-number` where the browser gave them. Query strings and fragments are
removed before logging. At most 60 reports per minute per instance are logged, so
a broken page cannot flood the log.

## What counts as clean

Use the stack for a normal working week (sign in, book, hand over, return, take a
card payment, edit settings, and on the storefront a full booking with a test
card), then look at the query above.

- **Browser extensions** show up as `blocked-uri` values like `chrome-extension`,
  `moz-extension` or `safari-extension`, or `inline`/`eval` from a script you do not
  recognise. They are not the app and can be ignored.
- **Anything from the app's own pages, Stripe, Cloudflare Turnstile or Sentry** is
  real: fix the policy (`frontend/lib/csp.ts`, `shared/csp.ts`) or the page before
  enforcing.

## Switching a stack to enforcing

Set `CSP_ENFORCE=true` on the app, for example:

```powershell
az containerapp update --name <frontend app> --resource-group <rg> --set-env-vars CSP_ENFORCE=true
```

It is read on every request, so it applies at once without a new image. To switch
back, set it to `false` (or anything else). `provision.ps1` only sets the
variables it knows about, so it does not undo this.

## What the policy still allows

`script-src` includes `'unsafe-inline'` because the App Router inlines its
bootstrap scripts; removing it needs per-request nonces and is a separate change.
Enforcing today still blocks injected `<script src>` from other hosts, `eval` in
production, framing of the app, and form posts to other sites. The staff app's
`connect-src` no longer includes the API at all, because its browser talks only to
its own server.
