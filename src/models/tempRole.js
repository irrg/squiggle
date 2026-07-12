import Database from "better-sqlite3";

const createDB = (dbPath) => {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS TempRoles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guildId TEXT NOT NULL,
      memberId TEXT NOT NULL,
      memberName TEXT,
      roleId TEXT NOT NULL,
      roleName TEXT,
      messageId TEXT NOT NULL,
      expirationTime INTEGER NOT NULL,
      maxReactionCount INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      UNIQUE(guildId, memberId, roleId, messageId)
    )
  `);

  const toRow = (raw) => {
    if (!raw) return null;
    return { ...raw, expirationTime: new Date(raw.expirationTime) };
  };

  const findByMessageId = (messageId) => {
    const row = db.prepare("SELECT * FROM TempRoles WHERE messageId = ?").get(messageId);
    return toRow(row);
  };

  const findByKey = (guildId, memberId, roleId, messageId) => {
    const row = db
      .prepare(
        "SELECT * FROM TempRoles WHERE guildId = ? AND memberId = ? AND roleId = ? AND messageId = ?",
      )
      .get(guildId, memberId, roleId, messageId);
    return toRow(row);
  };

  const findExpired = () => {
    const now = Date.now();
    const rows = db.prepare("SELECT * FROM TempRoles WHERE expirationTime < ?").all(now);
    return rows.map(toRow);
  };

  const hasLaterExpiration = (guildId, memberId, roleId, afterMs) => {
    const row = db
      .prepare(
        "SELECT id FROM TempRoles WHERE guildId = ? AND memberId = ? AND roleId = ? AND expirationTime > ?",
      )
      .get(guildId, memberId, roleId, afterMs);
    return row !== undefined;
  };

  const create = ({
    guildId,
    memberId,
    memberName,
    roleId,
    roleName,
    messageId,
    expirationTime,
    maxReactionCount = 0,
  }) => {
    const now = Date.now();
    const expirationMs =
      expirationTime instanceof Date ? expirationTime.getTime() : expirationTime;
    try {
      const result = db
        .prepare(
          `INSERT INTO TempRoles (guildId, memberId, memberName, roleId, roleName, messageId, expirationTime, maxReactionCount, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          guildId,
          memberId,
          memberName,
          roleId,
          roleName,
          messageId,
          expirationMs,
          maxReactionCount,
          now,
          now,
        );
      return (
        findByKey(guildId, memberId, roleId, messageId) ?? {
          id: result.lastInsertRowid,
        }
      );
    } catch (err) {
      if (
        err.code === "SQLITE_CONSTRAINT_UNIQUE" ||
        (err.message && err.message.includes("UNIQUE constraint failed"))
      ) {
        const uniqueErr = new Error("Unique constraint violated");
        uniqueErr.name = "SequelizeUniqueConstraintError";
        throw uniqueErr;
      }
      throw err;
    }
  };

  const extend = (id, expirationTime, maxReactionCount) => {
    const expirationMs =
      expirationTime instanceof Date ? expirationTime.getTime() : expirationTime;
    const now = Date.now();
    db.prepare(
      "UPDATE TempRoles SET expirationTime = ?, maxReactionCount = ?, updatedAt = ? WHERE id = ?",
    ).run(expirationMs, maxReactionCount, now, id);
  };

  const deleteById = (id) => {
    const result = db.prepare("DELETE FROM TempRoles WHERE id = ?").run(id);
    return result.changes;
  };

  const deleteByKey = (guildId, memberId, roleId, messageId) => {
    const result = db
      .prepare(
        "DELETE FROM TempRoles WHERE guildId = ? AND memberId = ? AND roleId = ? AND messageId = ?",
      )
      .run(guildId, memberId, roleId, messageId);
    return result.changes;
  };

  const close = () => db.close();

  return {
    findByMessageId,
    findByKey,
    findExpired,
    hasLaterExpiration,
    create,
    extend,
    deleteById,
    deleteByKey,
    close,
  };
};

export default createDB;
