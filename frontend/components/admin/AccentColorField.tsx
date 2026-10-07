"use client";

import { useId } from "react";
import { Check } from "lucide-react";

import { accentInk, normalizeAccent, onAccent } from "@/lib/accent";
import { t } from "@/lib/i18n";

// A few safe starting points. Black is first because it is the default.
const PRESETS = [
  { color: "#0a0a0a", label: () => t("s.admin.configuration.business.accentPresetBlack") },
  { color: "#1f4fd8", label: () => t("s.admin.configuration.business.accentPresetBlue") },
  { color: "#0d7a5f", label: () => t("s.admin.configuration.business.accentPresetGreen") },
  { color: "#c2410c", label: () => t("s.admin.configuration.business.accentPresetOrange") },
  { color: "#b91c1c", label: () => t("s.admin.configuration.business.accentPresetRed") },
  { color: "#6d28d9", label: () => t("s.admin.configuration.business.accentPresetPurple") },
];

/**
 * The business's brand colour: a few presets, any colour of their own, and a
 * preview of what it does to a button, a link and a highlight. The preview is
 * drawn with the same rules the apps use (lib/accent.ts), so what is shown
 * here is what staff and renters will see.
 */
export function AccentColorField({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const id = useId();
  const accent = normalizeAccent(value);
  const text = onAccent(accent);
  const ink = accentInk(accent);
  const adjusted = ink !== accent || text !== "#ffffff";

  return (
    <div>
      <p id={`${id}-label`} className="text-sm font-medium text-ink">
        {t("s.admin.configuration.business.accentLabel")}
      </p>
      <p className="mt-1 text-xs text-ink-muted">{t("s.admin.configuration.business.accentHint")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
        {PRESETS.map((preset) => {
          const selected = preset.color === accent;

          return (
            <button
              key={preset.color}
              type="button"
              title={preset.label()}
              aria-label={preset.label()}
              aria-pressed={selected}
              onClick={() => onChange(preset.color)}
              style={{ backgroundColor: preset.color, color: onAccent(preset.color) }}
              className={`flex h-9 w-9 items-center justify-center rounded-full ring-offset-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
                selected ? "ring-2 ring-accent-ink" : "ring-1 ring-border-strong"
              }`}
            >
              {selected && <Check className="h-4 w-4" aria-hidden="true" />}
            </button>
          );
        })}

        <label
          htmlFor={`${id}-custom`}
          className="ml-2 flex cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-surface py-1.5 pl-1.5 pr-3 text-sm text-ink-secondary hover:bg-surface-sunken"
        >
          <input
            id={`${id}-custom`}
            type="color"
            value={accent}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
            className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
          />
          {t("s.admin.configuration.business.accentCustom")}
          <span className="font-mono text-xs text-ink-muted">{accent}</span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-border-subtle bg-canvas p-4" aria-hidden="true">
        <span className="rounded-lg px-4 py-2.5 text-sm font-medium" style={{ backgroundColor: accent, color: text }}>
          {t("s.admin.configuration.business.accentPreviewButton")}
        </span>

        <span className="text-sm font-medium underline underline-offset-4" style={{ color: ink }}>
          {t("s.admin.configuration.business.accentPreviewLink")}
        </span>

        <span
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 9%, #ffffff)`, color: ink }}
        >
          {t("s.admin.configuration.business.accentPreviewTag")}
        </span>
      </div>

      {adjusted && <p className="mt-2 text-xs text-ink-muted">{t("s.admin.configuration.business.accentTextAdjusted")}</p>}
    </div>
  );
}
