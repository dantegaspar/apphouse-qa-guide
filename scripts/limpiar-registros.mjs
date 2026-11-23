#!/usr/bin/env node
/**
 * Borra TODOS los registros de prueba (testers, pasos, actividades, fallas, encuestas, ayudas,
 * repartidores) y sus archivos subidos. Antes guarda un respaldo de la base.
 *
 * Uso (pide confirmación con --si):
 *   Local:   npm run limpiar -- --si
 *   Docker:  docker compose exec app node scripts/limpiar-registros.mjs --si
 *
 * Respeta DATA_DIR y UPLOAD_DIR (por omisión ./data y ./uploads). No toca las guías ni el código.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const DB_FILE = path.join(DATA_DIR, "qa.sqlite");

if (!fs.existsSync(DB_FILE)) {
  console.log(`No hay base en ${DB_FILE}: no hay nada que limpiar.`);
  process.exit(0);
}

const db = new Database(DB_FILE);
db.pragma("busy_timeout = 5000");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
const before = Object.fromEntries(tables.map((t) => [t, count(t)]));

console.log(`Base: ${DB_FILE}`);
for (const [t, n] of Object.entries(before)) console.log(`  ${t}: ${n}`);

if (!process.argv.includes("--si")) {
  console.log("\nNo se borró nada. Para borrar todo, vuelve a correrlo con --si.");
  process.exit(0);
}

// Respaldo antes de borrar
const backupDir = path.join(DATA_DIR, "backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.join(backupDir, `antes-de-limpiar-${stamp}.sqlite`);
await db.backup(backup);
console.log(`\nRespaldo: ${backup}`);

db.pragma("foreign_keys = OFF");
db.transaction(() => {
  for (const t of tables) db.prepare(`DELETE FROM "${t}"`).run();
})();
db.pragma("foreign_keys = ON");
db.exec("VACUUM");
db.close();

// Archivos subidos (fotos y videos de reportes y de repartidores)
let files = 0;
if (fs.existsSync(UPLOAD_DIR)) {
  for (const e of fs.readdirSync(UPLOAD_DIR)) {
    const p = path.join(UPLOAD_DIR, e);
    files += fs.statSync(p).isDirectory() ? fs.readdirSync(p, { recursive: true }).length : 1;
    fs.rmSync(p, { recursive: true, force: true });
  }
}

const total = Object.values(before).reduce((a, b) => a + b, 0);
console.log(`Listo: se borraron ${total} registros y ${files} archivos subidos.`);
