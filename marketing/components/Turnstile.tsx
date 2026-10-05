"use client";

import { useEffect, useRef } from "react";

// Adapted from storefront/components/Turnstile.tsx: the same widget, but the site
// key is passed in (the marketing site has no browserConfig). It is loaded only
// by the demo form, so no other page talks to Cloudflare.

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      language?: string;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    const script = existing ?? document.createElement("script");

    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")));

    if (!existing) {
      script.src = SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * Cloudflare Turnstile. `onToken` gets the token when the challenge passes and ""
 * when it expires or fails. Raise `resetKey` after a submit to get a fresh
 * challenge: a token works once.
 */
export function Turnstile({
  siteKey,
  onToken,
  resetKey = 0,
  language = "en",
}: {
  siteKey: string;
  onToken: (token: string) => void;
  resetKey?: number;
  language?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const callback = useRef(onToken);

  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;

        widget.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          language,
          callback: (token) => callback.current(token),
          "expired-callback": () => callback.current(""),
          "error-callback": () => callback.current(""),
        });
      })
      .catch(() => callback.current(""));

    return () => {
      cancelled = true;

      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = undefined;
    };
  }, [siteKey, language]);

  useEffect(() => {
    if (resetKey > 0 && widget.current && window.turnstile) {
      callback.current("");
      window.turnstile.reset(widget.current);
    }
  }, [resetKey]);

  return <div ref={container} />;
}
