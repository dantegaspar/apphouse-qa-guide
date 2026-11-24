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
  // 3: encuesta de repartidores (caritas + problemas con foto). Sus fotos van en su propia tabla
  // porque attachments exige una corrida (runs).
  `
  CREATE TABLE courier_feedback (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '{}',
    answers TEXT NOT NULL DEFAULT '{}',
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX courier_feedback_created ON courier_feedback(created_at);

  CREATE TABLE courier_issues (
    id TEXT PRIMARY KEY,
    feedback_id TEXT NOT NULL REFERENCES courier_feedback(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX courier_issues_feedback ON courier_issues(feedback_id);

  CREATE TABLE courier_attachments (
    id TEXT PRIMARY KEY,
    feedback_id TEXT NOT NULL REFERENCES courier_feedback(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL REFERENCES courier_issues(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX courier_attachments_issue ON courier_attachments(issue_id);
  `,
  // 4: borradores de la encuesta (se guardan mientras el tester contesta). is_draft=1 hasta el
  // envío final; los reportes y gráficas solo cuentan is_draft=0. Además, las casillas marcadas
  // en los pasos de confirmación (Step.checkpoint) se guardan con el resultado del paso.
  `
  ALTER TABLE survey_responses ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE step_results ADD COLUMN checkpoint TEXT NOT NULL DEFAULT '{}';
  `,
  // 5: pasos condicionales («No me apareció»): outcome 'na'. SQLite no permite cambiar un CHECK,
  // así que se reconstruye step_results con los mismos datos.
  `
  CREATE TABLE step_results_new (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    activity_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('ok','fail','na')),
    checkpoint TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, activity_id, step_id)
  );
  INSERT INTO step_results_new (run_id, activity_id, step_id, outcome, checkpoint, updated_at)
    SELECT run_id, activity_id, step_id, outcome, checkpoint, updated_at FROM step_results;
  DROP TABLE step_results;
  ALTER TABLE step_results_new RENAME TO step_results;
  `,
  // 6: gravedad de la falla (bloqueante / mayor / menor) y revisión de Mesa de control (triage).
  // Las fallas viejas toman la gravedad de «¿Te impide seguir?».
  `
  ALTER TABLE issues ADD COLUMN severity TEXT NOT NULL DEFAULT '';
  ALTER TABLE issues ADD COLUMN triage TEXT NOT NULL DEFAULT 'pendiente';
  ALTER TABLE issues ADD COLUMN triage_note TEXT NOT NULL DEFAULT '';
  ALTER TABLE issues ADD COLUMN triage_at TEXT;
  UPDATE issues SET severity = CASE WHEN blocking = 1 THEN 'bloqueante' ELSE 'mayor' END WHERE kind = 'issue';
  `,
  // 7: escala de severidad del Plan de pruebas (crítico / alto / medio / bajo).
  `
  UPDATE issues SET severity = CASE severity WHEN 'bloqueante' THEN 'alto' WHEN 'mayor' THEN 'medio' WHEN 'menor' THEN 'bajo' ELSE severity END;
  `,
  // 8: Mesa de control decide si una prueba cuenta para el veredicto ('' = automático, 'excluir', 'incluir').
  `
  ALTER TABLE runs ADD COLUMN verdict_scope TEXT NOT NULL DEFAULT '';
  ALTER TABLE runs ADD COLUMN verdict_scope_note TEXT NOT NULL DEFAULT '';
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
  startBackups(db);
  return db;
}

/**
 * Respaldos automáticos de la base: cada BACKUP_EVERY_MIN minutos (por defecto 10) se copia
 * una instantánea consistente a BACKUP_DIR (por defecto DATA_DIR/backups) y se conservan
 * las últimas BACKUP_KEEP (por defecto 144 = 24 h). BACKUP_EVERY_MIN=0 los desactiva.
 */
export const BACKUP_DIR = path.resolve(
  /* turbopackIgnore: true */ process.env.BACKUP_DIR || path.join(/* turbopackIgnore: true */ DATA_DIR, "backups"),
);

const globalForBackup = globalThis as unknown as { __qaBackupTimer?: NodeJS.Timeout };

function startBackups(db: Database.Database) {
  const every = Number(process.env.BACKUP_EVERY_MIN ?? 10);
  const keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 144));
  if (!Number.isFinite(every) || every <= 0 || globalForBackup.__qaBackupTimer) return;
  const run = async () => {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await db.backup(path.join(/* turbopackIgnore: true */ BACKUP_DIR, `qa-${stamp}.sqlite`));
      const files = fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => /^qa-.*\.sqlite$/.test(f))
        .sort();
      for (const f of files.slice(0, Math.max(0, files.length - keep))) {
        fs.rmSync(path.join(/* turbopackIgnore: true */ BACKUP_DIR, f), { force: true });
      }
    } catch (e) {
      console.error("[db] respaldo falló:", e);
    }
  };
  globalForBackup.__qaBackupTimer = setInterval(run, every * 60_000);
  globalForBackup.__qaBackupTimer.unref();
  setTimeout(run, 5_000).unref();
}

export const now = () => new Date().toISOString();
