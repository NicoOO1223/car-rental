"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * A button that opens a small panel. Closes on Escape, on a click outside and
 * after a choice inside (`closeOnSelect`). The panel's links are normal links,
 * so the menu works the same with a keyboard as with a mouse.
 */
export function Menu({
  label,
  trigger,
  align = "right",
  triggerClassName = "",
  panelClassName = "",
  children,
}: {
  /** Accessible name of the button. */
  label: string;
  trigger: React.ReactNode;
  align?: "left" | "right";
  triggerClassName?: string;
  panelClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={triggerClassName}
      >
        {trigger}
      </button>

      {open && (
        <div
          id={panelId}
          onClick={(event) => {
            // A choice (a link or a button inside) closes the panel.
            if ((event.target as HTMLElement).closest("a,button")) setOpen(false);
          }}
          className={`absolute z-50 mt-2 min-w-44 overflow-hidden rounded-xl border border-border-subtle bg-surface py-1.5 text-sm text-ink shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
