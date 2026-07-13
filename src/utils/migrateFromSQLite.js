import { readFileSync, unlinkSync } from "fs";

const SQLITE_MAGIC = "SQLite format 3";

function isSQLiteFile(filePath) {
  try {
    const header = readFileSync(filePath).slice(0, 15).toString("ascii");
    return header === SQLITE_MAGIC;
  } catch {
    return false;
  }
}

export default async function migrateFromSQLite(filePath) {
  if (!isSQLiteFile(filePath)) return [];

  const { default: initSqlJs } = await import("sql.js");
  const SQL = await initSqlJs();
  const sqliteDb = new SQL.Database(readFileSync(filePath));

  let rows = [];
  try {
    const results = sqliteDb.exec("SELECT * FROM TempRoles");
    if (results.length) {
      const { columns, values } = results[0];
      rows = values.map((row) => {
        const obj = Object.fromEntries(columns.map((col, i) => [col, row[i]]));
        const expRaw = obj.expirationTime;
        const expMs = typeof expRaw === "number" ? expRaw : new Date(expRaw).getTime();
        return {
          guildId: obj.guildId,
          memberId: obj.memberId,
          memberName: obj.memberName,
          roleId: obj.roleId,
          roleName: obj.roleName,
          messageId: obj.messageId,
          expirationTime: new Date(expMs),
          maxReactionCount: obj.maxReactionCount ?? 0,
        };
      });
    }
  } finally {
    sqliteDb.close();
  }

  unlinkSync(filePath);

  const now = new Date();
  return rows.filter((r) => r.expirationTime > now);
}
