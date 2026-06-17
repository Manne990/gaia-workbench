import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  NewSavedFilterView,
  SavedFilterPriority,
  SavedFilterStatus,
  SavedFilterView,
  SavedFilterViewUpdate
} from './types.js';

const VALID_SAVED_STATUSES: SavedFilterStatus[] = ['all', 'todo', 'in_progress', 'review', 'done'];
const VALID_SAVED_PRIORITIES: SavedFilterPriority[] = ['all', 'low', 'medium', 'high'];
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_NAME_LENGTH = 120;
const SAVED_FILTER_VIEW_FIELDS = new Set([
  'name',
  'search',
  'status',
  'priority',
  'label',
  'includeArchived',
  'blockedOnly',
  'staleOnly',
  'pageSize'
]);

type SavedFilterViewRow = {
  id: string;
  name: string;
  search: string;
  status: SavedFilterStatus;
  priority: SavedFilterPriority;
  label: string;
  include_archived: 0 | 1;
  blocked_only: 0 | 1;
  stale_only: 0 | 1;
  page_size: number;
  created_at: string;
  updated_at: string;
};

export class DuplicateSavedFilterViewNameError extends Error {
  constructor() {
    super('Saved view name already exists');
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertAllowedSavedFilterViewKeys(input: object): void {
  for (const key of Object.keys(input)) {
    if (!SAVED_FILTER_VIEW_FIELDS.has(key)) {
      throw new Error('Invalid saved view payload');
    }
  }
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Saved view name is required');
  }

  const name = value.trim();

  if (name.length === 0) {
    throw new Error('Saved view name is required');
  }

  if (name.length > MAX_NAME_LENGTH) {
    throw new Error('Invalid saved view name');
  }

  return name;
}

function normalizeSearch(value: unknown): string {
  if (value === undefined) {
    return '';
  }

  if (typeof value !== 'string') {
    throw new Error('Invalid saved view search');
  }

  return value.trim();
}

function normalizeStatus(value: unknown): SavedFilterStatus {
  if (value === undefined) {
    return 'all';
  }

  if (typeof value !== 'string' || !VALID_SAVED_STATUSES.includes(value as SavedFilterStatus)) {
    throw new Error('Invalid saved view status');
  }

  return value as SavedFilterStatus;
}

function normalizePriority(value: unknown): SavedFilterPriority {
  if (value === undefined) {
    return 'all';
  }

  if (typeof value !== 'string' || !VALID_SAVED_PRIORITIES.includes(value as SavedFilterPriority)) {
    throw new Error('Invalid saved view priority');
  }

  return value as SavedFilterPriority;
}

function normalizeLabel(value: unknown): string {
  if (value === undefined) {
    return '';
  }

  if (typeof value !== 'string') {
    throw new Error('Invalid saved view label');
  }

  const label = value.trim();

  if (label.length > 32) {
    throw new Error('Invalid saved view label');
  }

  return label;
}

function normalizeIncludeArchived(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== 'boolean') {
    throw new Error('Invalid saved view includeArchived');
  }

  return value;
}

function normalizeBlockedOnly(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== 'boolean') {
    throw new Error('Invalid saved view blockedOnly');
  }

  return value;
}

function normalizeStaleOnly(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== 'boolean') {
    throw new Error('Invalid saved view staleOnly');
  }

  return value;
}

function normalizePageSize(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error('Invalid saved view pageSize');
  }

  return value;
}

function mapSavedFilterViewRow(row: SavedFilterViewRow): SavedFilterView {
  return {
    id: row.id,
    name: row.name,
    search: row.search,
    status: row.status,
    priority: row.priority,
    label: row.label,
    includeArchived: row.include_archived === 1,
    blockedOnly: row.blocked_only === 1,
    staleOnly: row.stale_only === 1,
    pageSize: row.page_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SavedFilterViewRepository {
  constructor(private readonly database: Database.Database) {}

  list(): SavedFilterView[] {
    const rows = this.database
      .prepare(
        `
        SELECT id, name, search, status, priority, label, include_archived, blocked_only, stale_only, page_size, created_at, updated_at
        FROM saved_filter_views
        ORDER BY updated_at DESC, name COLLATE NOCASE ASC, id ASC
      `
      )
      .all() as SavedFilterViewRow[];

    return rows.map(mapSavedFilterViewRow);
  }

  getById(id: string): SavedFilterView | null {
    const row = this.database
      .prepare(
        `
        SELECT id, name, search, status, priority, label, include_archived, blocked_only, stale_only, page_size, created_at, updated_at
        FROM saved_filter_views
        WHERE id = @id
      `
      )
      .get({ id }) as SavedFilterViewRow | undefined;

    return row ? mapSavedFilterViewRow(row) : null;
  }

  create(input: NewSavedFilterView): SavedFilterView {
    assertAllowedSavedFilterViewKeys(input);

    const now = nowIso();
    const view: SavedFilterView = {
      id: randomUUID(),
      name: normalizeName(input.name),
      search: normalizeSearch(input.search),
      status: normalizeStatus(input.status),
      priority: normalizePriority(input.priority),
      label: normalizeLabel(input.label),
      includeArchived: normalizeIncludeArchived(input.includeArchived),
      blockedOnly: normalizeBlockedOnly(input.blockedOnly),
      staleOnly: normalizeStaleOnly(input.staleOnly),
      pageSize: normalizePageSize(input.pageSize),
      createdAt: now,
      updatedAt: now
    };

    this.assertNameAvailable(view.name);

    this.database
      .prepare(
        `
        INSERT INTO saved_filter_views (
          id, name, search, status, priority, label, include_archived, blocked_only, stale_only, page_size, created_at, updated_at
        )
        VALUES (
          @id, @name, @search, @status, @priority, @label, @includeArchived, @blockedOnly, @staleOnly, @pageSize, @createdAt, @updatedAt
        )
      `
      )
      .run({
        id: view.id,
        name: view.name,
        search: view.search,
        status: view.status,
        priority: view.priority,
        label: view.label,
        includeArchived: view.includeArchived ? 1 : 0,
        blockedOnly: view.blockedOnly ? 1 : 0,
        staleOnly: view.staleOnly ? 1 : 0,
        pageSize: view.pageSize,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt
      });

    return view;
  }

  update(id: string, input: SavedFilterViewUpdate): SavedFilterView | null {
    const current = this.getById(id);

    if (!current) {
      return null;
    }

    assertAllowedSavedFilterViewKeys(input);

    const next: SavedFilterView = {
      ...current,
      name: input.name === undefined ? current.name : normalizeName(input.name),
      search: input.search === undefined ? current.search : normalizeSearch(input.search),
      status: input.status === undefined ? current.status : normalizeStatus(input.status),
      priority: input.priority === undefined ? current.priority : normalizePriority(input.priority),
      label: input.label === undefined ? current.label : normalizeLabel(input.label),
      includeArchived:
        input.includeArchived === undefined ? current.includeArchived : normalizeIncludeArchived(input.includeArchived),
      blockedOnly: input.blockedOnly === undefined ? current.blockedOnly : normalizeBlockedOnly(input.blockedOnly),
      staleOnly: input.staleOnly === undefined ? current.staleOnly : normalizeStaleOnly(input.staleOnly),
      pageSize: input.pageSize === undefined ? current.pageSize : normalizePageSize(input.pageSize),
      updatedAt: nowIso()
    };

    if (next.name.toLocaleLowerCase() !== current.name.toLocaleLowerCase()) {
      this.assertNameAvailable(next.name, id);
    }

    this.database
      .prepare(
        `
        UPDATE saved_filter_views
        SET
          name = @name,
          search = @search,
          status = @status,
          priority = @priority,
          label = @label,
          include_archived = @includeArchived,
          blocked_only = @blockedOnly,
          stale_only = @staleOnly,
          page_size = @pageSize,
          updated_at = @updatedAt
        WHERE id = @id
      `
      )
      .run({
        id,
        name: next.name,
        search: next.search,
        status: next.status,
        priority: next.priority,
        label: next.label,
        includeArchived: next.includeArchived ? 1 : 0,
        blockedOnly: next.blockedOnly ? 1 : 0,
        staleOnly: next.staleOnly ? 1 : 0,
        pageSize: next.pageSize,
        updatedAt: next.updatedAt
      });

    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.database.prepare('DELETE FROM saved_filter_views WHERE id = @id').run({ id });

    return result.changes > 0;
  }

  private assertNameAvailable(name: string, excludeId?: string): void {
    const existing = this.database
      .prepare(
        `
        SELECT id
        FROM saved_filter_views
        WHERE name = @name COLLATE NOCASE
        ${excludeId ? 'AND id != @excludeId' : ''}
        LIMIT 1
      `
      )
      .get({ name, excludeId }) as { id: string } | undefined;

    if (existing) {
      throw new DuplicateSavedFilterViewNameError();
    }
  }
}
