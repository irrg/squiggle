import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  it("markSpent flags the row without deleting it, returning the affected count", async () => {
    const record = await db.create({ ...base, expirationTime: new Date() });
    const affected = await db.markSpent(record.id);

    expect(affected).toBe(1);
    const found = await db.findByKey("guild-1", "member-1", "role-1", "msg-1");
    expect(found).not.toBeNull();
    expect(found.spent).toBe(true);
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

  it("findExpired excludes rows already marked spent", async () => {
    const expired = new Date(Date.now() - 60 * 60 * 1000);
    const record = await db.create({ ...base, expirationTime: expired });
    await db.markSpent(record.id);

    const results = await db.findExpired();
    expect(results).toHaveLength(0);
  });

  it("topByRole ranks byVotes and byAttainment independently, since a single big post and many small ones can produce different leaders", async () => {
    const t = new Date(Date.now() + 60 * 60 * 1000);
    // member-1: 3 posts of 4 => 12 total. member-2: 1 post of 20 => 20
    // total. member-3: 2 posts of 5 => 10 total.
    await db.create({
      ...base,
      memberId: "member-1",
      messageId: "msg-1",
      expirationTime: t,
      maxReactionCount: 4,
    });
    await db.create({
      ...base,
      memberId: "member-1",
      messageId: "msg-2",
      expirationTime: t,
      maxReactionCount: 4,
    });
    await db.create({
      ...base,
      memberId: "member-1",
      messageId: "msg-3",
      expirationTime: t,
      maxReactionCount: 4,
    });
    await db.create({
      ...base,
      memberId: "member-2",
      messageId: "msg-4",
      expirationTime: t,
      maxReactionCount: 20,
    });
    await db.create({
      ...base,
      memberId: "member-3",
      messageId: "msg-5",
      expirationTime: t,
      maxReactionCount: 5,
    });
    await db.create({
      ...base,
      memberId: "member-3",
      messageId: "msg-6",
      expirationTime: t,
      maxReactionCount: 5,
    });

    const { byVotes, byAttainment } = await db.topByRole(
      "guild-1",
      "role-1",
      3,
    );

    expect(byVotes).toHaveLength(3);
    expect(byVotes[0]).toMatchObject({
      memberId: "member-2",
      totalReactions: 20,
    });
    expect(byVotes[1]).toMatchObject({
      memberId: "member-1",
      totalReactions: 12,
    });
    expect(byVotes[2]).toMatchObject({
      memberId: "member-3",
      totalReactions: 10,
    });

    expect(byAttainment).toHaveLength(3);
    expect(byAttainment[0]).toMatchObject({
      memberId: "member-1",
      postCount: 3,
    });
    expect(byAttainment[1]).toMatchObject({
      memberId: "member-3",
      postCount: 2,
    });
    expect(byAttainment[2]).toMatchObject({
      memberId: "member-2",
      postCount: 1,
    });
  });

  it("topByRole respects the limit and only counts rows for that role", async () => {
    const t = new Date(Date.now() + 60 * 60 * 1000);
    await db.create({
      ...base,
      memberId: "member-1",
      messageId: "msg-1",
      expirationTime: t,
      maxReactionCount: 4,
    });
    await db.create({
      ...base,
      memberId: "member-1",
      messageId: "msg-2",
      expirationTime: t,
      maxReactionCount: 4,
    });
    await db.create({
      ...base,
      memberId: "member-2",
      messageId: "msg-3",
      expirationTime: t,
      maxReactionCount: 4,
    });
    await db.create({
      ...base,
      memberId: "member-3",
      roleId: "role-2",
      messageId: "msg-4",
      expirationTime: t,
      maxReactionCount: 10,
    });

    const { byVotes, byAttainment } = await db.topByRole(
      "guild-1",
      "role-1",
      1,
    );

    expect(byVotes).toHaveLength(1);
    expect(byVotes[0].memberId).toBe("member-1");
    expect(byAttainment).toHaveLength(1);
    expect(byAttainment[0].memberId).toBe("member-1");
  });

  it("topByRole breaks ties on one ranking using the other ranking's metric", async () => {
    const t = new Date(Date.now() + 60 * 60 * 1000);
    // Everyone tied at 1 post each — byAttainment ties should fall back
    // to totalReactions (member-2 > member-3 > member-1).
    await db.create({
      ...base,
      memberId: "member-1",
      messageId: "msg-1",
      expirationTime: t,
      maxReactionCount: 4,
    });
    await db.create({
      ...base,
      memberId: "member-2",
      messageId: "msg-2",
      expirationTime: t,
      maxReactionCount: 6,
    });
    await db.create({
      ...base,
      memberId: "member-3",
      messageId: "msg-3",
      expirationTime: t,
      maxReactionCount: 5,
    });

    const { byAttainment } = await db.topByRole("guild-1", "role-1", 3);

    expect(byAttainment.map((e) => e.memberId)).toEqual([
      "member-2",
      "member-3",
      "member-1",
    ]);
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

  it("findAllByGuild excludes rows marked spent", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const record = await db.create({ ...base, expirationTime: future });
    await db.create({
      ...base,
      messageId: "msg-2",
      expirationTime: future,
    });
    await db.markSpent(record.id);

    const rows = await db.findAllByGuild("guild-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].messageId).toBe("msg-2");
  });

  it("findAllByMemberRole excludes rows marked spent", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const record = await db.create({ ...base, expirationTime: future });
    await db.create({
      ...base,
      messageId: "msg-2",
      expirationTime: future,
    });
    await db.markSpent(record.id);

    const rows = await db.findAllByMemberRole("guild-1", "member-1", "role-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].messageId).toBe("msg-2");
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

  describe("topByRole windowing", () => {
    // createdAt comes from Date.now() inside create(), so the clock is
    // what places a row inside or outside a window.
    const createAt = async (when, overrides) => {
      vi.setSystemTime(when);
      await db.create({
        ...base,
        expirationTime: new Date(when.getTime() + 60 * 60 * 1000),
        ...overrides,
      });
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("counts only rows created inside the window", async () => {
      await createAt(new Date("2026-07-15T12:00:00.000Z"), {
        memberId: "before",
        messageId: "msg-before",
        maxReactionCount: 50,
      });
      await createAt(new Date("2026-08-15T12:00:00.000Z"), {
        memberId: "inside",
        messageId: "msg-inside",
        maxReactionCount: 7,
      });
      await createAt(new Date("2026-09-15T12:00:00.000Z"), {
        memberId: "after",
        messageId: "msg-after",
        maxReactionCount: 90,
      });

      const { byVotes } = await db.topByRole("guild-1", "role-1", 3, {
        since: new Date("2026-08-01T05:00:00.000Z"),
        until: new Date("2026-09-01T05:00:00.000Z"),
      });

      expect(byVotes).toEqual([
        expect.objectContaining({ memberId: "inside", totalReactions: 7 }),
      ]);
    });

    it("treats the window as half-open so adjacent months can't double-count a row", async () => {
      const boundary = new Date("2026-09-01T05:00:00.000Z");
      await createAt(boundary, {
        memberId: "boundary",
        messageId: "msg-boundary",
        maxReactionCount: 4,
      });

      const august = await db.topByRole("guild-1", "role-1", 3, {
        since: new Date("2026-08-01T05:00:00.000Z"),
        until: boundary,
      });
      const september = await db.topByRole("guild-1", "role-1", 3, {
        since: boundary,
        until: new Date("2026-10-01T05:00:00.000Z"),
      });

      expect(august.byVotes).toHaveLength(0);
      expect(september.byVotes).toHaveLength(1);
    });

    it("accepts raw millisecond bounds as well as Dates", async () => {
      await createAt(new Date("2026-08-15T12:00:00.000Z"), {
        memberId: "inside",
        messageId: "msg-inside",
        maxReactionCount: 7,
      });

      const { byVotes } = await db.topByRole("guild-1", "role-1", 3, {
        since: new Date("2026-08-01T05:00:00.000Z").getTime(),
        until: new Date("2026-09-01T05:00:00.000Z").getTime(),
      });

      expect(byVotes).toHaveLength(1);
    });

    it("still counts a row whose role has since expired and been marked spent", async () => {
      await createAt(new Date("2026-08-15T12:00:00.000Z"), {
        memberId: "expired",
        messageId: "msg-expired",
        maxReactionCount: 11,
      });
      const row = await db.findByMessageId("msg-expired");
      await db.markSpent(row.id);

      const { byVotes } = await db.topByRole("guild-1", "role-1", 3, {
        since: new Date("2026-08-01T05:00:00.000Z"),
        until: new Date("2026-09-01T05:00:00.000Z"),
      });

      expect(byVotes).toEqual([
        expect.objectContaining({ memberId: "expired", totalReactions: 11 }),
      ]);
    });

    it("counts everything when no window is passed", async () => {
      await createAt(new Date("2026-07-15T12:00:00.000Z"), {
        memberId: "member-1",
        messageId: "msg-old",
        maxReactionCount: 3,
      });
      await createAt(new Date("2026-09-15T12:00:00.000Z"), {
        memberId: "member-1",
        messageId: "msg-new",
        maxReactionCount: 4,
      });

      const { byVotes } = await db.topByRole("guild-1", "role-1", 3);

      expect(byVotes[0]).toMatchObject({ totalReactions: 7, postCount: 2 });
    });
  });
});
