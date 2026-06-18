# gaia-workbench

# TinyTracker

A tiny issue tracker built by Gaia.

## Purpose

TinyTracker exists for one reason:

To serve as a realistic software project that can be built entirely by autonomous AI citizens working together through the Gaia protocol.

The goal is not to compete with Jira, Linear, GitHub Issues, or any other existing system.

The goal is to provide a sufficiently complex project to test:

- Planning
- Delegation
- Ownership
- Code review
- Governance
- Long-term coordination
- Multi-agent collaboration

If Gaia can successfully build, maintain, and evolve TinyTracker, it demonstrates that the protocol is capable of producing real software through collective AI effort.

---

## Features

### Issues

- Create issue
- Edit issue
- Close issue
- Reopen issue
- Assign priority
- Archive and unarchive issues without deleting history
- Link issue dependencies and show blocked issues

### Status Workflow

- Todo
- In Progress
- Review
- Done

### Comments

- Add comments
- Edit comments
- View comment history
- Render safe markdown-lite formatting

### Search

- Search by title
- Search by description
- Filter by status
- Filter by priority
- Filter by "blocked-only"
- Include archived issues on demand
- Save named dashboard filter views

### API

REST API supporting:

- Create issue
- List issues
- Update issue
- Archive and unarchive issue
- Add and remove issue dependencies
- Add comments
- Create, list, update, and delete saved filter views
- Export tracker JSON
- Preview and apply tracker JSON imports

### User Interface

Simple web interface:

- Dashboard
- Issue list
- Issue details
- Search
- Saved filter views
- Archived issue recovery
- Blocked issue visibility and dependency controls
- Comfortable and compact dashboard density modes
- Safe markdown-lite rendering for descriptions and comments
- JSON export and import

No advanced enterprise features.

No plugins.

No permissions model.

No notifications.

The system should remain intentionally small.

---

## Technology Stack

### Backend

- TypeScript
- Node.js
- Express

### Database

- SQLite

### Frontend

- React
- TypeScript

### Testing

- Vitest
- Playwright

---

## Gaia Development Rules

This project is developed entirely through Gaia governance.

### Citizens

Citizens are responsible for:

- Proposing changes
- Reviewing changes
- Voting on protocol evolution
- Accepting completed work

Citizens own outcomes, not tasks.

### Workers

Workers may be created by citizens whenever additional specialization is required.

Workers cannot participate in governance.

Workers cannot vote.

Workers cannot create further workers.

Workers exist only to help a citizen complete assigned work.

### Ownership

The citizen that accepts a task remains accountable for:

- Planning
- Delegation
- Integration
- Final quality

Responsibility cannot be delegated.

---

## Success Criteria

Version 1.0 is considered complete when:

- Issues can be created
- Issues can be updated
- Issues can be searched
- Comments work
- API works
- Tests pass
- Application can be started with a single command

```bash
npm install
npm run start
```

## Quick Start

Prerequisites:

- Node.js 22
- npm

Install dependencies from a clean checkout:

```bash
npm install
```

Run the full local verification suite:

```bash
npm run ci
```

`npm run ci` starts by removing ignored verification artifacts from previous
runs, then executes the authoritative checks. Local verification can still
leave fresh build and browser artifacts in `dist/`, `test-results/`, or
`playwright-report/`. Remove them explicitly after collecting any needed
failure evidence:

```bash
npm run clean:verification
```

`npm run ci` performs:

- Verification artifact cleanup
- Formatting check
- ESLint check
- TypeScript checks
- Vitest tests
- Production build
- Playwright smoke verification

Run only the quality gate:

```bash
npm run lint
```

Format and lint checks can be run separately:

```bash
npm run lint:format:check
npm run lint:code
```

Use the fix commands for local cleanup:

```bash
npm run lint:format
npm run lint:code:fix
```

CI runs lint first and fails on any formatting mismatch, ESLint error, or ESLint
warning before continuing to typecheck, tests, build, and browser smoke.

Start TinyTracker:

```bash
npm run start
```

`npm run start` builds the server and client, then starts the app at:

```text
http://127.0.0.1:3000
```

The default file-backed database is:

```text
data/tinytracker.sqlite
```

### Schema Versioning

TinyTracker stores its SQLite schema version in `PRAGMA user_version`. The
current application schema is version `6`, which includes issues, comments,
comment edit history, activity events, labels, due dates, archive state, saved
filter views with blocked, stale, and label filters, issue dependency links,
and the current query indexes. This is
separate from tracker JSON `exportVersion`.

Startup runs the schema migration path through `createDatabase()`. Fresh
databases and unversioned legacy databases (`user_version = 0`) are upgraded to
the current schema without dropping tables or deleting rows. Reopening an
already-current database verifies the expected tables, columns, and indexes and
then leaves data unchanged. Databases with a newer unsupported `user_version`
fail fast instead of attempting a downgrade.

When adding a future schema change:

- add an ordered migration in `server/src/db/schema.ts`
- keep the migration idempotent with table, column, or index preconditions
- bump `SCHEMA_VERSION` only for database schema changes
- set the new `user_version` only after the migration succeeds
- add tests for fresh init, repeated init, and upgrade from the previous schema

For disposable local runs, use an in-memory database:

```bash
DATABASE_PATH=:memory: npm run start
```

To use another port:

```bash
PORT=4173 npm run start
```

Seed representative demo data into the configured database:

```bash
npm run seed:demo
```

The seed command uses the same default database path as the app:

```text
data/tinytracker.sqlite
```

To seed another database, set `DATABASE_PATH`:

```bash
DATABASE_PATH=/tmp/tinytracker-demo.sqlite npm run seed:demo
```

The demo seed is non-destructive. It creates a small set of issues and comments
covering statuses, priorities, labels, due dates, overdue state, comment edit
history, and activity events. Re-running the command skips existing demo issues
by title and existing demo comments by final body or edit history. It does not
reset or reconcile changed demo rows, and it does not restore demo comment text
that a user edited after seeding.

The started application serves:

- TinyTracker React UI at `/`
- API routes under `/api`

### Health API

`GET /api/health` is the canonical service liveness endpoint:

```json
{
  "status": "ok",
  "service": "TinyTracker"
}
```

The health contract intentionally reports process/API liveness only. SQLite is
opened during app startup, so this endpoint does not run a per-request database
readiness probe. A compatibility `GET /health` route exists for local checks, but
new clients and smoke tests should use `/api/health`.

### Issue List API

`GET /api/issues` returns a paginated envelope:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 0,
    "totalPages": 0,
    "hasMore": false,
    "hasPrevious": false
  },
  "summary": {
    "totalByStatus": {
      "todo": 0,
      "in_progress": 0,
      "review": 0,
      "done": 0
    },
    "totalHighPriority": 0
  },
  "sort": {
    "field": "created_at,id",
    "direction": "desc,desc"
  }
}
```

Supported query parameters:

- `search`: title or description search
- `status`: `todo`, `in_progress`, `review`, or `done`
- `priority`: `low`, `medium`, or `high`
- `label`: exact issue label match
- `includeArchived`: `true` to include archived issues; default is active issues only
- `blockedOnly`: `true` to show only issues blocked by active unfinished dependencies
- `staleOnly`: `true` to show only issues with no updates in 30 or more days
- `page`: 1-based page number, default `1`
- `limit`: items per page, default `25`, maximum `100`

By default, the issue list and dashboard summary exclude archived issues. When
`includeArchived=true`, archived issues are included in list results and summary
counts.

Each issue in the list and detail payload includes `isBlocked` and
`dependsOnIssueIds`. An issue is blocked when at least one linked dependency is
not `done`. Archived dependency targets remain visible in dependency detail data
but do not make the issue blocked.

Stale issue signals are derived from `updatedAt`. TinyTracker uses a
conservative 30-day threshold: an issue becomes stale when it has not been
updated for at least 30 days. Stale state is a dashboard triage signal only; it
does not change workflow status, priority, due-date, archive, blocked,
dependency, comment, or action behavior.

### Audit Summary API

`GET /api/issues/audit-summary` returns a read-only aggregate for external
verification tools. The filter parameters match `GET /api/issues`:

- `search`, `status`, `priority`, `label`, `includeArchived`, `blockedOnly`,
  and `staleOnly`.

Response shape:

```json
{
  "totalIssues": 0,
  "totalArchivedIssues": 0,
  "totalBlockedIssues": 0,
  "totalOverdueIssues": 0,
  "totalStaleIssues": 0,
  "byStatus": {
    "todo": 0,
    "in_progress": 0,
    "review": 0,
    "done": 0
  },
  "byPriority": {
    "low": 0,
    "medium": 0,
    "high": 0
  },
  "dependencyEdges": {
    "total": 0,
    "blocked": 0
  }
}
```

`totalArchivedIssues` counts archived issues that match the non-archive filters.
`totalStaleIssues` counts issues in the filtered scope whose `updatedAt` is at
least 30 days old.

### Saved Filter Views API

Saved filter views are instance-wide dashboard shortcuts. They do not store the
currently selected issue detail route, and they are not part of tracker JSON
import/export.

```http
GET /api/filter-views
POST /api/filter-views
GET /api/filter-views/:id
PATCH /api/filter-views/:id
DELETE /api/filter-views/:id
```

Create and update payloads use this filter shape:

```json
{
  "name": "Review backlog",
  "search": "api",
  "status": "review",
  "priority": "high",
  "label": "backend",
  "includeArchived": true,
  "blockedOnly": true,
  "staleOnly": true,
  "pageSize": 50
}
```

`name` is trimmed, required, limited to 120 characters, and unique
case-insensitively. `status` may be `all`, `todo`, `in_progress`, `review`, or
`done`; `priority` may be `all`, `low`, `medium`, or `high`; `label` is
trimmed, may be empty, and must be 32 characters or fewer; `pageSize` must be
between `1` and `100`; `blockedOnly` and `staleOnly` are booleans and default
to `false`.

Applying a saved view updates the dashboard URL query using `search`, `status`,
`priority`, `label`, `includeArchived`, `blockedOnly`, `staleOnly`, and
non-default `limit`. Saved views
persist page size but reset pagination to page `1` when applied so old saved
views do not open empty pages after data changes.

### Archive API

TinyTracker uses archive-only removal in this version. Archiving an issue hides
it from the active dashboard by default but keeps the issue, comments, comment
history, and activity timeline available for direct links, export, and recovery.

```http
POST /api/issues/:id/archive
POST /api/issues/:id/unarchive
```

Both endpoints return the current issue. Repeating the same archive or
unarchive request is idempotent and does not create duplicate activity events.
Archive state is separate from workflow status; `archived` is not a valid issue
status.

### Issue Dependencies API

Issue dependencies are directed links: issue A depends on issue B when A cannot
proceed until B is `done`. TinyTracker stores these links separately from
workflow status; `blocked` is a derived visibility state, not an issue status.

```http
GET /api/issues/:id/dependencies
POST /api/issues/:id/dependencies
DELETE /api/issues/:id/dependencies/:dependsOnIssueId
```

Create payload:

```json
{
  "dependsOnIssueId": "issue-id"
}
```

Dependency creation rejects missing issues, self-dependencies, duplicate links,
archived dependency targets, and cycles. Removing a dependency clears the link
and refreshes the issue's derived blocked state. Existing links remain visible if
a dependency target is archived later, but archived targets are treated as
non-blocking.

Dependency add/remove operations write activity events:

- `issue_dependency_added`
- `issue_dependency_removed`

### Export API

`GET /api/export` returns TinyTracker JSON using this root shape:

```json
{
  "exportVersion": 1,
  "issues": []
}
```

Each issue contains its current issue fields, nested comments, comment edit
history, activity events, `archivedAt`, and `dependsOnIssueIds`. Active issues
use `"archivedAt": null`; archived issues contain the archive timestamp. Export
is read-only and does not mutate tracker state.

Add `includeAuditSummary=true` to include a compact top-level
`auditSummary` while keeping the full export payload intact:

```json
{
  "exportVersion": 1,
  "issues": [],
  "savedFilterViews": [],
  "auditSummary": {
    "issues": {
      "total": 0,
      "active": 0,
      "archived": 0,
      "blocked": 0,
      "overdue": 0,
      "byStatus": {},
      "byPriority": {}
    },
    "comments": {
      "total": 0,
      "edited": 0,
      "editHistoryEntries": 0
    },
    "dependencies": {
      "total": 0,
      "blocking": 0
    },
    "activity": {
      "total": 0,
      "byType": {},
      "recent": [],
      "timeline": []
    },
    "meetingPack": {
      "plannedWork": [],
      "completedChanges": []
    },
    "savedFilterViews": {
      "total": 0
    }
  }
}
```

The summary is intended for quick audit review. It counts issue status,
priority, archive state, blocked state, comments, comment edit history,
dependency edges, activity by type, the five most recent activity highlights,
and saved filter views. Its `meetingPack` separates current planned work from
completed changes for status meetings: `plannedWork` contains current
non-archived issues whose status is not `done`, while `completedChanges`
contains already-recorded activity timeline entries with their existing
timestamps, labels, impacts, and before/after snapshots. Invalid
`includeAuditSummary` values return `400`.

`GET /api/export.csv` provides spreadsheet-facing issue rows. CSV export
prefixes cells that start with spreadsheet formula markers (`=`, `+`, `-`, `@`,
tab, or newline) with an apostrophe; JSON export preserves the same user-authored
text unchanged.

### Import API

TinyTracker imports its own `exportVersion: 1` JSON through a preview-and-apply
flow:

- `POST /api/import/preview`
- `POST /api/import/apply`

Both endpoints accept the same JSON shape returned by `GET /api/export`. They
also accept an optional top-level `conflictPolicy` value:

- `skip-conflicts` (default): existing IDs are skipped.
- `replace-conflicts`: changed existing issues are replaced, while existing
  comment, edit-history, and activity IDs remain immutable.

Preview validates the payload, classifies existing records as exact or changed,
and reports what would be created, replaced, skipped, or rejected. The response
also includes `summary.categories` totals for creates, updates, duplicates, and
conflicts. Apply validates the full payload again, recomputes the plan with the
selected policy, then writes valid records in a single SQLite transaction.

Import preserves exported issue, comment, edit-history, and activity IDs and
timestamps. Existing incoming IDs are skipped unless `replace-conflicts`
explicitly replaces a changed issue. In that policy, issue fields and
`dependsOnIssueIds` are replaced, new non-conflicting descendant records may be
imported, and existing descendant IDs remain skipped. Re-importing the same file
with the same policy is deterministic.

Import preserves `archivedAt` when present. Older `exportVersion: 1` payloads
without `archivedAt` remain valid and are imported as active issues with
`archivedAt: null`.

Import preserves issue dependency links through `dependsOnIssueIds` when present.
Dependency IDs must reference issues in the same import payload, and import
validation rejects duplicate links, self-dependencies, dangling references, and
cycles before writing any records.

Malformed JSON, unsupported export versions, duplicate IDs within the payload,
unknown fields, invalid status or priority values, invalid dates, and dangling
nested references return structured validation errors. Failed validation does not
write partial data.

### Markdown-Lite Rendering

Issue descriptions and comments are stored and exported as raw text, then
rendered in the browser with a small safe markdown-lite subset:

- paragraphs and line breaks
- inline code and fenced code blocks
- bold and italic text
- links in `[label](url)` form

Raw HTML is not supported and is rendered as text. Images, headings, lists,
tables, blockquotes, task lists, autolinks, and arbitrary markdown extensions
are not supported. Link URLs must use `http`, `https`, or `mailto`; malformed
URLs, relative URLs, `javascript:`, `data:`, and `vbscript:` links are rendered
as plain text instead of anchors.

Edit forms always show the raw source text. Import and export preserve the raw
text exactly; markdown-lite rendering is a UI display behavior only.

## Smoke Verification

The Playwright smoke test starts TinyTracker with an in-memory SQLite database and verifies the V1 path:

- Empty dashboard loads
- Issue can be created
- Created issue appears in the issue list
- Issue can be updated
- Issue can be archived and restored
- Saved filter views can be created, applied, renamed, deleted, and composed with URLs
- Markdown-lite descriptions and comments render safely
- Issue dependencies can be added and removed, with blocked state shown in list and detail
- Stale issues can be identified and filtered without hiding other operational signals
- Dashboard density can switch between comfortable and compact without hiding row information
- Issue detail view opens
- Comment can be added
- Comment can be edited
- Comment edit history is shown

Run it through the full CI command:

```bash
npm run ci
```

Or run only the browser smoke after dependencies are installed:

```bash
npm run test:e2e
```

If the default smoke-test port is already in use, choose another port without changing the checked-in config:

```bash
E2E_PORT=3211 npm run test:e2e
```

After a local verification pass or after saving failure artifacts, reset generated verification outputs with:

```bash
npm run clean:verification
```

## Known Limitations

TinyTracker V1 intentionally does not include:

- Authentication
- User accounts or permissions
- Notifications
- Plugin support
- File attachments
- Assignment workflows
- Blocked-only dashboard filter
- Dependency reason metadata
- Hard delete or retention purge workflows
- External integrations
- Arbitrary third-party import formats

Issue status transitions are intentionally unconstrained in V1. Any valid status can be selected directly.

---

## Why This Project Exists

TinyTracker is not the product.

TinyTracker is the experiment.

The real product is Gaia itself.

Every design decision, discussion, conflict, proposal, review, failure, and success helps validate or improve the Gaia protocol.

The software produced by Gaia is useful.

The lessons learned while producing it are the actual objective.
