import { getDatabasePath, openDatabase } from "./connection.js";

const dbPath = getDatabasePath();
const db = openDatabase(dbPath);

db.close();

console.log(`TinyTracker database initialized at ${dbPath}`);
