import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { db, getSetting, setSetting, PALETTE } from "./db.js";
import { computeAllocation } from "./rebalance.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// ---------- helpers ----------
function loadFunds() {
  return db.prepare("SELECT fund_key,name,isin,color,target,sort_order FROM funds ORDER BY sort_order").all();
}

// Pick the first palette color not already in use; cycle once they're all taken.
function pickColor() {
  const used = new Set(db.prepare("SELECT color FROM funds").all().map((r) => r.color));
  const free = PALETTE.find((c) => !used.has(c));
  if (free) return free;
  const n = db.prepare("SELECT COUNT(*) AS n FROM funds").get().n;
  return PALETTE[n % PALETTE.length];
}
function loadBalances() {
  const rows = db.prepare("SELECT fund_key,amount FROM balances").all();
  const out = {};
  for (const r of rows) out[r.fund_key] = r.amount;
  return out;
}

// ---------- API: state (funds + balances + settings) ----------
app.get("/api/state", (req, res) => {
  const funds = loadFunds();
  const balances = loadBalances();
  res.json({
    funds,
    balances,
    defaultContribution: getSetting("default_contribution", ""),
    palette: PALETTE,
  });
});

// Create a new fund (name + ISIN). Color is auto-assigned from the palette.
app.post("/api/funds", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const isin = String(req.body?.isin ?? "").trim();
  if (!name) return res.status(400).json({ error: "El nom és obligatori" });
  if (!isin) return res.status(400).json({ error: "L'ISIN és obligatori" });
  const dup = db.prepare("SELECT 1 FROM funds WHERE isin = ?").get(isin);
  if (dup) return res.status(400).json({ error: "Ja tens un fons amb aquest ISIN" });
  const key = randomUUID();
  const color = pickColor();
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM funds").get().m;
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO funds (fund_key,name,isin,css_class,color,target,sort_order) VALUES (?,?,?,?,?,?,?)")
      .run(key, name, isin, "", color, 0, maxOrder + 1);
    db.prepare("INSERT INTO balances (fund_key,amount) VALUES (?, NULL)").run(key);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  res.json({ ok: true, funds: loadFunds() });
});

// Edit an existing fund's name and/or color (ISIN is immutable by design).
app.patch("/api/funds/:key", (req, res) => {
  const exists = db.prepare("SELECT 1 FROM funds WHERE fund_key = ?").get(req.params.key);
  if (!exists) return res.status(404).json({ error: "Fons no trobat" });
  const { name, color } = req.body || {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (!n) return res.status(400).json({ error: "El nom és obligatori" });
    db.prepare("UPDATE funds SET name = ? WHERE fund_key = ?").run(n, req.params.key);
  }
  if (color !== undefined) {
    db.prepare("UPDATE funds SET color = ? WHERE fund_key = ?").run(String(color), req.params.key);
  }
  res.json({ ok: true, funds: loadFunds() });
});

// Update target weights and/or fund metadata
app.put("/api/funds", (req, res) => {
  const { funds } = req.body;
  if (!Array.isArray(funds)) return res.status(400).json({ error: "funds ha de ser una llista" });
  const upd = db.prepare("UPDATE funds SET target = ? WHERE fund_key = ?");
  db.exec("BEGIN");
  try {
    for (const f of funds) upd.run(Number(f.target) || 0, f.fund_key);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  res.json({ ok: true, funds: loadFunds() });
});

// Update current balances
app.put("/api/balances", (req, res) => {
  const { balances } = req.body;
  if (!balances || typeof balances !== "object") return res.status(400).json({ error: "balances invàlid" });
  const upd = db.prepare("UPDATE balances SET amount = ? WHERE fund_key = ?");
  db.exec("BEGIN");
  try {
    for (const [k, v] of Object.entries(balances)) {
      upd.run(v === null || v === "" ? null : Number(v), k);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  res.json({ ok: true, balances: loadBalances() });
});

// Default monthly contribution (sticky until changed)
app.put("/api/settings/contribution", (req, res) => {
  const { value } = req.body;
  setSetting("default_contribution", value === null || value === undefined ? "" : String(value));
  res.json({ ok: true, defaultContribution: getSetting("default_contribution", "") });
});

// ---------- API: compute allocation (and optionally record snapshot) ----------
app.post("/api/calculate", (req, res) => {
  const { contribution, month, record = true, persistBalances = true } = req.body;
  const c = Number(contribution);
  if (!(c > 0)) return res.status(400).json({ error: "L'aportació ha de ser més gran que zero" });

  const funds = loadFunds();
  const weightSum = funds.reduce((a, f) => a + (f.target || 0), 0);
  if (Math.abs(weightSum - 100) > 0.01) {
    return res.status(400).json({ error: `Els pesos objectiu sumen ${weightSum}%, han de sumar 100%` });
  }

  const balances = loadBalances();
  const r = computeAllocation(funds, balances, c);

  // persist the new balances (after contribution) as the current balances,
  // so next month starts from here unless the user overrides
  if (persistBalances) {
    const upd = db.prepare("UPDATE balances SET amount = ? WHERE fund_key = ?");
    db.exec("BEGIN");
    try {
      r.keys.forEach((k, i) => upd.run(Math.round(r.after[i] * 100) / 100, k));
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }

  // record a snapshot for the month (overwrite if it exists)
  if (record && month) {
    const del = db.prepare("DELETE FROM history WHERE month = ?");
    const ins = db.prepare("INSERT INTO history (month,fund_key,amount,contribution) VALUES (?,?,?,?)");
    db.exec("BEGIN");
    try {
      del.run(month);
      r.keys.forEach((k, i) => ins.run(month, k, Math.round(r.after[i] * 100) / 100, c));
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }

  res.json({
    funds,
    allocation: r.keys.map((k, i) => ({
      fund_key: k,
      amount: r.alloc[i],
      after: r.after[i],
      afterPct: r.afterPct[i],
    })),
    current: Object.fromEntries(r.keys.map((k, i) => [k, r.current[i]])),
    totalNow: r.totalNow,
    totalAfter: r.totalAfter,
    contribution: c,
  });
});

// ---------- API: history ----------
app.get("/api/history", (req, res) => {
  const rows = db.prepare("SELECT month,fund_key,amount,contribution FROM history ORDER BY month").all();
  const byMonth = {};
  for (const r of rows) {
    if (!byMonth[r.month]) byMonth[r.month] = { month: r.month, balances: {}, contribution: r.contribution, total: 0 };
    byMonth[r.month].balances[r.fund_key] = r.amount;
    byMonth[r.month].total += r.amount;
  }
  const history = Object.values(byMonth).sort((a, b) => (a.month < b.month ? -1 : 1));
  for (const h of history) h.total = Math.round(h.total * 100) / 100;
  res.json({ history });
});

app.delete("/api/history/:month", (req, res) => {
  db.prepare("DELETE FROM history WHERE month = ?").run(req.params.month);
  res.json({ ok: true });
});

// Wipe everything: funds, balances, history and the default contribution.
// Leaves the app on the welcome screen, ready to start over.
app.post("/api/reset", (req, res) => {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM history").run();
    db.prepare("DELETE FROM balances").run();
    db.prepare("DELETE FROM funds").run();
    db.prepare("UPDATE settings SET value = '' WHERE key = 'default_contribution'").run();
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  res.json({ ok: true });
});

// ---------- static frontend ----------
// In Docker the frontend is copied to ./public; in local dev it lives at ../frontend.
import fs from "node:fs";
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, "public", "index.html"))
  ? path.join(__dirname, "public")
  : path.join(__dirname, "..", "frontend");
app.use(express.static(PUBLIC_DIR));
// Always revalidate the entry page so a code update is picked up on the next
// load instead of the browser serving a stale cached index.html.
app.get("*", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Cartera rebalancer escoltant al port ${PORT}`);
});
