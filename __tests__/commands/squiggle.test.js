import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createDB from "../../src/models/tempRole.js";

vi.mock("../../config/config.json", () => ({
  default: {
    workers: {
      reactionRoles: [
        { roleName: "Cool Person", emojiName: "😎" },
        { roleName: "Missing Role" },
      ],
      combinedReactionRoles: [
        { roleName: "Controversial Person", emojiNames: ["PogChamp"] },
      ],
    },
  },
}));

vi.mock("discord.js", () => ({
  PermissionFlagsBits: { Administrator: 8n },
  MessageFlags: { Ephemeral: 64 },
  EmbedBuilder: class {
    setTitle(title) {
      this.title = title;
      return this;
    }
    setColor() {
      return this;
    }
    setDescription(description) {
      this.description = description;
      return this;
    }
    addFields(fields) {
      this.fields = fields;
      return this;
    }
  },
}));

vi.mock("../../src/workers/temp-roles.js", () => ({
  run: vi.fn().mockResolvedValue(undefined),
}));

const { init } = await import("../../src/commands/squiggle.js");

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
  vi.clearAllMocks();
});

afterEach(async () => {
  await db.close();
});

const makeMember = () => ({
  id: "member-1",
  displayName: "testuser",
  nickname: null,
  user: { username: "testuser" },
  roles: {
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
});

const makeRole = () => ({ id: "role-1", name: "Cool Person" });

const guildRoles = [
  { id: "role-1", name: "Cool Person" },
  { id: "combined-role-1", name: "Controversial Person" },
];

const guildEmojis = [{ id: "999", name: "PogChamp" }];

const makeInteraction = ({
  sub,
  member = makeMember(),
  role = makeRole(),
  admin = true,
  period = null,
} = {}) => ({
  id: "interaction-1",
  guildId: "guild-1",
  guild: {
    id: "guild-1",
    roles: {
      cache: { find: vi.fn((fn) => guildRoles.find(fn)) },
    },
    emojis: {
      cache: { find: vi.fn((fn) => guildEmojis.find(fn)) },
    },
    members: {
      cache: { get: vi.fn(() => undefined) },
      fetch: vi.fn().mockRejectedValue(new Error("not in guild")),
    },
  },
  memberPermissions: { has: vi.fn().mockReturnValue(admin) },
  options: {
    getSubcommand: vi.fn().mockReturnValue(sub),
    getMember: vi.fn().mockReturnValue(member),
    getRole: vi.fn().mockReturnValue(role),
    getString: vi.fn().mockReturnValue(period),
  },
  reply: vi.fn().mockResolvedValue(undefined),
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
});

const mockClient = {};

describe("squiggle admin command", () => {
  it("rejects non-admins", async () => {
    const interaction = makeInteraction({ sub: "list", admin: false });

    await init(interaction, mockClient, db);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Admin only.", flags: 64 }),
    );
  });

  it("allows non-admins to run leaderboard", async () => {
    const interaction = makeInteraction({ sub: "leaderboard", admin: false });

    await init(interaction, mockClient, db);

    expect(interaction.reply).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: "Admin only." }),
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("list shows only the current guild's temp roles", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await db.create({ ...base, expirationTime: future });
    await db.create({
      ...base,
      guildId: "guild-2",
      memberName: "otherguild-user",
      messageId: "msg-2",
      expirationTime: future,
    });

    const interaction = makeInteraction({ sub: "list" });
    await init(interaction, mockClient, db);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    expect(embed.fields).toHaveLength(1);
    expect(embed.fields[0].name).toContain("testuser");
  });

  it("expire replies gracefully when member is not in the guild", async () => {
    const interaction = makeInteraction({ sub: "expire", member: null });

    await init(interaction, mockClient, db);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Member not found"),
      }),
    );
  });

  it("grant replies gracefully when member is not in the guild", async () => {
    const interaction = makeInteraction({ sub: "grant", member: null });

    await init(interaction, mockClient, db);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Member not found"),
      }),
    );
  });

  it("expire removes role and marks matching rows spent", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await db.create({ ...base, expirationTime: future });

    const member = makeMember();
    const interaction = makeInteraction({ sub: "expire", member });
    await init(interaction, mockClient, db);

    expect(member.roles.remove).toHaveBeenCalled();
    expect(
      await db.findAllByMemberRole("guild-1", "member-1", "role-1"),
    ).toHaveLength(0);
    const row = await db.findByKey("guild-1", "member-1", "role-1", "msg-1");
    expect(row.spent).toBe(true);
  });

  it("grant adds role and creates a record", async () => {
    const member = makeMember();
    const interaction = makeInteraction({ sub: "grant", member });
    await init(interaction, mockClient, db);

    expect(member.roles.add).toHaveBeenCalled();
    const rows = await db.findAllByMemberRole("guild-1", "member-1", "role-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].expirationTime.getTime()).toBeGreaterThan(Date.now());
  });

  it("leaderboard ranks members per configured reaction role", async () => {
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
      maxReactionCount: 5,
    });
    await db.create({
      ...base,
      memberId: "member-2",
      messageId: "msg-3",
      expirationTime: t,
      maxReactionCount: 6,
    });
    await db.create({
      ...base,
      memberId: "member-3",
      roleId: "combined-role-1",
      roleName: "Controversial Person",
      messageId: "msg-4",
      expirationTime: t,
      maxReactionCount: 4,
    });

    const interaction = makeInteraction({ sub: "leaderboard" });
    await init(interaction, mockClient, db);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];

    expect(embed.fields).toEqual([
      { name: "​", value: "​" },
      { name: "😎 Cool Person", value: "​" },
      {
        name: "🔥 Most Popular",
        value: "1. **testuser** — 9 votes\n2. **testuser** — 6 votes",
        inline: true,
      },
      {
        name: "🎖️ Most Attained",
        value: "1. **testuser** — 2 times\n2. **testuser** — 1 time",
        inline: true,
      },
      { name: "​", value: "​" },
      { name: "Missing Role", value: expect.stringContaining("not found") },
      { name: "​", value: "​" },
      { name: "<:PogChamp:999> Controversial Person", value: "​" },
      {
        name: "🔥 Most Popular",
        value: "1. **testuser** — 4 votes",
        inline: true,
      },
      {
        name: "🎖️ Most Attained",
        value: "1. **testuser** — 1 time",
        inline: true,
      },
    ]);
  });

  it("leaderboard shows a placeholder for roles with no data", async () => {
    const interaction = makeInteraction({ sub: "leaderboard" });
    await init(interaction, mockClient, db);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    expect(embed.fields).toEqual([
      { name: "​", value: "​" },
      { name: "😎 Cool Person", value: "No data yet" },
      { name: "​", value: "​" },
      { name: "Missing Role", value: expect.stringContaining("not found") },
      { name: "​", value: "​" },
      { name: "<:PogChamp:999> Controversial Person", value: "No data yet" },
    ]);
  });

  it("leaderboard flags a configured role that doesn't exist in the guild instead of silently dropping it", async () => {
    const interaction = makeInteraction({ sub: "leaderboard" });
    await init(interaction, mockClient, db);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const missingField = embed.fields.find((f) => f.name === "Missing Role");
    expect(missingField.value).toContain("not found");
  });
});

describe("squiggle preview", () => {
  const seedAugustAndNow = async () => {
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    await db.create({
      ...base,
      messageId: "msg-august",
      expirationTime: new Date("2026-08-15T18:00:00.000Z"),
      maxReactionCount: 4,
    });
    vi.setSystemTime(new Date("2026-11-09T18:00:00.000Z"));
    await db.create({
      ...base,
      memberId: "member-2",
      messageId: "msg-november",
      expirationTime: new Date("2026-11-10T06:00:00.000Z"),
      maxReactionCount: 9,
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is admin-only and replies only to the caller", async () => {
    vi.setSystemTime(new Date("2026-11-09T18:00:00.000Z"));
    const denied = makeInteraction({ sub: "preview", admin: false });
    await init(denied, mockClient, db);
    expect(denied.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Admin only.", flags: 64 }),
    );

    const allowed = makeInteraction({ sub: "preview" });
    await init(allowed, mockClient, db);
    expect(allowed.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
  });

  it("previews the month in progress alongside year-to-date", async () => {
    await seedAugustAndNow();

    const interaction = makeInteraction({ sub: "preview" });
    await init(interaction, mockClient, db);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    expect(embed.title).toBe("Monthly Absolute Best (preview)");

    const popular = embed.fields.find((f) => f.name === "🔥 Most Popular");
    // November's window excludes the August row; the year's includes both.
    expect(popular.value).toBe(
      "**November 2026 (so far)**\n1. **testuser** — 9 votes\n\n" +
        "**Year to Date**\n1. **testuser** — 9 votes\n2. **testuser** — 4 votes",
    );
  });

  it("previews the year-end wrap-up months before January", async () => {
    await seedAugustAndNow();

    const interaction = makeInteraction({
      sub: "preview",
      period: "year-end",
    });
    await init(interaction, mockClient, db);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    expect(embed.title).toBe("Absolute Best — 2026 in Review (preview)");
    expect(
      embed.fields.find((f) => f.name === "🔥 Most Popular").value,
    ).toContain("**Best of 2026 (so far)**");
  });
});
