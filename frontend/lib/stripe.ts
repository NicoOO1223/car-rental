import { loadStripe, type Stripe } from "@stripe/stripe-js";

import { getRuntimeConfig } from "@/lib/runtimeConfig";

let promise: Promise<Stripe | null> | null | undefined;

/**
 * Stripe.js for this stack's publishable key, loaded on first use. Null when
 * the stack has no key yet, in which case the payment screens say so instead
 * of showing a card form.
 */
export function getStripePromise(): Promise<Stripe | null> | null {
  if (promise === undefined) {
    const key = getRuntimeConfig().stripePublishableKey;

    promise = key ? loadStripe(key) : null;
  }

  return promise;
}
