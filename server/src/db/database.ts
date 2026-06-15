import Database from 'better-sqlite3';
import { ensureTinyTrackerSchema } from './schema.js';

export function createDatabase(databasePath = ':memory:'): Database.Database {
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  ensureTinyTrackerSchema(database);
  return database;
}
