import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { IssueRepository } from "./db/repository.js";
import { initializeDatabase } from "./db/schema.js";

let db: Database.Database;
let repository: IssueRepository;
let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    server = undefined;
  }

  db.close();
});

beforeEach(() => {
  db = new Database(":memory:");
  initializeDatabase(db);
  repository = new IssueRepository(db, () => "2026-06-14T00:00:00.000Z");
});

function repositoryIssueFixture() {
  return {
    title: "Add issue API",
    description: "Expose REST endpoints backed by SQLite.",
    status: "Todo",
    priority: "Medium"
  };
}

async function startTestServer() {
  server = createServer(createApp({ repository }));

  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected test server to listen on a TCP port.");
  }

  return address as AddressInfo;
}

async function createIssue(address: AddressInfo, body: Record<string, unknown>) {
  return fetch(`http://127.0.0.1:${address.port}/api/issues`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

describe("TinyTracker API", () => {
  it("reports health status", async () => {
    const address = await startTestServer();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      app: "TinyTracker",
      status: "ok"
    });
  });

  it("creates, lists, and reads issues", async () => {
    const address = await startTestServer();
    const createResponse = await createIssue(address, repositoryIssueFixture());
    const createdIssue = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createdIssue).toMatchObject({
      id: 1,
      title: "Add issue API",
      description: "Expose REST endpoints backed by SQLite.",
      status: "Todo",
      priority: "Medium"
    });

    const listResponse = await fetch(`http://127.0.0.1:${address.port}/api/issues`);
    const listPayload = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listPayload).toEqual([createdIssue]);

    const getResponse = await fetch(`http://127.0.0.1:${address.port}/api/issues/${createdIssue.id}`);
    const loadedIssue = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(loadedIssue).toEqual(createdIssue);
  });

  it("updates an issue by id", async () => {
    const address = await startTestServer();
    const createResponse = await createIssue(address, {
      ...repositoryIssueFixture(),
      status: "In Progress"
    });
    const issue = await createResponse.json();

    const updateResponse = await fetch(`http://127.0.0.1:${address.port}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: "Issue API complete",
        status: "Review",
        priority: "High"
      })
    });
    const updated = await updateResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updated).toMatchObject({
      id: issue.id,
      title: "Issue API complete",
      description: "Expose REST endpoints backed by SQLite.",
      status: "Review",
      priority: "High"
    });
  });

  it("supports close and reopen through status updates and explicit closed field", async () => {
    const address = await startTestServer();
    const createResponse = await createIssue(address, repositoryIssueFixture());
    const issue = await createResponse.json();

    const closeByStatus = await fetch(`http://127.0.0.1:${address.port}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: "Done" })
    });
    const closedIssue = await closeByStatus.json();
    expect(closeByStatus.status).toBe(200);
    expect(closedIssue).toMatchObject({ id: issue.id, status: "Done" });

    const reopenByStatus = await fetch(`http://127.0.0.1:${address.port}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: "Todo" })
    });
    const reopenedIssue = await reopenByStatus.json();
    expect(reopenByStatus.status).toBe(200);
    expect(reopenedIssue).toMatchObject({ id: issue.id, status: "Todo" });

    const closeByExplicitField = await fetch(
      `http://127.0.0.1:${address.port}/api/issues/${issue.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ closed: true })
      }
    );
    const explicitClosedIssue = await closeByExplicitField.json();
    expect(closeByExplicitField.status).toBe(200);
    expect(explicitClosedIssue).toMatchObject({ id: issue.id, status: "Done" });

    const reopenByExplicitField = await fetch(
      `http://127.0.0.1:${address.port}/api/issues/${issue.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ closed: false })
      }
    );
    const explicitOpenIssue = await reopenByExplicitField.json();
    expect(reopenByExplicitField.status).toBe(200);
    expect(explicitOpenIssue).toMatchObject({ id: issue.id, status: "Todo" });
  });

  it("returns 404 for unknown issue IDs", async () => {
    const address = await startTestServer();

    const response = await fetch(`http://127.0.0.1:${address.port}/api/issues/999`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Issue not found."
    });
  });

  it("validates required fields and enums", async () => {
    const address = await startTestServer();

    const noTitle = await createIssue(address, { description: "Missing title." });
    expect(noTitle.status).toBe(400);
    await expect(noTitle.json()).resolves.toMatchObject({
      error: "Invalid request payload.",
      details: "title is required and must be a non-empty string."
    });

    const badStatus = await createIssue(address, {
      title: "Invalid status",
      status: "In-Progress"
    });
    expect(badStatus.status).toBe(400);
    await expect(badStatus.json()).resolves.toMatchObject({
      error: "Invalid request payload.",
      details: "status must be Todo, In Progress, Review, or Done."
    });

    const createResponse = await createIssue(address, repositoryIssueFixture());
    const issue = await createResponse.json();
    const badUpdate = await fetch(`http://127.0.0.1:${address.port}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ priority: "Critical" })
    });
    expect(badUpdate.status).toBe(400);
    await expect(badUpdate.json()).resolves.toMatchObject({
      error: "Invalid request payload.",
      details: "priority must be Low, Medium, or High."
    });

    const badClosed = await fetch(`http://127.0.0.1:${address.port}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ closed: "yes" })
    });
    expect(badClosed.status).toBe(400);
    await expect(badClosed.json()).resolves.toMatchObject({
      error: "Invalid request payload.",
      details: "closed must be true or false."
    });
  });
});
