import Datastore from "@seald-io/nedb";

const createDB = async (filePath) => {
  const opts = filePath
    ? { filename: filePath, autoload: true }
    : { inMemory: true };
  const ds = new Datastore(opts);

  await ds.ensureIndexAsync({ fieldName: "messageId" });
  await ds.ensureIndexAsync({ fieldName: "expirationTime" });
  await ds.ensureIndexAsync({ fieldName: "createdAt" });
  await ds.ensureIndexAsync({
    fieldName: "_id",
    unique: true,
  });

  const toRow = (doc) => {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { ...rest, id: _id, expirationTime: new Date(doc.expirationTime) };
  };

  const toMs = (value) => (value instanceof Date ? value.getTime() : value);

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
    const docs = await ds
      .findAsync({ guildId, spent: { $ne: true } })
      .sort({ expirationTime: 1 });
    return docs.map(toRow);
  };

  const findAllByMemberRole = async (guildId, memberId, roleId) => {
    const docs = await ds.findAsync({
      guildId,
      memberId,
      roleId,
      spent: { $ne: true },
    });
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

  // `window` bounds the query by createdAt — {since, until} as Dates or ms,
  // either edge optional. Omitting it entirely keeps the all-time behavior
  // /squiggle leaderboard wants. createdAt (not updatedAt) is the right
  // anchor: a row's whole life is ~16h plus 4h per new high-water reaction
  // and `extend` refuses a spent row, so a row can't still be accruing
  // votes a window later. Spent rows stay counted — a role that has since
  // expired was still earned.
  const topByRole = async (guildId, roleId, limit = 3, window = {}) => {
    const { since, until } = window;
    const query = { guildId, roleId };
    if (since != null || until != null) {
      query.createdAt = {};
      if (since != null) query.createdAt.$gte = toMs(since);
      if (until != null) query.createdAt.$lt = toMs(until);
    }
    const docs = await ds.findAsync(query);
    const counts = new Map();
    for (const doc of docs) {
      const entry = counts.get(doc.memberId) ?? {
        memberId: doc.memberId,
        memberName: doc.memberName,
        totalReactions: 0,
        postCount: 0,
      };
      entry.totalReactions += doc.maxReactionCount ?? 0;
      entry.postCount += 1;
      entry.memberName = doc.memberName;
      counts.set(doc.memberId, entry);
    }
    const entries = [...counts.values()];
    return {
      // Ties on one ranking's own metric fall back to the other ranking's
      // metric instead of whatever order they happened to land in the
      // Map, so e.g. four members tied at 1 "time" aren't ordered
      // arbitrarily when one of them clearly had more votes behind it.
      byVotes: [...entries]
        .sort(
          (a, b) =>
            b.totalReactions - a.totalReactions || b.postCount - a.postCount,
        )
        .slice(0, limit),
      byAttainment: [...entries]
        .sort(
          (a, b) =>
            b.postCount - a.postCount || b.totalReactions - a.totalReactions,
        )
        .slice(0, limit),
    };
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
    const expirationMs = toMs(expirationTime);
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
    const expirationMs = toMs(expirationTime);
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
    const { numAffected } = await ds.updateAsync(
      { _id: id },
      { $set: { spent: true, updatedAt: now } },
    );
    return numAffected;
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
    close,
  };
};

export default createDB;
