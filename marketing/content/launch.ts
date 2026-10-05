// What must be settled before the site may go public. tests/launch.test.ts
// reads this (only when LAUNCH_GATE=1, i.e. `npm run check:launch`).

/**
 * Message keys whose wording the owner or a lawyer must confirm. Remove a key
 * from this list only after it has been confirmed.
 */
export const UNCONFIRMED_COPY: readonly string[] = [
  "demo.sub", // the reply-time promise
  "faq.a2", // setup time
  "faq.a5", // what happens to data at the end of the contract
  "faq.a7", // cancellation terms
  "pricing.setup", // what the setup fee covers
  "thanks.sub", // the reply-time promise on the thank-you page
  "thanks.subGeneric",
  "email.reply.body", // the acknowledgement email promises a reply within one working day
];

/** Languages shown on the site. Add "it" / "pl" only after native review. */
export const ENABLED_LANGUAGES = ["en"] as const;
