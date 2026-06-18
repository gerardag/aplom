import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "cartera.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

// ---- schema ----
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS funds (
    fund_key   TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    isin       TEXT NOT NULL,
    css_class  TEXT NOT NULL,
    target     REAL NOT NULL,
    sort_order INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS balances (
    fund_key TEXT PRIMARY KEY,
    amount   REAL
  );
  CREATE TABLE IF NOT EXISTS history (
    month        TEXT NOT NULL,
    fund_key     TEXT NOT NULL,
    amount       REAL NOT NULL,
    contribution REAL NOT NULL,
    PRIMARY KEY (month, fund_key)
  );
`);

// ---- migration: per-fund color (replaces the old fixed css_class palette) ----
const fundCols = db.prepare("PRAGMA table_info(funds)").all();
if (!fundCols.some((c) => c.name === "color")) {
  db.exec("ALTER TABLE funds ADD COLUMN color TEXT");
  const legacy = { equity: "#2f6f4f", emerging: "#b8762e", bond: "#3a5a78" };
  const upd = db.prepare("UPDATE funds SET color = ? WHERE fund_key = ?");
  for (const r of db.prepare("SELECT fund_key, css_class FROM funds").all()) {
    upd.run(legacy[r.css_class] || "#5b645f", r.fund_key);
  }
}

// Colors offered to new funds, in assignment order. Tuned to the earthy palette.
const PALETTE = [
  "#2f6f4f", "#3a5a78", "#b8762e", "#9a3b2e", "#5b6b3a",
  "#7a5a78", "#4f7a8a", "#a8843e", "#6b5f4f", "#3a6b6b",
];

function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

if (getSetting("default_contribution") === null) setSetting("default_contribution", "");

export { db, getSetting, setSetting, PALETTE };
