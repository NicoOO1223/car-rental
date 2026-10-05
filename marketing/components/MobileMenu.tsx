"use client";

import { useEffect, useRef, useState } from "react";

type Item = { href: string; label: string };

// The phone menu: a full-width sheet under the header. Escape and a tap on a
// link close it; focus returns to the button. Without JavaScript the anchors
// are still reachable by scrolling, so the page works without this.
export function MobileMenu({ items, menuLabel, closeLabel }: { items: Item[]; menuLabel: string; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    }

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/20 px-3 text-on-deep"
      >
        <span className="sr-only">{open ? closeLabel : menuLabel}</span>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          {open ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
        </svg>
      </button>

      {open && (
        <nav id="mobile-menu" className="absolute inset-x-0 top-full border-t border-white/10 bg-deep px-4 pb-4">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 items-center border-b border-white/10 text-lg text-on-deep"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
