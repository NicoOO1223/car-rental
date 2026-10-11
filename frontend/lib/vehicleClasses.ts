"use client";

import { useEffect, useState } from "react";

import { getPublicConfiguration } from "@/lib/api";

/**
 * Whether this business groups its cars into vehicle classes (Configuration,
 * Classes). Off, every car is shown and booked on its own and the screens
 * leave the class out.
 *
 * Read once per session and shared; a screen shows the classes until the
 * answer is known, which is how it always behaved.
 */

let known: boolean | null = null;
let pending: Promise<boolean> | null = null;
const listeners = new Set<(on: boolean) => void>();

function load(): Promise<boolean> {
  pending ??= getPublicConfiguration()
    .then((configuration) => {
      known = configuration.use_vehicle_classes !== false;

      return known;
    })
    // A failed read (a 401 is handled globally) leaves things as they were.
    .catch(() => {
      pending = null;

      return true;
    });

  return pending;
}

/** Called after an administrator changes the setting, so every open screen follows. */
export function setUsesVehicleClasses(on: boolean): void {
  known = on;
  pending = Promise.resolve(on);
  listeners.forEach((listener) => listener(on));
}

export function useUsesVehicleClasses(): boolean {
  const [on, setOn] = useState(known ?? true);

  useEffect(() => {
    let cancelled = false;

    listeners.add(setOn);
    void load().then((value) => {
      if (!cancelled) setOn(value);
    });

    return () => {
      cancelled = true;
      listeners.delete(setOn);
    };
  }, []);

  return on;
}
