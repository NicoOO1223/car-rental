import { Check } from "lucide-react";

export type StepStatus = "locked" | "active" | "done";

/** The numbered heading of one step card in the check-in / check-out flows. */
export function StepHeader({
  index,
  title,
  status,
}: {
  index: number;
  title: string;
  status: StepStatus;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          status === "done" || status === "active"
            ? "bg-accent text-on-accent"
            : "bg-surface-sunken text-ink-muted"
        }`}
      >
        {status === "done" ? <Check className="h-4 w-4" /> : index}
      </div>

      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}
