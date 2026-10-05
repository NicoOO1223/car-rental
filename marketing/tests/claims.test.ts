import { describe, expect, it } from "vitest";

import { NOT_CLAIMED } from "@/content/claims";
import { features } from "@/content/features";
import { FAQ_COUNT } from "@/components/Faq";
import { screens } from "@/content/screens";

import { messages } from "./helpers";

describe("claims", () => {
  for (const { pattern, reason, allowedIn = [] } of NOT_CLAIMED) {
    it(`never says what is not shipped: ${reason}`, () => {
      const hits = Object.entries(messages)
        .filter(([key]) => !allowedIn.includes(key))
        .filter(([, text]) => pattern.test(text))
        .map(([key]) => key);

      expect(hits, `${reason} Found in: ${hits.join(", ")}`).toEqual([]);
    });
  }

  it("the FAQ can say SDI and KSeF are not included, and only there", () => {
    expect(messages["faq.a8"]).toMatch(/SDI/);
    expect(messages["faq.a8"]).toMatch(/not included/i);
  });
});

describe("the catalogue is complete for what the page renders", () => {
  it("has every feature title, sub and bullet", () => {
    for (const feature of features) {
      expect(messages[`features.${feature.id}.title`], feature.id).toBeTruthy();
      expect(messages[`features.${feature.id}.sub`], feature.id).toBeTruthy();

      for (let n = 1; n <= feature.bullets; n++) expect(messages[`features.${feature.id}.b${n}`], `${feature.id}.b${n}`).toBeTruthy();

      // No stray bullet beyond the declared count.
      expect(messages[`features.${feature.id}.b${feature.bullets + 1}`]).toBeUndefined();
    }
  });

  it("has ten FAQ questions with answers", () => {
    expect(FAQ_COUNT).toBe(10);

    for (let n = 1; n <= FAQ_COUNT; n++) {
      expect(messages[`faq.q${n}`], `q${n}`).toBeTruthy();
      expect(messages[`faq.a${n}`], `a${n}`).toBeTruthy();
    }
  });

  it("has alt text for every screenshot, and a caption for the ones in feature blocks", () => {
    for (const id of Object.keys(screens)) expect(messages[`screens.${id}.alt`], id).toMatch(/\S{3,}/);

    for (const feature of features) expect(messages[`screens.${feature.screen}.caption`], feature.screen).toBeTruthy();
  });

  it("claims only what the vehicle categories support", () => {
    expect(messages["hero.sub"]).toMatch(/car and van/);
  });
});
