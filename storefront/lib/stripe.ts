"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";

import { browserConfig } from "@/lib/client";

let promise: Promise<Stripe | null> | null | undefined;

/**
 * Stripe.js for this stack publishable key, loaded on first use. Null when the
 * stack has no key, in which case the payment step says so.
 */
export function getStripePromise(): Promise<Stripe | null> | null {
  if (promise === undefined) {
    const key = browserConfig().stripePublishableKey;

    promise = key ? loadStripe(key) : null;
  }

  return promise;
}
