import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createDB from "../../src/models/tempRole.js";

vi.mock("../../src/utils/sendDebugMessage.js", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

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

let db;

beforeEach(async () => {
  db = await createDB();
  vi.clearAllMocks();
  mockMember.roles.remove.mockResolvedValue(undefined);
  mockGuild.members.fetch.mockResolvedValue(mockMember);
});

afterEach(async () => {
  await db.close();
});

const { run } = await import("../../src/workers/temp-roles.js");

describe("temp-roles worker", () => {
  it("does nothing when no roles are expired", async () => {
    await db.create({
      ...base,
      expirationTime: new Date(Date.now() + 60 * 60 * 1000),
    });

    await run(mockClient, db);

    expect(mockMember.roles.remove).not.toHaveBeenCalled();
    expect(await db.findByKey("guild-1", "member-1", "role-1", "msg-1")).not.toBeNull();
  });

  it("removes role and deletes all matching rows when expired with no later row", async () => {
    await db.create({
      ...base,
      expirationTime: new Date(Date.now() - 60 * 60 * 1000),
    });

    await run(mockClient, db);

    expect(mockMember.roles.remove).toHaveBeenCalledWith(mockRole);
    expect(await db.findByKey("guild-1", "member-1", "role-1", "msg-1")).toBeNull();
  });

  it("only deletes expired row when a later expiration exists, role stays", async () => {
    await db.create({
      ...base,
      expirationTime: new Date(Date.now() - 60 * 60 * 1000),
    });
    await db.create({
      ...base,
      messageId: "msg-2",
      expirationTime: new Date(Date.now() + 60 * 60 * 1000),
    });

    await run(mockClient, db);

    expect(mockMember.roles.remove).not.toHaveBeenCalled();
    expect(await db.findByKey("guild-1", "member-1", "role-1", "msg-1")).toBeNull();
    expect(await db.findByKey("guild-1", "member-1", "role-1", "msg-2")).not.toBeNull();
  });

  it("destroys orphaned row and skips role removal when guild not in cache", async () => {
    await db.create({
      ...base,
      expirationTime: new Date(Date.now() - 60 * 60 * 1000),
    });
    mockClient.guilds.cache.get.mockReturnValueOnce(undefined);

    await run(mockClient, db);

    expect(mockMember.roles.remove).not.toHaveBeenCalled();
    expect(await db.findByKey("guild-1", "member-1", "role-1", "msg-1")).toBeNull();
  });

  it("destroys orphaned row and skips role removal when role not in cache", async () => {
    await db.create({
      ...base,
      expirationTime: new Date(Date.now() - 60 * 60 * 1000),
    });
    mockGuild.roles.cache.get.mockReturnValueOnce(undefined);

    await run(mockClient, db);

    expect(mockMember.roles.remove).not.toHaveBeenCalled();
    expect(await db.findByKey("guild-1", "member-1", "role-1", "msg-1")).toBeNull();
  });

  it("catches errors and does not throw", async () => {
    await db.create({
      ...base,
      expirationTime: new Date(Date.now() - 60 * 60 * 1000),
    });
    mockGuild.members.fetch.mockRejectedValueOnce(new Error("fetch failed"));

    await expect(run(mockClient, db)).resolves.toBeUndefined();
  });

  it("handles multiple expired roles in one pass", async () => {
    await db.create({
      ...base,
      expirationTime: new Date(Date.now() - 60 * 60 * 1000),
    });
    await db.create({
      ...base,
      memberId: "member-2",
      memberName: "other",
      messageId: "msg-2",
      expirationTime: new Date(Date.now() - 30 * 60 * 1000),
    });

    await run(mockClient, db);

    expect(mockMember.roles.remove).toHaveBeenCalledTimes(2);
    expect((await db.findExpired()).length).toBe(0);
  });
});
