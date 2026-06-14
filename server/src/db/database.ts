import Database from 'better-sqlite3';
import { ensureTinyTrackerSchema } from './schema.js';

export function createDatabase(path = ':memory:'): Database.Database {
  const database = new Database(path);
  ensureTinyTrackerSchema(database);
  return database;
}
