import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CommentRepository,
  createDatabase,
  IssueRepository,
  type IssueUpdate,
  type NewIssue
} from './db/index.js';

type DemoComment = {
  body: string;
  initialBody?: string;
};

type DemoIssue = NewIssue & {
  createAs?: Pick<NewIssue, 'status' | 'priority'>;
  comments: DemoComment[];
};

export type DemoSeedResult = {
  databasePath: string;
  createdIssues: number;
  skippedIssues: number;
  updatedIssues: number;
  createdComments: number;
  skippedComments: number;
  editedComments: number;
};

const demoIssues: DemoIssue[] = [
  {
    title: 'Demo: Triage onboarding feedback',
    description: 'Group first-run feedback and decide what belongs in the next dashboard pass.',
    status: 'todo',
    priority: 'high',
    labels: ['demo', 'ux'],
    dueDate: null,
    comments: [
      {
        initialBody: 'Feedback arrived from three testers.',
        body: 'Feedback arrived from three testers and is grouped by dashboard area.'
      },
      {
        body: 'Check the filtered-empty state before changing the dashboard copy.'
      }
    ]
  },
  {
    title: 'Demo: Export tracker snapshot',
    description: 'Verify the JSON export includes issues, comments, history, and activity events.',
    status: 'review',
    priority: 'medium',
    createAs: {
      status: 'todo',
      priority: 'low'
    },
    labels: ['demo', 'export'],
    dueDate: '2999-06-30',
    comments: [
      {
        body: 'Download the JSON export after updating this issue to inspect the nested payload.'
      }
    ]
  },
  {
    title: 'Demo: Fix overdue activity review',
    description: 'Review an overdue active item with labels, a due date, and activity history.',
    status: 'in_progress',
    priority: 'high',
    labels: ['demo', 'activity'],
    dueDate: '2000-01-01',
    comments: [
      {
        body: 'This item stays overdue until it is moved to Done.'
      }
    ]
  },
  {
    title: 'Demo: Close resolved mobile polish',
    description: 'A completed issue with a past due date should not appear overdue.',
    status: 'done',
    priority: 'low',
    labels: ['demo', 'mobile'],
    dueDate: '2000-01-01',
    comments: [
      {
        body: 'Mobile layout was checked at 390px wide.'
      }
    ]
  }
];

function defaultDatabasePath(): string {
  return path.resolve(process.cwd(), 'data/tinytracker.sqlite');
}

export function resolveDemoSeedDatabasePath(): string {
  return process.env.DATABASE_PATH ?? defaultDatabasePath();
}

function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ':memory:') {
    return;
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

export function seedDemoData(databasePath = resolveDemoSeedDatabasePath()): DemoSeedResult {
  ensureDatabaseDirectory(databasePath);

  const database = createDatabase(databasePath);
  const issueRepository = new IssueRepository(database);
  const commentRepository = new CommentRepository(database);
  const result: DemoSeedResult = {
    databasePath,
    createdIssues: 0,
    skippedIssues: 0,
    updatedIssues: 0,
    createdComments: 0,
    skippedComments: 0,
    editedComments: 0
  };

  try {
    const issuesByTitle = new Map(issueRepository.list().map((issue) => [issue.title, issue]));

    for (const demoIssue of demoIssues) {
      let issue = issuesByTitle.get(demoIssue.title);

      if (issue) {
        result.skippedIssues += 1;
      } else {
        issue = issueRepository.create({
          ...demoIssue,
          status: demoIssue.createAs?.status ?? demoIssue.status,
          priority: demoIssue.createAs?.priority ?? demoIssue.priority
        });
        issuesByTitle.set(issue.title, issue);
        result.createdIssues += 1;

        const finalUpdate: IssueUpdate = {};
        if (demoIssue.status !== undefined && issue.status !== demoIssue.status) {
          finalUpdate.status = demoIssue.status;
        }
        if (demoIssue.priority !== undefined && issue.priority !== demoIssue.priority) {
          finalUpdate.priority = demoIssue.priority;
        }

        if (Object.keys(finalUpdate).length > 0) {
          issue = issueRepository.update(issue.id, finalUpdate) ?? issue;
          result.updatedIssues += 1;
        }
      }

      const existingCommentBodies = new Set(
        commentRepository.listByIssueId(issue.id).map((comment) => comment.body)
      );

      for (const comment of demoIssue.comments) {
        if (existingCommentBodies.has(comment.body)) {
          result.skippedComments += 1;
          continue;
        }

        const createdComment = commentRepository.create({
          issueId: issue.id,
          body: comment.initialBody ?? comment.body
        });
        result.createdComments += 1;

        if (comment.initialBody !== undefined && comment.initialBody !== comment.body) {
          commentRepository.update(createdComment.id, { body: comment.body });
          result.editedComments += 1;
        }

        existingCommentBodies.add(comment.body);
      }
    }

    return result;
  } finally {
    database.close();
  }
}

if (isMainModule()) {
  const result = seedDemoData();

  console.log(
    [
      `TinyTracker demo seed complete (${result.databasePath})`,
      `issues created: ${result.createdIssues}`,
      `issues skipped: ${result.skippedIssues}`,
      `issue transitions recorded: ${result.updatedIssues}`,
      `comments created: ${result.createdComments}`,
      `comments skipped: ${result.skippedComments}`,
      `comment edits recorded: ${result.editedComments}`
    ].join('\n')
  );
}
