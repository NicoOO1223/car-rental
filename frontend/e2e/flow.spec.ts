import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "e2e@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-password-1";

/** The label the booking calendar gives a day, in the business locale (English). */
function dayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Clicks a day in the calendar, moving to the next month if it is not showing. */
async function pickDay(page: Page, date: Date) {
  await showMonthOf(page, date);
  await page.getByRole("button", { name: dayLabel(date) }).click();
}

/** Walks the calendar forward until the wanted day is on screen. */
async function showMonthOf(page: Page, date: Date) {
  const day = page.getByRole("button", { name: dayLabel(date) });

  for (let i = 0; i < 48 && !(await day.isVisible().catch(() => false)); i++) {
    await page.getByRole("button", { name: "Next month" }).click();
  }
}

/** Signs on the pad that is currently on screen. */
async function sign(page: Page) {
  const pad = page.locator("canvas").first();
  await pad.scrollIntoViewIfNeeded();

  const box = await pad.boundingBox();
  if (!box) throw new Error("The signature pad is not on screen");

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 8 });
  await page.mouse.up();
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

test("a booking goes from search to a completed rental", async ({ page }) => {
  await signIn(page);

  // --- book -------------------------------------------------------------------
  await page.getByRole("link", { name: "New Reservation" }).click();
  await expect(page.getByRole("heading", { name: "New reservation" })).toBeVisible();

  const pickupSelect = page.getByLabel("Pickup location");
  await pickupSelect.selectOption({ index: 1 });
  await page.getByLabel("Return location").selectOption({ index: 1 });

  // A window of its own on every run (within the calendar's one-year reach), so a database that already holds earlier
  // runs still has cars free for it.
  const pickup = new Date();
  pickup.setDate(pickup.getDate() + 5 + Math.floor(Math.random() * 300));
  const dropOff = new Date(pickup);
  dropOff.setDate(dropOff.getDate() + 2);

  await pickDay(page, pickup);
  await pickDay(page, dropOff);

  await page.getByRole("button", { name: "Search vehicles" }).click();

  // The cheapest vehicle is listed first.
  await page.getByRole("button", { name: "Select", exact: true }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Skip extras" }).click();

  // --- the customer ---------------------------------------------------------------
  const stamp = Date.now();
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill(`Lovelace${stamp}`);
  await page.getByLabel("Date of birth").fill("1990-05-17");
  await page.getByLabel("Address").fill("1 Test Street");
  await page.getByLabel("Postal code").fill("07026");
  await page.getByLabel("Phone number").fill("+390789000000");
  await page.getByRole("textbox", { name: "Email" }).fill(`ada.${stamp}@example.com`);
  await page.getByRole("button", { name: "Continue" }).click();

  // --- review and confirm ----------------------------------------------------------
  await page.getByRole("button", { name: "Confirm reservation" }).click();
  await expect(page.getByRole("heading", { name: "Reservation created" })).toBeVisible();

  // --- approve --------------------------------------------------------------------
  page.on("dialog", (dialog) => dialog.accept());

  await page.getByRole("button", { name: "View reservation" }).click();
  await page.getByRole("button", { name: "Approve Reservation" }).click();
  await expect(page.getByText("Reservation cancelled")).toHaveCount(0);

  // --- check in ---------------------------------------------------------------------
  await page.getByRole("button", { name: "Start check-in (Payment & Agreement)" }).click();
  await expect(page.getByRole("heading", { name: "Vehicle Check-in" })).toBeVisible();

  // Cash: no card processor is needed for the test. Where card payment is not
  // set up at all the cash form is shown straight away, with no tab to pick.
  const cashTab = page.getByRole("button", { name: "Cash", exact: true });
  if (await cashTab.isVisible()) await cashTab.click();
  await page.getByRole("button", { name: "Confirm Cash Payment" }).click();
  await expect(page.getByText(/Payment received/)).toBeVisible();

  // --- identity and licence ----------------------------------------------------------
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 3);
  const expiry = nextYear.toISOString().slice(0, 10);

  await page.getByLabel("National ID number").fill("LVLDAA90E57Z114Y");
  await page.getByLabel("Licence number").fill("SS1234567");
  await page.getByLabel("Expiry date").fill(expiry);
  // The form can reload the saved details a moment after it appears, which
  // would untick the box, so ticking is retried until it holds.
  const confirmed = page.getByLabel(/I have checked the customer's original documents/);
  await expect(async () => {
    await confirmed.check();
    await expect(confirmed).toBeChecked({ timeout: 1000 });
    await expect(page.getByRole("button", { name: "Save identity details" })).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "Save identity details" }).click();
  await expect(page.getByText(/Identity and driving licence recorded/)).toBeVisible();

  // --- signatures -------------------------------------------------------------------------
  // The customer accepts the terms before signing; the signature cannot be saved without it.
  await page.getByLabel(/The customer has read and accepts these terms/).check();
  await sign(page);
  await page.getByRole("button", { name: "Save Signature" }).click();
  await expect(page.getByText("Signature captured.")).toBeVisible();

  await sign(page);
  await page.getByRole("button", { name: "Save Signature" }).click();
  await expect(page.getByText(/Signed by/)).toBeVisible();

  // --- agreement and start ---------------------------------------------------------------------
  await page.getByRole("button", { name: "Generate Agreement & Start Rental" }).click();
  await expect(page.getByText("Check-in complete")).toBeVisible();

  // --- check out ---------------------------------------------------------------------------
  await page.getByRole("button", { name: "View Reservation" }).click();
  await page.getByRole("button", { name: "Start check-out" }).click();
  await expect(page.getByRole("heading", { name: "Vehicle Check-out" })).toBeVisible();

  // The car comes back as it went out: same mileage, full tank, no damage.
  await page.getByRole("button", { name: "Save condition" }).click();
  await expect(page.getByText("No charges to collect.")).toBeVisible();

  await sign(page);
  await page.getByRole("button", { name: "Save Signature" }).click();
  await expect(page.getByText(/Received by/)).toBeVisible();

  await page.getByRole("button", { name: "Complete Check-out" }).click();
  await expect(page.getByText("Check-out complete")).toBeVisible();

  // --- the rental is closed --------------------------------------------------------------------
  await page.getByRole("button", { name: "View Reservation" }).click();
  await expect(page.getByText("Rental completed")).toBeVisible();
});
