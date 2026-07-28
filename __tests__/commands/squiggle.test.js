import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createDB from "../../src/models/tempRole.js";

vi.mock("../../config/config.json", () => ({
  default: {
    workers: {
      reactionRoles: [{ roleName: "Cool Person" }],
      combinedReactionRoles: [{ roleName: "Controversial Person" }],
    },
  },
}));

vi.mock("discord.js", () => ({
  PermissionFlagsBits: { Administrator: 8n },
  MessageFlags: { Ephemeral: 64 },
  EmbedBuilder: class {
    setTitle() {
      return this;
    }
    setColor() {
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

const makeInteraction = ({
  sub,
  member = makeMember(),
  role = makeRole(),
  admin = true,
} = {}) => ({
  id: "interaction-1",
  guildId: "guild-1",
  guild: {
    roles: {
      cache: { find: vi.fn((fn) => guildRoles.find(fn)) },
    },
  },
  memberPermissions: { has: vi.fn().mockReturnValue(admin) },
  options: {
    getSubcommand: vi.fn().mockReturnValue(sub),
    getMember: vi.fn().mockReturnValue(member),
    getRole: vi.fn().mockReturnValue(role),
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

  it("expire removes role and deletes matching rows", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await db.create({ ...base, expirationTime: future });

    const member = makeMember();
    const interaction = makeInteraction({ sub: "expire", member });
    await init(interaction, mockClient, db);

    expect(member.roles.remove).toHaveBeenCalled();
    expect(
      await db.findAllByMemberRole("guild-1", "member-1", "role-1"),
    ).toHaveLength(0);
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
    });
    await db.create({
      ...base,
      memberId: "member-1",
      messageId: "msg-2",
      expirationTime: t,
    });
    await db.create({
      ...base,
      memberId: "member-2",
      messageId: "msg-3",
      expirationTime: t,
    });
    await db.create({
      ...base,
      memberId: "member-3",
      roleId: "combined-role-1",
      roleName: "Controversial Person",
      messageId: "msg-4",
      expirationTime: t,
    });

    const interaction = makeInteraction({ sub: "leaderboard" });
    await init(interaction, mockClient, db);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    const coolField = embed.fields.find((f) => f.name === "Cool Person");
    const controversialField = embed.fields.find(
      (f) => f.name === "Controversial Person",
    );

    expect(coolField.value).toBe("1. **testuser** — 2\n2. **testuser** — 1");
    expect(controversialField.value).toBe("1. **testuser** — 1");
  });

  it("leaderboard shows a placeholder for roles with no data", async () => {
    const interaction = makeInteraction({ sub: "leaderboard" });
    await init(interaction, mockClient, db);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    expect(embed.fields).toEqual([
      { name: "Cool Person", value: "No data yet" },
      { name: "Controversial Person", value: "No data yet" },
    ]);
  });
});
