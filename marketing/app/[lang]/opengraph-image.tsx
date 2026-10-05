import { ImageResponse } from "next/og";

import { brand } from "@/content/brand";
import { getTranslator } from "@/lib/i18n";

// The picture a link preview shows (1200x630), drawn from the brand file so a
// rename changes it with everything else. Text only: no screenshot is needed,
// and none can be missing.

export const alt = brand.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getTranslator(lang);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          color: "#f9fafb",
          padding: "72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 56, fontWeight: 700, letterSpacing: -2 }}>
          <span style={{ textTransform: "lowercase" }}>{brand.name}</span>
          <span style={{ width: 20, height: 20, background: "#c6f432", borderRadius: 4, marginTop: 14 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3, maxWidth: 1000 }}>{t("hero.title")}</div>
          <div style={{ fontSize: 32, color: "#a3a3a3", maxWidth: 900 }}>{t("hero.sub")}</div>
        </div>
      </div>
    ),
    size,
  );
}
