import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { Sequelize } from "sequelize";
import TempRoleModel from "../../src/models/tempRole.js";

vi.mock("../../src/utils/sendDebugMessage.js", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: ":memory:",
  logging: false,
});
const TempRole = TempRoleModel(sequelize);

const mockRole = { name: "Cool Person", id: "role-1" };
const mockMember = {
  nickname: null,
  user: { username: "testuser" },
  roles: { remove: vi.fn().mockResolvedValue(undefined) },
};
const mockGuild = {
  id: "guild-1",
  roles: { cache: { get: vi.fn().mockReturnValue(mockRole) } },
  members: { fetch: vi.fn().mockResolvedValue(mockMember) },
};
const mockClient = {
  guilds: { cache: { get: vi.fn().mockReturnValue(mockGuild) } },
  channels: { cache: { find: vi.fn().mockReturnValue(undefined) } },
};

const base = {
  guildId: "guild-1",
  memberId: "member-1",
  memberName: "testuser",
  roleId: "role-1",
  roleName: "Cool Person",
  messageId: "msg-1",
};

beforeAll(async () => {
  global.appRoot = new URL("../..", import.meta.url).pathname;
  await TempRole.sync({ force: true });
});

beforeEach(async () => {
  await TempRole.destroy({ where: {}, truncate: true });
  vi.clearAllMocks();
  mockMember.roles.remove.mockResolvedValue(undefined);
  mockGuild.members.fetch.mockResolvedValue(mockMember);
});

const { run } = await import("../../src/workers/temp-roles.js");

describe("temp-roles worker", () => {
  it("does nothing when no roles are expired", async () => {
    await TempRole.create({
      ...base,
      expirationTime: new Date(Date.now() + 60 * 60 * 1000),
    });

    await run(mockClient, sequelize);

    expect(mockMember.roles.remove).not.toHaveBeenCalled();
    expect(await TempRole.count()).toBe(1);
  });

  it("removes role and deletes all matching rows when expired with no later row", async () => {
    await TempRole.create({
      ...base,
      expirationTime: new Date(Date.now() - 60 * 60 * 1000),
    });

    await run(mockClient, sequelize);

    expect(mockMember.roles.remove).toHaveBeenCalledWith(mockRole);
    expect(await TempRole.count()).toBe(0);
  });

  it("only deletes expired row when a later expiration exists, role stays", async () => {
    await TempRole.create({
      ...base,
      expirationTime: new Date(Date.now() - 60 * 60 * 1000),
    });
    await TempRole.create({
      ...base,
      messageId: "msg-2",
      expirationTime: new Date(Date.now() + 60 * 60 * 1000),
    });

    await run(mockClient, sequelize);

    expect(mockMember.roles.remove).not.toHaveBeenCalled();
    expect(await TempRole.count()).toBe(1);
    const remaining = await TempRole.findOne({ where: {} });
    expect(remaining.messageId).toBe("msg-2");
  });

  it("handles multiple expired roles in one pass", async () => {
    await TempRole.create({
      ...base,
      expirationTime: new Date(Date.now() - 60 * 60 * 1000),
    });
    await TempRole.create({
      ...base,
      memberId: "member-2",
      memberName: "other",
      messageId: "msg-2",
      expirationTime: new Date(Date.now() - 30 * 60 * 1000),
    });

    await run(mockClient, sequelize);

    expect(mockMember.roles.remove).toHaveBeenCalledTimes(2);
    expect(await TempRole.count()).toBe(0);
  });
});
