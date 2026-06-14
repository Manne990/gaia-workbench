import { expect, test } from "@playwright/test";

function issuePayload() {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  return [
    {
      title: `UI issue ${suffix}-alpha`,
      description: "Smoke test issue for dashboard rendering.",
      status: "Todo",
      priority: "High"
    },
    {
      title: `UI issue ${suffix}-beta`,
      description: "Second issue for list layout.",
      status: "In Progress",
      priority: "Medium"
    }
  ] as const;
}

test("renders issue list from real API payload", async ({ page, request }) => {
  const payload = issuePayload();
  await request.post("/api/issues", { data: payload[0] });
  await request.post("/api/issues", { data: payload[1] });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
  await expect(page.getByText(payload[0].title)).toBeVisible();
  await expect(page.getByText(payload[1].title)).toBeVisible();
  await expect(page.locator("article", { hasText: "In progress" })).toBeVisible();
  const firstIssueRow = page.locator(".issue-list-row", { hasText: payload[0].title });
  await expect(firstIssueRow.getByText("Updated:")).toBeVisible();
});

test("shows loading state while issues are loading", async ({ page }) => {
  const responseBody = JSON.stringify([]);
  let respond = false;

  await page.route("**/api/issues", async (route) => {
    respond = true;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 200, contentType: "application/json", body: responseBody });
  });

  await page.goto("/");

  await expect(page.getByText("Loading issues...")).toBeVisible();
  await expect(async () => {
    expect(respond).toBe(true);
  }).toPass();
});

test("shows empty state when no issues are available", async ({ page }) => {
  await page.route("**/api/issues", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.goto("/");

  await expect(page.getByText("No issues yet. Create one to get started.")).toBeVisible();
});

test("shows error state when the API fails", async ({ page }) => {
  await page.route("**/api/issues", (route) => {
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Internal server failure." })
    });
  });

  await page.goto("/");

  await expect(page.getByText("Unable to load issues (HTTP 500).")).toBeVisible();
});
