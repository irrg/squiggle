import Datastore from "@seald-io/nedb";

const createDB = async (filePath) => {
  const opts = filePath
    ? { filename: filePath, autoload: true }
    : { inMemory: true };
  const ds = new Datastore(opts);

  await ds.ensureIndexAsync({ fieldName: "messageId" });
  await ds.ensureIndexAsync({ fieldName: "expirationTime" });
  await ds.ensureIndexAsync({
    fieldName: "_id",
    unique: true,
  });

  const toRow = (doc) => {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { ...rest, id: _id, expirationTime: new Date(doc.expirationTime) };
  };

  const makeId = (guildId, memberId, roleId, messageId) =>
    `${guildId}:${memberId}:${roleId}:${messageId}`;

  const findByMessageId = async (messageId) => {
    const doc = await ds.findOneAsync({ messageId });
    return toRow(doc);
  };

  const findByKey = async (guildId, memberId, roleId, messageId) => {
    const id = makeId(guildId, memberId, roleId, messageId);
    const doc = await ds.findOneAsync({ _id: id });
    return toRow(doc);
  };

  const findAll = async () => {
    const docs = await ds.findAsync({}).sort({ expirationTime: 1 });
    return docs.map(toRow);
  };

  const findAllByGuild = async (guildId) => {
    const docs = await ds.findAsync({ guildId }).sort({ expirationTime: 1 });
    return docs.map(toRow);
  };

  const findAllByMemberRole = async (guildId, memberId, roleId) => {
    const docs = await ds.findAsync({ guildId, memberId, roleId });
    return docs.map(toRow);
  };

  const findExpired = async () => {
    const now = Date.now();
    const docs = await ds.findAsync({
      expirationTime: { $lt: now },
      spent: { $ne: true },
    });
    return docs.map(toRow);
  };

  const topByRole = async (guildId, roleId, limit = 3) => {
    const docs = await ds.findAsync({ guildId, roleId });
    const counts = new Map();
    for (const doc of docs) {
      const entry = counts.get(doc.memberId) ?? {
        memberId: doc.memberId,
        memberName: doc.memberName,
        count: 0,
      };
      entry.count += 1;
      entry.memberName = doc.memberName;
      counts.set(doc.memberId, entry);
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  };

  const hasLaterExpiration = async (guildId, memberId, roleId, afterMs) => {
    const doc = await ds.findOneAsync({
      guildId,
      memberId,
      roleId,
      expirationTime: { $gt: afterMs },
    });
    return doc !== null;
  };

  const create = async ({
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
      expirationTime instanceof Date
        ? expirationTime.getTime()
        : expirationTime;
    const _id = makeId(guildId, memberId, roleId, messageId);
    try {
      const doc = await ds.insertAsync({
        _id,
        guildId,
        memberId,
        memberName,
        roleId,
        roleName,
        messageId,
        expirationTime: expirationMs,
        maxReactionCount,
        spent: false,
        createdAt: now,
        updatedAt: now,
      });
      return toRow(doc);
    } catch (err) {
      if (err.errorType === "uniqueViolated") {
        const uniqueErr = new Error("Unique constraint violated");
        uniqueErr.name = "UniqueConstraintError";
        throw uniqueErr;
      }
      throw err;
    }
  };

  const extend = async (id, expirationTime, maxReactionCount) => {
    const expirationMs =
      expirationTime instanceof Date
        ? expirationTime.getTime()
        : expirationTime;
    const now = Date.now();
    await ds.updateAsync(
      { _id: id },
      {
        $set: {
          expirationTime: expirationMs,
          maxReactionCount,
          updatedAt: now,
        },
      },
    );
  };

  const markSpent = async (id) => {
    const now = Date.now();
    await ds.updateAsync(
      { _id: id },
      { $set: { spent: true, updatedAt: now } },
    );
  };

  const deleteById = async (id) => {
    const numRemoved = await ds.removeAsync({ _id: id }, {});
    return numRemoved;
  };

  const close = async () => {
    // no-op for nedb
  };

  return {
    findAll,
    findAllByGuild,
    findAllByMemberRole,
    findByMessageId,
    findByKey,
    findExpired,
    hasLaterExpiration,
    topByRole,
    create,
    extend,
    markSpent,
    deleteById,
    close,
  };
};

export default createDB;
