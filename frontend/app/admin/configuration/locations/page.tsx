"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Pencil, Plus } from "lucide-react";

import {
  getConfiguration,
  getLocations,
  updateLocation,
  type Location,
} from "@/lib/api";
import { LocationModal } from "@/components/admin/LocationModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export default function LocationsConfigurationPage() {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [businessTimezone, setBusinessTimezone] = useState("UTC");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Location | "new" | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLocations(await getLocations({ includeInactive: true }));
    } catch {
      setError("Failed to load locations.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([getLocations({ includeInactive: true }), getConfiguration()])
      .then(([data, configuration]) => {
        if (cancelled) return;

        setLocations(data);
        setBusinessTimezone(configuration.timezone);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load locations.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleActive(location: Location) {
    setBusyId(location.id);
    setError("");

    try {
      await updateLocation(location.id, { is_active: !location.is_active });
      await refresh();
    } catch (err) {
      // The API explains why a location still in use cannot be retired.
      setError(err instanceof Error ? err.message : "Failed to update the location.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Locations</h2>

            <p className="mt-1 text-sm text-ink-secondary">
              Where vehicles are based and picked up. Each has its own
              timezone. A location can be retired once no vehicles or open
              reservations are left there; past records keep showing it.
            </p>
          </div>

          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add location
          </Button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {!locations ? (
          !error && <p className="mt-6 text-ink-secondary">Loading locations…</p>
        ) : locations.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={MapPin}
            title="No locations yet"
            description="Add the first location before adding vehicles or taking bookings."
            action={
              <Button onClick={() => setEditing("new")}>Add location</Button>
            }
          />
        ) : (
          <ul className="mt-6 divide-y divide-border-subtle">
            {locations.map((location) => (
              <li
                key={location.id}
                className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between ${
                  location.is_active ? "" : "opacity-60"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">
                      {location.airport_code}
                    </span>
                    {location.name}
                    {!location.is_active && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                        Retired
                      </span>
                    )}
                  </p>

                  {location.address && (
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {location.address}
                    </p>
                  )}

                  <p className="mt-1 text-sm text-ink-secondary">
                    {location.timezone}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => setEditing(location)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Edit
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busyId === location.id}
                    disabled={busyId !== null}
                    onClick={() => toggleActive(location)}
                  >
                    {location.is_active ? "Retire" : "Restore"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <LocationModal
          location={editing === "new" ? undefined : editing}
          defaultTimezone={businessTimezone}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
