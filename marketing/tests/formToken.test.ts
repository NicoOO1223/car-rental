import { describe, expect, it } from "vitest";

import { createFormToken, formTokenAge } from "@/lib/formToken";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

describe("form token", () => {
  it("tells how long ago it was issued", () => {
    const token = createFormToken(NOW - 5000, SECRET);

    expect(formTokenAge(token, SECRET, NOW)).toBe(5000);
  });

  it("is refused under another secret", () => {
    const token = createFormToken(NOW - 5000, SECRET);

    expect(formTokenAge(token, "another-secret", NOW)).toBeNull();
  });

  it("is refused when the timestamp is altered: a script cannot claim the form was open for longer", () => {
    const token = createFormToken(NOW - 500, SECRET);
    const [, signature] = token.split(".");

    expect(formTokenAge(`${NOW - 60_000}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("is refused when the signature is altered or has the wrong length", () => {
    const token = createFormToken(NOW - 5000, SECRET);

    expect(formTokenAge(token.slice(0, -1) + "0", SECRET, NOW)).toBeNull();
    expect(formTokenAge(token.slice(0, -4), SECRET, NOW)).toBeNull();
  });

  it("is refused when it is not shaped like a token", () => {
    for (const token of ["", "garbage", ".", "1800000000000.", ".abc", "1800000000000.abc.def", "abc.def"]) {
      expect(formTokenAge(token, SECRET, NOW), token).toBeNull();
    }
  });

  it("expires after two hours", () => {
    const token = createFormToken(NOW - 2 * 60 * 60 * 1000 - 1, SECRET);

    expect(formTokenAge(token, SECRET, NOW)).toBeNull();
    expect(formTokenAge(createFormToken(NOW - 2 * 60 * 60 * 1000, SECRET), SECRET, NOW)).not.toBeNull();
  });

  it("is refused when it comes from the future", () => {
    expect(formTokenAge(createFormToken(NOW + 10_000, SECRET), SECRET, NOW)).toBeNull();
  });
});
