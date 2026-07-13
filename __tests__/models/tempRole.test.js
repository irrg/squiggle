import { describe, it, expect, beforeEach, afterEach } from "vitest";
import createDB from "../../src/models/tempRole.js";

const base = {
  guildId: "guild-1",
  memberId: "member-1",
  memberName: "testuser",
  roleId: "role-1",
  roleName: "Cool Person",
  messageId: "msg-1",
};

let db;

beforeEach(async () => {
  db = await createDB();
});

afterEach(async () => {
  await db.close();
});

describe("TempRole model", () => {
  it("creates a record with all fields", async () => {
    const expirationTime = new Date(Date.now() + 60 * 60 * 1000);
    const record = await db.create({ ...base, expirationTime });

    expect(record.id).toBeDefined();
    expect(record.guildId).toBe("guild-1");
    expect(record.memberId).toBe("member-1");
    expect(record.roleId).toBe("role-1");
    expect(record.expirationTime).toBeInstanceOf(Date);
  });

  it("findByMessageId returns the row", async () => {
    const expirationTime = new Date(Date.now() + 60 * 60 * 1000);
    await db.create({ ...base, expirationTime });

    const found = await db.findByMessageId("msg-1");
    expect(found).not.toBeNull();
    expect(found.roleName).toBe("Cool Person");
    expect(found.expirationTime).toBeInstanceOf(Date);
  });

  it("findByMessageId returns null when not found", async () => {
    expect(await db.findByMessageId("nonexistent")).toBeNull();
  });

  it("findByKey returns the row", async () => {
    const expirationTime = new Date(Date.now() + 60 * 60 * 1000);
    await db.create({ ...base, expirationTime });

    const found = await db.findByKey("guild-1", "member-1", "role-1", "msg-1");
    expect(found).not.toBeNull();
    expect(found.memberName).toBe("testuser");
  });

  it("findByKey returns null when not found", async () => {
    expect(
      await db.findByKey("guild-1", "member-1", "role-1", "no-msg"),
    ).toBeNull();
  });

  it("extend updates expiration time and maxReactionCount", async () => {
    const initial = new Date(Date.now() + 60 * 60 * 1000);
    const record = await db.create({ ...base, expirationTime: initial });

    const extended = new Date(initial.getTime() + 4 * 60 * 60 * 1000);
    await db.extend(record.id, extended, 5);

    const updated = await db.findByKey(
      "guild-1",
      "member-1",
      "role-1",
      "msg-1",
    );
    expect(updated.expirationTime.getTime()).toBe(extended.getTime());
    expect(updated.maxReactionCount).toBe(5);
  });

  it("deleteById removes the row and returns changes count", async () => {
    const record = await db.create({ ...base, expirationTime: new Date() });
    const deleted = await db.deleteById(record.id);

    expect(deleted).toBe(1);
    expect(
      await db.findByKey("guild-1", "member-1", "role-1", "msg-1"),
    ).toBeNull();
  });

  it("deleteByKey removes the row and returns changes count", async () => {
    await db.create({ ...base, expirationTime: new Date() });
    const deleted = await db.deleteByKey(
      "guild-1",
      "member-1",
      "role-1",
      "msg-1",
    );

    expect(deleted).toBe(1);
    expect(
      await db.findByKey("guild-1", "member-1", "role-1", "msg-1"),
    ).toBeNull();
  });

  it("stores maxReactionCount on create", async () => {
    const record = await db.create({
      ...base,
      expirationTime: new Date(Date.now() + 60 * 60 * 1000),
      maxReactionCount: 4,
    });
    expect(record.maxReactionCount).toBe(4);
  });

  it("findExpired returns only expired rows", async () => {
    const expired = new Date(Date.now() - 60 * 60 * 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);

    await db.create({ ...base, expirationTime: expired });
    await db.create({ ...base, messageId: "msg-2", expirationTime: future });

    const results = await db.findExpired();
    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe("msg-1");
    expect(results[0].expirationTime).toBeInstanceOf(Date);
  });

  it("hasLaterExpiration returns true when a later row exists", async () => {
    const earlier = new Date(Date.now() - 60 * 60 * 1000);
    const later = new Date(Date.now() + 60 * 60 * 1000);

    await db.create({ ...base, messageId: "msg-1", expirationTime: earlier });
    await db.create({ ...base, messageId: "msg-2", expirationTime: later });

    expect(
      await db.hasLaterExpiration(
        "guild-1",
        "member-1",
        "role-1",
        earlier.getTime(),
      ),
    ).toBe(true);
  });

  it("hasLaterExpiration returns false when no later row exists", async () => {
    const t = new Date(Date.now() + 60 * 60 * 1000);
    await db.create({ ...base, expirationTime: t });

    expect(
      await db.hasLaterExpiration("guild-1", "member-1", "role-1", t.getTime()),
    ).toBe(false);
  });

  it("findAllByGuild returns only rows for that guild", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await db.create({ ...base, expirationTime: future });
    await db.create({
      ...base,
      guildId: "guild-2",
      messageId: "msg-2",
      expirationTime: future,
    });

    const rows = await db.findAllByGuild("guild-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].guildId).toBe("guild-1");
    expect(rows[0].expirationTime).toBeInstanceOf(Date);
  });

  it("throws UniqueConstraintError on duplicate key", async () => {
    const expirationTime = new Date(Date.now() + 60 * 60 * 1000);
    await db.create({ ...base, expirationTime });

    await expect(db.create({ ...base, expirationTime })).rejects.toMatchObject({
      name: "UniqueConstraintError",
    });
  });

  it("does not extend when reaction count equals maxReactionCount (remove+re-add)", async () => {
    const initial = new Date(Date.now() + 16 * 60 * 60 * 1000);
    const record = await db.create({
      ...base,
      expirationTime: initial,
      maxReactionCount: 4,
    });

    const reactionCount = 4;
    const shouldExtend = reactionCount > record.maxReactionCount;
    expect(shouldExtend).toBe(false);

    const unchanged = await db.findByKey(
      "guild-1",
      "member-1",
      "role-1",
      "msg-1",
    );
    expect(unchanged.expirationTime.getTime()).toBe(initial.getTime());
  });

  it("extends and updates maxReactionCount when a genuinely new reactor pushes count higher", async () => {
    const initial = new Date(Date.now() + 16 * 60 * 60 * 1000);
    const record = await db.create({
      ...base,
      expirationTime: initial,
      maxReactionCount: 4,
    });

    const reactionCount = 5;
    if (reactionCount > record.maxReactionCount) {
      const extended = new Date(initial.getTime() + 4 * 60 * 60 * 1000);
      await db.extend(record.id, extended, reactionCount);
    }

    const updated = await db.findByKey(
      "guild-1",
      "member-1",
      "role-1",
      "msg-1",
    );
    expect(updated.maxReactionCount).toBe(5);
    expect(updated.expirationTime.getTime()).toBeGreaterThan(initial.getTime());
  });
});
