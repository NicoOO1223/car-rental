import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { features } from "@/content/features";
import { screens } from "@/content/screens";

import { messages } from "./helpers";

const dir = join(__dirname, "..", "public", "screens");
const WIDTHS = { browser: [800, 1600], phone: [390, 780] } as const;

describe("screenshots", () => {
  it("exist on disk, at both widths, for every shot marked available", () => {
    for (const screen of Object.values(screens).filter((s) => s.available)) {
      for (const width of WIDTHS[screen.kind]) {
        expect(existsSync(join(dir, `${screen.id}-${width}.webp`)), `${screen.id}-${width}.webp`).toBe(true);
      }
    }
  });

  it("stay light: no shot above 160 KB, so the page keeps its performance budget", () => {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).shots as Record<string, { files: Record<string, { bytes: number }> }>;

    for (const [id, shot] of Object.entries(manifest)) {
      for (const [width, file] of Object.entries(shot.files)) expect(file.bytes, `${id} at ${width}`).toBeLessThan(160 * 1024);
    }
  });

  it("have an alt text and a caption for every shot a feature block shows", () => {
    for (const feature of features) {
      for (const id of [feature.screen, ...(feature.more ?? [])]) {
        expect(messages[`screens.${id}.alt`], `${id} alt`).toBeTruthy();
        expect(messages[`screens.${id}.caption`], `${id} caption`).toBeTruthy();
      }
    }
  });

  it("show at most two supporting shots per block", () => {
    for (const feature of features) expect((feature.more ?? []).length).toBeLessThanOrEqual(2);
  });
});
