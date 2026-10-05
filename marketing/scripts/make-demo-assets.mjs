// Draws the vehicle pictures used by the fictional demo business: simple flat
// side-view illustrations, made here so there is no licence to worry about and
// no photograph of a real car, plate or person. Output: scripts/demo-assets/*.jpg
//
//   node scripts/make-demo-assets.mjs
//
// Needs Playwright (the one in frontend/node_modules) to turn the SVG into a JPEG.

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "demo-assets");
const require = createRequire(join(here, "..", "..", "frontend", "package.json"));
const { chromium } = require("@playwright/test");

// Side-view bodies. Each: body outline, glass outline, wheel centres, wheel radius.
const SHAPES = {
  mini: {
    body: "M310 500 L310 440 Q315 410 355 404 L452 392 Q505 300 585 292 L715 292 Q790 298 832 384 L884 398 Q914 408 914 446 L914 500 Z",
    glass: "M528 388 Q552 330 592 322 L700 322 Q744 326 772 388 Z",
    wheels: [410, 810],
    radius: 60,
  },
  compact: {
    body: "M230 504 L230 446 Q236 414 280 408 L430 396 Q500 305 600 296 L760 296 Q850 304 900 392 L980 408 Q1012 416 1012 452 L1012 504 Z",
    glass: "M520 392 Q555 336 604 328 L752 328 Q800 334 840 392 Z",
    wheels: [370, 860],
    radius: 62,
  },
  suv: {
    body: "M236 508 L236 430 Q242 396 288 390 L420 380 Q470 262 580 254 L800 254 Q890 262 930 380 L980 392 Q1016 402 1016 440 L1016 508 Z",
    glass: "M488 372 Q520 296 590 288 L792 288 Q850 294 884 372 Z",
    wheels: [378, 868],
    radius: 70,
  },
  van: {
    body: "M200 512 L200 300 Q200 252 250 248 L760 240 Q830 242 878 330 L960 366 Q1004 380 1004 420 L1004 512 Z",
    glass: "M776 268 Q810 270 842 336 L930 366 L776 366 Z",
    wheels: [350, 850],
    radius: 66,
  },
};

function vehicle(shape, color, background) {
  const s = SHAPES[shape];
  const wheels = s.wheels
    .map(
      (x) => `<circle cx="${x}" cy="520" r="${s.radius}" fill="#111827"/><circle cx="${x}" cy="520" r="${s.radius * 0.55}" fill="#9ca3af"/><circle cx="${x}" cy="520" r="${s.radius * 0.18}" fill="#374151"/>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="130 150 940 627">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${background[0]}"/><stop offset="1" stop-color="${background[1]}"/></linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset=".5" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="0" y="0" width="1200" height="800" fill="url(#bg)"/>
  <rect y="560" width="1200" height="240" fill="#000" opacity=".06"/>
  <ellipse cx="610" cy="584" rx="430" ry="22" fill="#000" opacity=".18"/>
  <path d="${s.body}" fill="${color}"/>
  <path d="${s.body}" fill="url(#shine)"/>
  <path d="${s.glass}" fill="#dbeafe" opacity=".92"/>
  <path d="${s.glass}" fill="none" stroke="#0a0a0a" stroke-opacity=".25" stroke-width="3"/>
  ${wheels}
  <rect x="${s.wheels[0] - 140}" y="478" width="52" height="12" rx="6" fill="#0a0a0a" opacity=".18"/>
</svg>`;
}

// Name, shape, body colour, background gradient. One per class, plus a colour
// for each car so a class's cars are not all identical.
const PICTURES = [
  ["class-mini", "mini", "#e5484d", ["#fef3c7", "#fde68a"]],
  ["class-compact", "compact", "#2563eb", ["#e0f2fe", "#bae6fd"]],
  ["class-suv", "suv", "#374151", ["#ecfccb", "#d9f99d"]],
  ["class-van", "van", "#f8fafc", ["#fae8ff", "#f5d0fe"]],
  ["car-mini-red", "mini", "#e5484d", ["#fef3c7", "#fde68a"]],
  ["car-mini-white", "mini", "#f1f5f9", ["#fef3c7", "#fde68a"]],
  ["car-mini-yellow", "mini", "#f5b301", ["#e0f2fe", "#bae6fd"]],
  ["car-mini-green", "mini", "#2f9e6b", ["#fef3c7", "#fde68a"]],
  ["car-compact-blue", "compact", "#2563eb", ["#e0f2fe", "#bae6fd"]],
  ["car-compact-silver", "compact", "#9ca3af", ["#e0f2fe", "#bae6fd"]],
  ["car-compact-black", "compact", "#1f2937", ["#e0f2fe", "#bae6fd"]],
  ["car-suv-grey", "suv", "#374151", ["#ecfccb", "#d9f99d"]],
  ["car-suv-orange", "suv", "#ea7a1a", ["#ecfccb", "#d9f99d"]],
  ["car-van-white", "van", "#f8fafc", ["#fae8ff", "#f5d0fe"]],
];

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

for (const [name, shape, color, background] of PICTURES) {
  const svg = vehicle(shape, color, background);

  writeFileSync(join(outDir, `${name}.svg`), svg);
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.screenshot({ path: join(outDir, `${name}.jpg`), type: "jpeg", quality: 86 });
  console.log(name);
}

await browser.close();
