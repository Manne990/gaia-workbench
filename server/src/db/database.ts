import Database from 'better-sqlite3';
import { ensureTinyTrackerSchema } from './schema.js';

export function createDatabase(databasePath = ':memory:'): Database.Database {
  const database = new Database(databasePath);
  ensureTinyTrackerSchema(database);
  return database;
}
