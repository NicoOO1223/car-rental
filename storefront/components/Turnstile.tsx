"use client";

import { useEffect, useRef } from "react";

import { browserConfig } from "@/lib/client";

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
 * Cloudflare Turnstile: the check that a person, not a script, is booking.
 * `onToken` gets the token when the challenge passes and "" when it expires or
 * fails, so the form can keep its submit button off until there is a token.
 * Increase `resetKey` after a submit to get a fresh challenge (a token works
 * once). With no site key (development) it passes straight away with "".
 */
export function Turnstile({
  onToken,
  resetKey = 0,
  language,
}: {
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
    const siteKey = browserConfig().turnstileSiteKey;

    if (!siteKey) {
      callback.current("");
      return;
    }

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
  }, [language]);

  useEffect(() => {
    if (resetKey > 0 && widget.current && window.turnstile) {
      callback.current("");
      window.turnstile.reset(widget.current);
    }
  }, [resetKey]);

  return <div ref={container} />;
}
