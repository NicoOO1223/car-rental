"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { getNotifications, type Notification } from "@/lib/api";
import { setReminderDays } from "@/lib/maintenance";

type NotificationsValue = {
  items: Notification[];
  /** Everything that needs attention. */
  count: number;
  /** The part of it that is urgent (overdue, expired). */
  urgent: number;
  loading: boolean;
  refresh: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsValue | null>(null);

const REFRESH_MS = 5 * 60 * 1000;

/**
 * What needs attention (vehicles to move back, inspections, insurance),
 * fetched once signed in and again every few minutes. The server works it
 * out from the data each time, so there is nothing to mark as read: an item
 * goes away when the thing it is about is fixed.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await getNotifications();

      setItems(result.items);
      // The "due soon" badges on the vehicle page use the same window.
      setReminderDays(result.reminder_days);
    } catch {
      // A failure only means the badge is stale; the next tick tries again.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Loading on mount is the point of the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();

    const timer = window.setInterval(() => void refresh(), REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [refresh]);

  const value = useMemo(
    () => ({
      items,
      count: items.length,
      urgent: items.filter((item) => item.severity === "critical").length,
      loading,
      refresh,
    }),
    [items, loading, refresh],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsValue {
  const context = useContext(NotificationsContext);

  if (!context) {
    throw new Error("useNotifications must be used within a NotificationsProvider");
  }

  return context;
}
