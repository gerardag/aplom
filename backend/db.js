import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = process.env.DATA_DIR || "/data";
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

const DEFAULT_FUNDS = [
  { fund_key: "dev",  name: "RV Global desenvolupat",         isin: "IE00B03HCZ61", css_class: "equity",   target: 60, sort_order: 1 },
  { fund_key: "emrg", name: "RV Emergents",                   isin: "IE000QAZP7L2", css_class: "emerging", target: 10, sort_order: 2 },
  { fund_key: "bond", name: "Renda fixa global (EUR hedged)", isin: "IE00B18GC888", css_class: "bond",     target: 30, sort_order: 3 },
];

const fundCount = db.prepare("SELECT COUNT(*) AS n FROM funds").get().n;
if (fundCount === 0) {
  const insFund = db.prepare(
    "INSERT INTO funds (fund_key,name,isin,css_class,target,sort_order) VALUES (?,?,?,?,?,?)"
  );
  const insBal = db.prepare("INSERT INTO balances (fund_key,amount) VALUES (?, NULL)");
  for (const f of DEFAULT_FUNDS) {
    insFund.run(f.fund_key, f.name, f.isin, f.css_class, f.target, f.sort_order);
    insBal.run(f.fund_key);
  }
}

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

export { db, getSetting, setSetting };
