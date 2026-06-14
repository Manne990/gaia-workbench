import { expect, test } from "@playwright/test";

function issuePayload() {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  return {
    title: `V1 Smoke issue ${suffix}`,
    description: "Smoke test issue for core V1 path.",
    status: "Todo",
    priority: "Medium"
  };
}

function updatedIssuePayload() {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  return {
    title: `V1 Smoke issue updated ${suffix}`,
    description: "Smoke test issue after update."
  };
}

test("core V1 workflow smoke path", async ({ page, request }) => {
  const createIssue = issuePayload();
  const updatedIssue = updatedIssuePayload();

  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  await expect(await health.json()).toEqual({
    app: "TinyTracker",
    status: "ok"
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create issue" })).toBeVisible();

  const createRequest = page.waitForResponse((response) => {
    return response.url().endsWith("/api/issues") && response.request().method() === "POST";
  });

  await page.getByLabel("Title").fill(createIssue.title);
  await page.getByLabel("Description").fill(createIssue.description);
  await page.getByLabel("Status").selectOption(createIssue.status);
  await page.getByLabel("Priority").selectOption(createIssue.priority);
  await page.getByRole("button", { name: "Create issue" }).click();
  const createResponse = await createRequest;
  expect(createResponse.ok()).toBe(true);

  const createdIssue = (await createResponse.json()) as {
    id: number;
    title: string;
    status: string;
    priority: string;
  };
  await expect(page.locator(".issue-list-row", { hasText: createdIssue.title })).toContainText("Todo");

  const issueRow = page.locator(".issue-list-row", { hasText: createdIssue.title });
  await issueRow.getByRole("button", { name: `Edit issue ${createdIssue.id}` }).click();

  const editForm = page.locator("form.issue-list-row--editing");
  await expect(editForm).toBeVisible();

  const updateRequest = page.waitForResponse((response) => {
    return (
      response.url().endsWith(`/api/issues/${createdIssue.id}`) &&
      response.request().method() === "PATCH"
    );
  });
  await editForm.getByLabel("Title").fill(updatedIssue.title);
  await editForm.getByLabel("Description").fill(updatedIssue.description);
  await editForm.getByLabel("Status").selectOption("In Progress");
  await editForm.getByLabel("Priority").selectOption("High");
  await editForm.getByRole("button", { name: "Save" }).click();
  await updateRequest;

  const updatedRow = page.locator(".issue-list-row", { hasText: updatedIssue.title });
  await expect(updatedRow).toContainText("In Progress");
  await expect(updatedRow).toContainText("High");

  const searchResponse = await request.get(
    `/api/issues?search=${encodeURIComponent(updatedIssue.title)}&status=In%20Progress`
  );
  expect(searchResponse.ok()).toBe(true);
  const filteredIssues = (await searchResponse.json()) as { id: number; title: string }[];
  expect(Array.isArray(filteredIssues)).toBe(true);
  expect(filteredIssues.some((issue) => issue.id === createdIssue.id)).toBe(true);

  await page.locator(".issue-list-row", { hasText: updatedIssue.title }).getByRole("button", {
    name: `Open issue ${createdIssue.id}`
  }).click();

  await expect(page.getByRole("heading", { name: "Issue details" })).toBeVisible();
  await page.getByLabel("New comment").fill(`Smoke comment ${Date.now()}`);

  const commentRequest = page.waitForResponse((response) => {
    return (
      response.url().endsWith(`/api/issues/${createdIssue.id}/comments`) &&
      response.request().method() === "POST"
    );
  });
  await page.getByRole("button", { name: "Add comment" }).click();
  await commentRequest;

  await expect(page.locator(".comment-list")).toContainText("Smoke comment");

  await page.screenshot({
    path: "test-results/verification/issue-10-core-v1-smoke.png",
    fullPage: true
  });
});
