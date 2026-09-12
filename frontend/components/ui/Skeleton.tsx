export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-gray-200 ${className}`} />;
}

// A row of stat-tile skeletons, matching the `rounded-xl bg-white p-5
// shadow-sm` tiles used across the dashboard/reservations/maintenance
// pages — pass the same grid className the real tiles use.
export function SkeletonStatTiles({
  count,
  className = "",
}: {
  count: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl bg-white p-5 shadow-sm">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

// A detail page's shape: back-link, title/badge header, then one info
// card — matches the car/customer/reservation detail page skeleton.
export function SkeletonDetailPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Skeleton className="mb-4 h-4 w-32" />
      <Skeleton className="mb-8 h-9 w-72" />

      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-5 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// A stack of card-shaped skeleton rows, matching the "divide-y" list
// rows used across Reservations/Customers/Fleet/Maintenance.
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="divide-y overflow-hidden rounded-xl bg-white shadow-sm">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}
