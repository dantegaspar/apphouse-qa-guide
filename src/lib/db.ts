import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "./data");
export const UPLOAD_DIR = path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR || "./uploads");

/**
 * Migraciones en orden. Cada entrada se aplica una sola vez (PRAGMA user_version).
 * Para cambiar el esquema agrega una nueva entrada al final; nunca edites una existente.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    guide_id TEXT NOT NULL,
    guide_version TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    tester_fields TEXT NOT NULL DEFAULT '{}',
    device TEXT NOT NULL DEFAULT '{}',
    prep TEXT NOT NULL DEFAULT '{}',
    finish TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'in_progress',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX runs_guide ON runs(guide_id, created_at);

  CREATE TABLE step_results (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    activity_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('ok','fail')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, activity_id, step_id)
  );

  CREATE TABLE activity_results (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    activity_id TEXT NOT NULL,
    result TEXT,
    checks TEXT NOT NULL DEFAULT '{}',
    fields TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, activity_id)
  );

  CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    activity_id TEXT NOT NULL,
    step_id TEXT,
    kind TEXT NOT NULL DEFAULT 'issue' CHECK (kind IN ('issue','evidence')),
    description TEXT NOT NULL DEFAULT '',
    expected TEXT NOT NULL DEFAULT '',
    blocking INTEGER NOT NULL DEFAULT 0,
    order_number TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX issues_run ON issues(run_id);

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX attachments_issue ON attachments(issue_id);

  CREATE TABLE survey_responses (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    answers TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // 2: solicitudes de ayuda al guía (falla bloqueante) y término de la prueba por bloqueo
  `
  CREATE TABLE help_requests (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    activity_id TEXT NOT NULL,
    step_id TEXT,
    issue_id TEXT,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ended')),
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolution TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX help_requests_status ON help_requests(status, created_at);
  CREATE INDEX help_requests_run ON help_requests(run_id);

  ALTER TABLE runs ADD COLUMN ended_reason TEXT NOT NULL DEFAULT '';
  ALTER TABLE runs ADD COLUMN ended_at TEXT;
  `,
];

function migrate(db: Database.Database) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
    console.log(`[db] migración ${v + 1} aplicada`);
  }
}

const globalForDb = globalThis as unknown as { __qaDb?: Database.Database };

export function getDb(): Database.Database {
  if (globalForDb.__qaDb) return globalForDb.__qaDb;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(/* turbopackIgnore: true */ DATA_DIR, "qa.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  globalForDb.__qaDb = db;
  return db;
}

export const now = () => new Date().toISOString();
