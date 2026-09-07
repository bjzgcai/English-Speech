const fs = require("node:fs");
const { DatabaseSync, backup } = require("node:sqlite");
const [source, target] = process.argv.slice(2);
async function main() {
  if (!source || !target) throw new Error("Source and target are required");
  if (!fs.existsSync(source)) return;
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, target); fs.chmodSync(target, 0o600); }
  finally { db.close(); }
}
main().catch(() => { console.error("Monitor snapshot failed"); process.exitCode = 1; });
