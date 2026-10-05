// The screenshots of the staff panel and booking site. They are produced by
// scripts/capture-screens.mjs against a fictional demo business (phase 2);
// until a shot exists the page draws a clearly labelled placeholder.

export type ScreenId = "dashboard" | "storefront" | "handover" | "fleet" | "revenue" | "email" | "audit";

export type Screen = {
  id: ScreenId;
  kind: "browser" | "phone";
  /** Pixel size of the largest image, for the aspect ratio. */
  width: number;
  height: number;
  /** Set to true when public/screens/<id>-<width>.webp has been captured. */
  available: boolean;
};

export const screens: Record<ScreenId, Screen> = {
  dashboard: { id: "dashboard", kind: "browser", width: 1440, height: 900, available: false },
  storefront: { id: "storefront", kind: "phone", width: 390, height: 844, available: false },
  handover: { id: "handover", kind: "browser", width: 1440, height: 900, available: false },
  fleet: { id: "fleet", kind: "browser", width: 1440, height: 900, available: false },
  revenue: { id: "revenue", kind: "browser", width: 1440, height: 900, available: false },
  email: { id: "email", kind: "browser", width: 1440, height: 900, available: false },
  audit: { id: "audit", kind: "browser", width: 1440, height: 900, available: false },
};
