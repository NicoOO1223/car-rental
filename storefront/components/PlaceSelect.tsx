"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type PlaceOption = { value: string; label: string; hint: string };

/**
 * A place picker in the site's own style: a button that opens a list. (The
 * browser's own select list cannot be styled.) Works with the keyboard like
 * a native select: arrows, Home/End, Enter or Space to choose, Escape to close.
 */
export function PlaceSelect({
  label,
  icon,
  value,
  options,
  onChange,
  onOpen,
  className = "",
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  options: PlaceOption[];
  onChange: (value: string) => void;
  /** Called when the list opens, so the page can close anything else that is open. */
  onOpen?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [active, setActive] = useState(selectedIndex);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;

    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", onPointer);

    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  // Keyboard focus moves into the list while it is open.
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  function show() {
    setActive(selectedIndex);
    setOpen(true);
    onOpen?.();
  }

  function choose(index: number) {
    const option = options[index];

    if (option) onChange(option.value);

    setOpen(false);
    button.current?.focus();
  }

  function onListKey(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => Math.min(options.length - 1, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  const current = options[selectedIndex];

  return (
    <div ref={root} className={`relative flex min-w-0 flex-1 ${className}`}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) show();
          }
        }}
        className={`group flex w-full min-w-0 flex-col justify-center rounded-xl px-3.5 py-4 text-left transition-colors hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${
          open ? "bg-surface-sunken" : ""
        }`}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
          {icon}
          {label}
        </span>
        <span className="mt-1 flex w-full items-center justify-between gap-2 text-[15px] font-semibold text-ink">
          <span className="truncate">{current?.label}</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-option-${active}`}
          onKeyDown={onListKey}
          className="absolute left-0 top-full z-50 mt-2 min-w-full max-w-[22rem] overflow-hidden rounded-2xl border border-border-subtle bg-surface p-1.5 shadow-2xl focus:outline-none"
        >
          {options.map((option, index) => {
            const selected = option.value === value;

            return (
              <li
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-2.5 ${
                  index === active ? "bg-surface-sunken" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className={`block truncate text-sm text-ink ${selected ? "font-semibold" : "font-medium"}`}>
                    {option.label}
                  </span>
                  <span className="block text-xs text-ink-muted">{option.hint}</span>
                </span>

                {selected && <Check className="h-4 w-4 shrink-0 text-ink" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
