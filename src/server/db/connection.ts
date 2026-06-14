import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { initializeDatabase, type SqliteDatabase } from "./schema.js";

export const defaultDatabasePath = path.resolve(process.cwd(), "data", "tinytracker.sqlite");

export function getDatabasePath() {
  return process.env.TINYTRACKER_DB_PATH ?? defaultDatabasePath;
}

export function openDatabase(filePath = getDatabasePath()): SqliteDatabase {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const db = new Database(filePath);
  initializeDatabase(db);

  return db;
}
