import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Base de datos temporal por archivo de prueba (db.ts lee DATA_DIR al importarse) y sin respaldos.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "qa-test-"));
process.env.UPLOAD_DIR = path.join(process.env.DATA_DIR, "uploads");
process.env.BACKUP_EVERY_MIN = "0";
