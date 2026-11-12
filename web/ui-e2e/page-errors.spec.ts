// Garde automatique de fixtures.ts (audit D1) : une exception non attrapée dans la page, levée
// ou promesse rejetée sans gestionnaire, fait échouer le test. `test.fail` : ces deux tests
// DOIVENT échouer ; s'ils passaient, la garde ne garderait plus rien.
import { expect, test } from "./fixtures";

const PAGE = "<!doctype html><title>garde</title><p>garde</p>";

test.fail("exception levée dans la page → test en échec", async ({ page }) => {
  await page.route("http://garde.invalid/", (r) => r.fulfill({ status: 200, contentType: "text/html", body: PAGE }));
  await page.goto("http://garde.invalid/");
  await page.evaluate(() => setTimeout(() => {
    throw new Error("levée exprès");
  }));
  await expect(page.locator("p")).toHaveText("garde");
  await page.waitForTimeout(100);
});

test.fail("promesse rejetée sans gestionnaire → test en échec", async ({ page }) => {
  await page.route("http://garde.invalid/", (r) => r.fulfill({ status: 200, contentType: "text/html", body: PAGE }));
  await page.goto("http://garde.invalid/");
  await page.evaluate(() => {
    void Promise.reject(new DOMException("Transition was skipped", "AbortError"));
  });
  await page.waitForTimeout(100);
});

test("sans exception : la garde laisse passer", async ({ page, pageErrors }) => {
  await page.route("http://garde.invalid/", (r) => r.fulfill({ status: 200, contentType: "text/html", body: PAGE }));
  await page.goto("http://garde.invalid/");
  await page.evaluate(() => Promise.reject(new Error("rejet traité")).catch(() => undefined));
  await page.waitForTimeout(100);
  expect(pageErrors).toEqual([]);
});
