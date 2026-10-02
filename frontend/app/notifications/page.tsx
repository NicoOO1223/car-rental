"use client";

import Link from "next/link";
import { ArrowRight, Bell, CalendarClock, Camera, Gauge, Globe, ShieldCheck, Truck } from "lucide-react";

import { useNotifications } from "@/components/NotificationsProvider";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, PageShell } from "@/components/ui/PageHeader";
import type { Notification } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

const ICONS = {
  relocation: Truck,
  inspection_due: CalendarClock,
  inspection_overdue: CalendarClock,
  insurance_ending: ShieldCheck,
  insurance_expired: ShieldCheck,
  oil_change_due: Gauge,
  condition_review_due: Camera,
  online_booking: Globe,
} as const;

/** One sentence for a notification, in the language showing. */
function sentence(item: Notification): string {
  const vehicle = `${item.car.make} ${item.car.model} (${item.car.license_plate})`;

  if (item.kind === "relocation") {
    return t("notifications.relocation", {
      vehicle,
      airport: item.airport ?? "",
      home: item.home_airport ?? "",
    });
  }

  const days = item.days ?? 0;
  const date = item.date ? formatDate(item.date) : "";

  if (item.kind === "online_booking") {
    return t("notifications.onlineBooking", {
      customer: item.customer ?? "",
      vehicle,
      reference: item.reference ?? "",
      date,
    });
  }

  switch (item.kind) {
    case "inspection_due":
      return t("notifications.inspectionDue", { vehicle, date, days });
    case "inspection_overdue":
      return t("notifications.inspectionOverdue", { vehicle, date, days: Math.abs(days) });
    case "insurance_ending":
      return t("notifications.insuranceEnding", { vehicle, date, days });
    case "oil_change_due":
      return t("notifications.oilChangeDue", { vehicle, km: item.km_since ?? 0 });
    case "condition_review_due":
      return t("notifications.conditionReviewDue", { vehicle });
    default:
      return t("notifications.insuranceExpired", { vehicle, date, days: Math.abs(days) });
  }
}

export default function NotificationsPage() {
  const { items, loading } = useNotifications();

  return (
    <PageShell width="medium">
      <PageHeader
        title={t("notifications.title")}
        description={t("notifications.description")}
      />

      {!loading && items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={t("notifications.emptyTitle")}
          description={t("notifications.emptyDescription")}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const Icon = ICONS[item.kind as keyof typeof ICONS] ?? Bell;
            const urgent = item.severity === "critical";
            const info = item.severity === "info";
            const tone = urgent
              ? "bg-red-100 text-red-700"
              : info
                ? "bg-gray-100 text-gray-700"
                : "bg-amber-100 text-amber-800";

            return (
              <li key={`${item.kind}-${item.reservation_id ?? item.car.id}`}>
                <Card className="flex items-start gap-4 p-4">
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      <span
                        className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}
                      >
                        {urgent
                          ? t("notifications.urgent")
                          : info
                            ? t("notifications.new")
                            : t("notifications.soon")}
                      </span>
                      {sentence(item)}
                    </p>

                    <Link
                      href={
                        item.reservation_id
                          ? `/reservations/manage/${item.reservation_id}`
                          : `/cars/${item.car.id}`
                      }
                      className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-ink-secondary hover:text-ink"
                    >
                      {item.reservation_id ? t("notifications.viewReservation") : t("notifications.viewVehicle")}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
