import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// The staff app under test (see e2e/flow.spec.ts).
const STAFF_URL = process.env.E2E_BASE_URL ?? "http://localhost:3020";
// The public storefront app, built and started alongside it.
const STOREFRONT_URL = process.env.E2E_STOREFRONT_URL ?? "http://localhost:3021/en";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";

const EMAIL = process.env.E2E_EMAIL ?? "e2e@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-password-1";

// The transactional tests need a real (test-mode) Stripe key on the backend —
// without one, the storefront cannot even hold a car, since creating a
// booking asks Stripe for a PaymentIntent up front. Whoever runs this locally
// exports STRIPE_SECRET_KEY themselves; CI does the same from a repository
// secret, left empty by default, in which case these are skipped.
const hasStripe = Boolean(process.env.STRIPE_SECRET_KEY);

/** A booking window this run has not used before, days out from today. */
function window(offsetDays: number, lengthDays = 3): { pickup: string; drop: string } {
  const pickup = new Date();
  pickup.setDate(pickup.getDate() + offsetDays);
  const drop = new Date(pickup);
  drop.setDate(drop.getDate() + lengthDays);

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  return { pickup: iso(pickup), drop: iso(drop) };
}

async function signIn(page: Page) {
  await page.goto(`${STAFF_URL}/login`);
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

/** Signs on the pad that is currently on screen (see e2e/flow.spec.ts). */
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

/**
 * Books a car on the storefront, pays the online share with a Stripe test
 * card, and returns once the confirmation page shows. Assumes online booking
 * is switched on and a Stripe test key is configured.
 */
async function bookOnline(page: Page, offsetDays: number): Promise<string> {
  const { pickup, drop } = window(offsetDays);

  await page.goto(STOREFRONT_URL);
  await page.locator('input[type="date"]').first().fill(pickup);
  await page.locator('input[type="date"]').nth(1).fill(drop);
  await page.getByRole("button", { name: "Search cars" }).click();

  await expect(page.getByRole("heading", { name: "Choose your car" })).toBeVisible();
  await page.getByRole("button", { name: "Select" }).first().click();

  await expect(page.getByRole("heading", { name: "Add extras" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  const stamp = Date.now();
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill(`Renter${stamp}`);
  await page.getByLabel("Date of birth").fill("1990-04-02");
  await page.getByLabel("Phone number").fill("+390789000111");
  await page.getByRole("textbox", { name: "Email" }).fill(`ada.${stamp}@example.com`);
  await page.getByLabel("Address").fill("1 Test Street");
  await page.getByLabel("Postal code").fill("07026");
  await page.getByLabel(/I accept the/).check();
  await page.getByLabel(/I have read the/).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();

  await expect(page.getByRole("heading", { name: /^Pay .* to confirm/ })).toBeVisible();
  const reference = (await page.locator("p.font-mono").first().innerText()).trim();

  const cardFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
  await cardFrame.getByPlaceholder(/1234 1234/).fill("4242424242424242");
  await cardFrame.getByPlaceholder("MM / YY").fill("12 / 40");
  await cardFrame.getByPlaceholder("CVC").fill("123");
  const zip = cardFrame.getByPlaceholder(/ZIP|Postal/i);
  if (await zip.isVisible().catch(() => false)) await zip.fill("12345");
  await page.getByRole("button", { name: /^Pay / }).click();

  await expect(page.getByRole("heading", { name: "Booking confirmed" })).toBeVisible({ timeout: 60_000 });

  return reference;
}

// A local dev backend occasionally drops the odd connection under Node's
// keep-alive pooling; one retry is enough to tell that apart from a real
// failure, and matters here because this runs right after a batch of other
// requests that just finished.
async function retrying<T>(times: number, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= times) throw error;
    }
  }
}

async function adminAuthHeader(request: APIRequestContext) {
  const login = await retrying(3, () =>
    request.post(`${API_URL}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } }),
  );
  const { access_token: token } = await login.json();

  return { Authorization: `Bearer ${token}` };
}

test.describe("the public storefront", () => {
  let originallyEnabled = false;

  test.beforeAll(async ({ request }) => {
    const auth = await adminAuthHeader(request);

    const before = await (await request.get(`${API_URL}/api/configuration`, { headers: auth })).json();
    originallyEnabled = before.storefront_enabled;

    await retrying(3, () =>
      request.patch(`${API_URL}/api/configuration`, { headers: auth, data: { storefront_enabled: true } }),
    );
  });

  test.afterAll(async ({ request }) => {
    const auth = await adminAuthHeader(request);

    await retrying(3, () =>
      request.patch(`${API_URL}/api/configuration`, { headers: auth, data: { storefront_enabled: originallyEnabled } }),
    );
  });

  test("serves its public pages", async ({ page }) => {
    await page.goto(STOREFRONT_URL);
    await expect(page.getByRole("heading", { name: "Rent a car in minutes" })).toBeVisible();

    const response = await page.goto(STOREFRONT_URL.replace(/\/en$/, "/en/terms"));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Terms and conditions" })).toBeVisible();

    // Report-only for now (see docs/ROADMAP.md): logged, not blocking, until
    // it has run against real traffic for a while.
    expect(response?.headers()["content-security-policy-report-only"]).toContain("frame-ancestors 'none'");
  });

  test("a renter books, pays, and staff complete the rental", async ({ page }) => {
    test.skip(!hasStripe, "STRIPE_SECRET_KEY is not set");

    const reference = await bookOnline(page, 40);

    // --- staff side: find it, take the remainder, run the rental through ------------------------

    await signIn(page);
    await page.goto(`${STAFF_URL}/reservations/manage?status=ALL&q=${encodeURIComponent(reference)}`);
    await page.getByText(reference).first().click();

    await expect(page.getByRole("heading", { name: "Reservation" })).toBeVisible();
    await expect(page.getByText("Booked online")).toBeVisible();

    await page.getByRole("button", { name: "Start check-in (Payment & Agreement)" }).click();
    await expect(page.getByRole("heading", { name: "Vehicle Check-in" })).toBeVisible();

    const cashTab = page.getByRole("button", { name: "Cash", exact: true });
    if (await cashTab.isVisible()) await cashTab.click();
    await page.getByRole("button", { name: "Confirm Cash Payment" }).click();
    await expect(page.getByText(/Payment received/)).toBeVisible();

    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 3);

    await page.getByLabel("National ID number").fill("LVLDAA90E57Z114Y");
    await page.getByLabel("Licence number").fill("SS1234567");
    await page.getByLabel("Expiry date").fill(nextYear.toISOString().slice(0, 10));

    const confirmed = page.getByLabel(/I have checked the customer's original documents/);
    await expect(async () => {
      await confirmed.check();
      await expect(confirmed).toBeChecked({ timeout: 1000 });
      await expect(page.getByRole("button", { name: "Save identity details" })).toBeEnabled({ timeout: 1000 });
    }).toPass();
    await page.getByRole("button", { name: "Save identity details" }).click();
    await expect(page.getByText(/Identity and driving licence recorded/)).toBeVisible();

    await sign(page);
    await page.getByRole("button", { name: "Save Signature" }).click();
    await expect(page.getByText("Signature captured.")).toBeVisible();

    await sign(page);
    await page.getByRole("button", { name: "Save Signature" }).click();
    await expect(page.getByText(/Signed by/)).toBeVisible();

    await page.getByRole("button", { name: "Generate Agreement & Start Rental" }).click();
    await expect(page.getByText("Check-in complete")).toBeVisible();

    await page.getByRole("button", { name: "View Reservation" }).click();
    await page.getByRole("button", { name: "Start check-out" }).click();
    await expect(page.getByRole("heading", { name: "Vehicle Check-out" })).toBeVisible();

    await page.getByRole("button", { name: "Save condition" }).click();
    await expect(page.getByText("No charges to collect.")).toBeVisible();

    await sign(page);
    await page.getByRole("button", { name: "Save Signature" }).click();
    await expect(page.getByText(/Received by/)).toBeVisible();

    await page.getByRole("button", { name: "Complete Check-out" }).click();
    await expect(page.getByText("Check-out complete")).toBeVisible();

    await page.getByRole("button", { name: "View Reservation" }).click();
    await expect(page.getByText("Rental completed")).toBeVisible();
  });

  test("a renter cancels before the cutoff and is refunded", async ({ page }) => {
    test.skip(!hasStripe, "STRIPE_SECRET_KEY is not set");

    await bookOnline(page, 45);

    await page.getByRole("button", { name: "Cancel this booking" }).click();
    await expect(page.getByText(/You will be refunded/)).toBeVisible();
    await page.getByRole("button", { name: "Yes, cancel booking" }).click();

    await expect(page.getByText("This booking was cancelled.")).toBeVisible();
    await expect(page.getByText(/was refunded to your card/)).toBeVisible();
  });
});
