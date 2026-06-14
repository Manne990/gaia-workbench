import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssueRepository } from "./repository.js";
import { initializeDatabase, type SqliteDatabase } from "./schema.js";

let db: SqliteDatabase;
let repository: IssueRepository;
let tick = 0;

beforeEach(() => {
  db = new Database(":memory:");
  initializeDatabase(db);
  tick = 0;
  repository = new IssueRepository(db, () => {
    tick += 1;
    return `2026-06-14T00:00:${String(tick).padStart(2, "0")}.000Z`;
  });
});

afterEach(() => {
  db.close();
});

describe("IssueRepository", () => {
  it("creates, reads, updates, and lists issues", () => {
    const issue = repository.createIssue({
      title: "Add persistence",
      description: "Store TinyTracker data in SQLite.",
      priority: "High"
    });

    expect(issue).toMatchObject({
      id: 1,
      title: "Add persistence",
      description: "Store TinyTracker data in SQLite.",
      status: "Todo",
      priority: "High"
    });

    expect(repository.getIssue(issue.id)).toEqual(issue);

    const updated = repository.updateIssue(issue.id, {
      status: "In Progress",
      title: "Add SQLite persistence"
    });

    expect(updated).toMatchObject({
      id: issue.id,
      title: "Add SQLite persistence",
      description: "Store TinyTracker data in SQLite.",
      status: "In Progress",
      priority: "High"
    });
    expect(updated?.updatedAt).not.toEqual(issue.updatedAt);

    expect(repository.listIssues()).toEqual([updated]);
  });

  it("creates and lists comments for an issue", () => {
    const issue = repository.createIssue({
      title: "Comment support"
    });
    const first = repository.addComment({
      issueId: issue.id,
      body: "First note."
    });
    const second = repository.addComment({
      issueId: issue.id,
      body: "Second note."
    });

    expect(repository.listComments(issue.id)).toEqual([first, second]);
  });

  it("validates status and priority values for persistence operations", () => {
    expect(() => {
      repository.createIssue({
        title: "Bad status",
        status: "Not Real" as unknown as "Todo"
      });
    }).toThrow("status must be Todo, In Progress, Review, or Done.");

    const issue = repository.createIssue({
      title: "Valid issue",
      priority: "High"
    });

    expect(() => {
      repository.updateIssue(issue.id, {
        status: "Very High" as unknown as "Todo"
      });
    }).toThrow("status must be Todo, In Progress, Review, or Done.");

    expect(() => {
      repository.updateIssue(issue.id, {
        priority: "Urgent" as unknown as "Low"
      });
    }).toThrow("priority must be Low, Medium, or High.");
  });

  it("supports closing and reopening via explicit closed field", () => {
    const issue = repository.createIssue({ title: "Close via repo" });

    const closed = repository.updateIssue(issue.id, { closed: true });
    expect(closed).toMatchObject({
      id: issue.id,
      status: "Done"
    });

    const reopened = repository.updateIssue(issue.id, { closed: false });
    expect(reopened).toMatchObject({
      id: issue.id,
      status: "Todo"
    });
  });

  it("stores comment edit history when comments are updated", () => {
    const issue = repository.createIssue({
      title: "Comment history"
    });
    const comment = repository.addComment({
      issueId: issue.id,
      body: "Original text."
    });

    const updated = repository.updateComment(comment.id, "Updated text.");

    expect(updated).toMatchObject({
      id: comment.id,
      issueId: issue.id,
      body: "Updated text."
    });
    expect(repository.listCommentEdits(comment.id)).toEqual([
      {
        id: 1,
        commentId: comment.id,
        previousBody: "Original text.",
        editedAt: "2026-06-14T00:00:03.000Z"
      }
    ]);
  });
});
