import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { IssueRepository, issuePriorities, issueStatuses, type UpdateIssueInput } from "./db/repository.js";
import { openDatabase } from "./db/connection.js";

export interface CreateAppOptions {
  repository?: IssueRepository;
}

const VALIDATION_SUMMARY = "Invalid request payload.";

function isIssueStatus(value: unknown): value is (typeof issueStatuses)[number] {
  return typeof value === "string" && (issueStatuses as readonly string[]).includes(value);
}

function isIssuePriority(value: unknown): value is (typeof issuePriorities)[number] {
  return typeof value === "string" && (issuePriorities as readonly string[]).includes(value);
}

function parseIssueId(raw: string): number {
  const id = Number(raw);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid issue id.");
  }

  return id;
}

function parseCreateBody(body: unknown): {
  title: string;
  description: string;
  status?: (typeof issueStatuses)[number];
  priority?: (typeof issuePriorities)[number];
  closed?: boolean;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object.");
  }

  const typedBody = body as Record<string, unknown>;
  const title = typedBody.title;

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("title is required and must be a non-empty string.");
  }

  const description = typedBody.description;
  if (description !== undefined && typeof description !== "string") {
    throw new Error("description must be a string.");
  }

  const status = typedBody.status;
  if (status !== undefined && !isIssueStatus(status)) {
    throw new Error("status must be Todo, In Progress, Review, or Done.");
  }

  const priority = typedBody.priority;
  if (priority !== undefined && !isIssuePriority(priority)) {
    throw new Error("priority must be Low, Medium, or High.");
  }

  const closed = parseIssueClosedField(typedBody.closed);
  if (closed !== undefined) {
    if (status !== undefined && status !== (closed ? "Done" : "Todo")) {
      throw new Error("status must be consistent with closed.");
    }
  }

  return {
    title: title.trim(),
    description: description ?? "",
    status: resolveClosedStatus({
      status: status as (typeof issueStatuses)[number] | undefined,
      closed
    }),
    priority: priority as (typeof issuePriorities)[number] | undefined,
    closed
  };
}

function parseUpdateBody(body: unknown): UpdateIssueInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object.");
  }

  const typedBody = body as Record<string, unknown>;
  const allowed = new Set(["title", "description", "status", "priority", "closed"]);
  const extraKeys = Object.keys(typedBody).filter((key) => !allowed.has(key));
  if (extraKeys.length > 0) {
    throw new Error(`Unknown fields: ${extraKeys.join(", ")}.`);
  }

  const input: UpdateIssueInput = {};
  const hasAnyField = Object.keys(typedBody).length > 0;

  if (!hasAnyField) {
    throw new Error("At least one field must be provided.");
  }

  if ("title" in typedBody) {
    const title = typedBody.title;
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new Error("title must be a non-empty string.");
    }
    input.title = title.trim();
  }

  if ("description" in typedBody) {
    const description = typedBody.description;
    if (description !== undefined && typeof description !== "string") {
      throw new Error("description must be a string.");
    }
    input.description = description;
  }

  if ("status" in typedBody) {
    const status = typedBody.status;
    if (!isIssueStatus(status)) {
      throw new Error("status must be Todo, In Progress, Review, or Done.");
    }
    input.status = status;
  }

  if ("priority" in typedBody) {
    const priority = typedBody.priority;
    if (!isIssuePriority(priority)) {
      throw new Error("priority must be Low, Medium, or High.");
    }
    input.priority = priority;
  }

  if ("closed" in typedBody) {
    const closed = parseIssueClosedField(typedBody.closed);
    const status = resolveClosedStatus({
      status: input.status,
      closed
    });
    if ("status" in typedBody && status !== input.status) {
      throw new Error("status must be consistent with closed.");
    }
    input.closed = closed;
    input.status = status;
  }

  return input;
}

function parseIssueClosedField(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error("closed must be true or false.");
  }

  return value;
}

function resolveClosedStatus({
  status,
  closed
}: {
  status?: (typeof issueStatuses)[number];
  closed?: boolean;
}): (typeof issueStatuses)[number] | undefined {
  if (closed === undefined) {
    return status;
  }

  return closed ? "Done" : "Todo";
}

function createValidationError(response: Response, message: string) {
  response.status(400).json({
    error: VALIDATION_SUMMARY,
    details: message
  });
}

function createErrorHandler(
  _error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction
) {
  if (response.headersSent) {
    next(_error);
    return;
  }
  response.status(500).json({ error: "Internal server error." });
}

export function createApp({ repository: providedRepository }: CreateAppOptions = {}): Express {
  const app = express();
  const repository = providedRepository ?? new IssueRepository(openDatabase());

  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.status(200).json({
      app: "TinyTracker",
      status: "ok"
    });
  });

  app.post("/api/issues", (request, response) => {
    try {
      const issue = repository.createIssue(parseCreateBody(request.body));
      response.status(201).json(issue);
      return;
    } catch (error) {
      if (error instanceof Error) {
        createValidationError(response, error.message);
        return;
      }
      throw error;
    }
  });

  app.get("/api/issues", (_request, response) => {
    const issues = repository.listIssues();
    response.status(200).json(issues);
  });

  app.get("/api/issues/:id", (request, response) => {
    try {
      const id = parseIssueId(request.params.id);
      const issue = repository.getIssue(id);
      if (!issue) {
        response.status(404).json({ error: "Issue not found." });
        return;
      }
      response.status(200).json(issue);
      return;
    } catch (error) {
      if (error instanceof Error) {
        createValidationError(response, error.message);
        return;
      }
      throw error;
    }
  });

  app.patch("/api/issues/:id", (request, response) => {
    try {
      const id = parseIssueId(request.params.id);
      const issue = repository.updateIssue(id, parseUpdateBody(request.body));
      if (!issue) {
        response.status(404).json({ error: "Issue not found." });
        return;
      }
      response.status(200).json(issue);
      return;
    } catch (error) {
      if (error instanceof Error) {
        createValidationError(response, error.message);
        return;
      }
      throw error;
    }
  });

  app.use(createErrorHandler);

  return app;
}
