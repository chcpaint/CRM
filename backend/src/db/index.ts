import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

let db: Database;

const DB_PATH = path.join(__dirname, '../../data/crm.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('Loaded existing database from', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('Created new database');
  }

  // Run schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.run(schema);

  // Enable WAL mode for better concurrent read performance
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  // Save to disk
  saveDatabase();

  console.log('Database initialized successfully');
  return db;
}

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function saveDatabase(): void {
  if (!db) return;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Helper to run a query and return results as objects
export function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

// Helper to run a query and return first result
export function queryOne<T = any>(sql: string, params: any[] = []): T | null {
  const results = queryAll<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}

// Helper to run an insert/update/delete and return changes info
export function execute(sql: string, params: any[] = []): { changes: number; lastId: number } {
  db.run(sql, params);
  const changesResult = queryOne<{ changes: number }>('SELECT changes() as changes');
  const lastIdResult = queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
  saveDatabase();
  return {
    changes: changesResult?.changes || 0,
    lastId: lastIdResult?.id || 0
  };
}
