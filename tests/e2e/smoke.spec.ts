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

function uniqueIssue() {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  return {
    title: `Issue ${suffix}-mutable`,
    description: "Issue for create/edit flow.",
    status: "Todo",
    priority: "Low"
  };
}

function invalidIssue() {
  return {
    title: "",
    description: "Missing title should fail.",
    status: "Todo",
    priority: "Medium"
  };
}

function uniqueComment() {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  return {
    body: `Comment body ${suffix}`
  };
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
});

test("shows loading state while issues are loading", async ({ page }) => {
  const responseBody = JSON.stringify([]);
  let responded = false;

  await page.route("**/api/issues", async (route) => {
    responded = true;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 200, contentType: "application/json", body: responseBody });
  });

  await page.goto("/");

  await expect(page.getByText("Loading issues...")).toBeVisible();
  await expect(async () => {
    expect(responded).toBe(true);
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

test("creates a new issue and updates the list", async ({ page }) => {
  const payload = uniqueIssue();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Create issue" })).toBeVisible();

  await page.getByLabel("Title").fill(payload.title);
  await page.getByLabel("Description").fill(payload.description);
  await page.getByLabel("Status").selectOption(payload.status);
  await page.getByLabel("Priority").selectOption(payload.priority);

  const createRequest = page.waitForResponse((response) => {
    return response.url().endsWith("/api/issues") && response.request().method() === "POST";
  });
  await page.getByRole("button", { name: "Create issue" }).click();
  await createRequest;

  const createdRow = page.locator(".issue-list-row", { hasText: payload.title });
  await expect(createdRow).toBeVisible();
  await expect(createdRow).toContainText(payload.status);
  await expect(createdRow).toContainText(payload.priority);
  await page.screenshot({
    path: "test-results/verification/issue-8-create.png",
    fullPage: true
  });
});

test("edits an issue in place", async ({ page, request }) => {
  const payload = uniqueIssue();
  const created = await request.post("/api/issues", { data: payload });
  const createdPayload = (await created.json()) as { id: number; title: string };

  await page.goto("/");

  const row = page.locator(".issue-list-row", { hasText: createdPayload.title }).first();
  await row.getByRole("button", { name: "Edit" }).click();

  const editForm = page.locator(`form.issue-list-row--editing`);
  const editedTitle = `${payload.title}-edited`;

  await editForm.getByLabel(`Title`).fill(editedTitle);
  await editForm.getByLabel(`Description`).fill(`${payload.description} Updated.`);
  await editForm.getByLabel("Status").selectOption("In Progress");
  await editForm.getByLabel("Priority").selectOption("High");
  const editRequest = page.waitForResponse((response) => {
    return response.url().endsWith(`/api/issues/${createdPayload.id}`) && response.request().method() === "PATCH";
  });
  await editForm.getByRole("button", { name: "Save" }).click();
  await editRequest;

  const updatedRow = page.locator(".issue-list-row", { hasText: editedTitle });
  await expect(updatedRow).toBeVisible();
  await expect(updatedRow).toContainText("In Progress");
  await expect(updatedRow).toContainText("High");
  await page.screenshot({
    path: "test-results/verification/issue-8-edit.png",
    fullPage: true
  });
});

test("opens issue details from the list", async ({ page, request }) => {
  const payload = uniqueIssue();
  const created = await request.post("/api/issues", { data: payload });
  const issue = (await created.json()) as { id: number; title: string; description: string };

  await page.goto("/");

  await page.locator(".issue-list-row", { hasText: issue.title }).getByRole("button", {
    name: `Open issue ${issue.id}`
  }).click();

  await expect(page.getByRole("heading", { name: "Issue details" })).toBeVisible();
  const detailPanel = page.locator("section[aria-labelledby='issue-detail-title']");

  await expect(detailPanel.getByText(issue.title)).toBeVisible();
  await expect(detailPanel.getByText(payload.description)).toBeVisible();
  await expect(detailPanel.locator(".issue-detail-meta").getByText(payload.status)).toBeVisible();
  await expect(detailPanel.locator(".issue-detail-meta").getByText(payload.priority)).toBeVisible();
  await page.screenshot({
    path: "test-results/verification/issue-9-open-details.png",
    fullPage: true
  });
});

test("adds a comment in issue detail", async ({ page, request }) => {
  const issuePayload = uniqueIssue();
  const created = await request.post("/api/issues", { data: issuePayload });
  const issue = (await created.json()) as { id: number };
  const comment = uniqueComment();

  await page.goto("/");
  await page.locator(".issue-list-row", { hasText: issuePayload.title }).getByRole("button", {
    name: `Open issue ${issue.id}`
  }).click();

  await page.getByLabel("New comment").fill(comment.body);

  const commentCreateRequest = page.waitForResponse((response) => {
    return response.url().endsWith(`/api/issues/${issue.id}/comments`) && response.request().method() === "POST";
  });
  await page.getByRole("button", { name: "Add comment" }).click();
  await commentCreateRequest;

  await expect(page.locator(".comment-list", { hasText: comment.body })).toBeVisible();
  await page.screenshot({
    path: "test-results/verification/issue-9-add-comment.png",
    fullPage: true
  });
});

test("edits a comment in issue detail", async ({ page, request }) => {
  const issuePayload = uniqueIssue();
  const issueResponse = await request.post("/api/issues", { data: issuePayload });
  const issue = (await issueResponse.json()) as { id: number };
  const commentResponse = await request.post(`/api/issues/${issue.id}/comments`, {
    data: { body: "Original issue-9 comment." }
  });
  const comment = (await commentResponse.json()) as { id: number; body: string };

  await page.goto("/");
  await page.locator(".issue-list-row", { hasText: issuePayload.title }).getByRole("button", {
    name: `Open issue ${issue.id}`
  }).click();

  const row = page.locator(".comment-row");
  await row.getByRole("button", { name: "Edit" }).click();

  const commentEditForm = page.locator("form.comment-edit-form");
  await commentEditForm.getByRole("textbox").fill("Revised issue-9 comment.");

  const commentUpdateRequest = page.waitForResponse((response) => {
    return response.url().endsWith(`/api/comments/${comment.id}`) && response.request().method() === "PATCH";
  });
  await commentEditForm.getByRole("button", { name: "Save" }).click();
  await commentUpdateRequest;

  await expect(commentEditForm).toHaveCount(0);
  await expect(page.locator(".comment-list")).toContainText("Revised issue-9 comment.");
  await page.screenshot({
    path: "test-results/verification/issue-9-edit-comment.png",
    fullPage: true
  });
});

test("inspects comment history", async ({ page, request }) => {
  const issuePayload = uniqueIssue();
  const issueResponse = await request.post("/api/issues", { data: issuePayload });
  const issue = (await issueResponse.json()) as { id: number };

  const commentCreate = await request.post(`/api/issues/${issue.id}/comments`, {
    data: { body: "History draft comment." }
  });
  const comment = (await commentCreate.json()) as { id: number };

  await request.patch(`/api/comments/${comment.id}`, {
    data: { body: "History first edit." }
  });
  await request.patch(`/api/comments/${comment.id}`, {
    data: { body: "History second edit." }
  });

  await page.goto("/");
  await page.locator(".issue-list-row", { hasText: issuePayload.title }).getByRole("button", {
    name: `Open issue ${issue.id}`
  }).click();

  const row = page.locator(".comment-row").first();

  await row.getByRole("button", { name: "Show history" }).click();

  await expect(row.locator(".comment-history-list")).toBeVisible();
  await expect(row.getByText("History draft comment.")).toBeVisible();
  await expect(row.getByText("History first edit.")).toBeVisible();

  await page.screenshot({
    path: "test-results/verification/issue-9-comment-history.png",
    fullPage: true
  });
});

test("shows API validation errors on invalid submission", async ({ page }) => {
  const payload = invalidIssue();

  await page.goto("/");
  await page.getByLabel("Title").fill(payload.title);
  await page.getByLabel("Description").fill(payload.description);
  await page.getByLabel("Status").selectOption(payload.status);
  await page.getByLabel("Priority").selectOption(payload.priority);
  await page.getByRole("button", { name: "Create issue" }).click();

  const errorMessage = page.locator(".form-message--error");
  await expect(errorMessage).toContainText("title is required and must be a non-empty string.");
  await page.screenshot({
    path: "test-results/verification/issue-8-validation-error.png",
    fullPage: true
  });
});
