import { expect, test } from "@playwright/test";

for (const mode of ["batch", "pending", "cloud-move"] as const) {
  test(`transfer count placement and totals: ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US"] }));
    const job = {
      id: "transfer-test", accountId: "7", type: mode === "cloud-move" ? "move" : "copy", status: "running",
      actorId: 1, sourceRootId: "@115", destRootId: mode === "cloud-move" ? "@115" : "local",
      progressDone: mode === "cloud-move" ? 1 : 0, progressTotal: mode === "cloud-move" ? 3 : 1,
      failedCount: 0, cancelRequested: false, errorMessage: "", createdAtUnix: 1, updatedAtUnix: 1, eventVersion: 1,
      transfer: { phase: "download", file: "current.txt", bytesDone: 400, bytesTotal: mode === "batch" ? 1000 : 0, bytesPerSecond: 100, cancelable: true,
        ...(mode === "batch" ? { scope: "batch", filesDone: 22, filesTotal: 266, percent: 40 } : {}) },
    };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/jobs/events") return route.fulfill({ contentType: "text/event-stream", body: `event: jobs.snapshot\ndata: ${JSON.stringify({ runtimeId: "test", cursor: 1, reset: false, jobs: [job] })}\n\n` });
      const data = path === "/api/init/status" ? { needsInitialization: false } : path === "/api/auth/me" ? { id: 1, username: "test" } : [];
      await route.fulfill({ json: { data } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Jobs", exact: true }).click();
    await page.getByRole("button", { name: "View progress", exact: true }).click();
    const dialog = page.locator('[data-progress-job="transfer-test"]');
    const counter = dialog.getByLabel("File count progress");
    await expect(counter).toHaveText(mode === "batch" ? "23/266" : mode === "pending" ? "-/-" : "2/3");
    if (mode === "batch") {
      const size = dialog.getByText("400 B / 1000 B · 40%", { exact: true });
      await expect(size).toBeVisible();
      expect((await counter.boundingBox())!.y).toBeLessThan((await size.boundingBox())!.y);
      await expect(dialog.getByText(/23\/266/)).toHaveCount(1);
    }
  });
}
