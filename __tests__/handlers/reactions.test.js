import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleReactionAdd, handleReactionRemove } from "../../src/handlers/reactions.js";

// --- Module mocks ---

vi.mock("../../src/utils/sendDebugMessage.js", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/utils/canPostInChannel.js", () => ({
  default: vi.fn().mockReturnValue(true),
}));

vi.mock("discord.js", () => ({
  EmbedBuilder: class {
    setTitle() { return this; }
    setColor() { return this; }
    setAuthor() { return this; }
    setTimestamp() { return this; }
  },
}));

// --- Test config ---

const testConfig = {
  workers: {
    reactionRoles: [
      { emojiName: "👍", threshold: 3, roleName: "Good Person", color: "#00ff00" },
    ],
    combinedReactionRoles: [
      {
        emojiNames: ["TheBest", "TheWorst"],
        threshold: 2,
        roleName: "Controversial Person",
        color: "#ff00ff",
      },
    ],
  },
};

// --- Mock deps ---

const mockClient = { user: { id: "bot-id" } };

const mockTempRole = {
  findByMessageId: vi.fn().mockResolvedValue(null),
  findByKey: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue(undefined),
  extend: vi.fn().mockResolvedValue(undefined),
  deleteById: vi.fn().mockResolvedValue(undefined),
};

const deps = () => ({ client: mockClient, TempRole: mockTempRole, config: testConfig });

// --- Factories ---

const makeMember = (id = "user-id") => ({
  id,
  nickname: null,
  user: { username: "testuser" },
  roles: {
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  displayAvatarURL: vi.fn().mockReturnValue("https://example.com/avatar"),
});

const makeGuild = (overrides = {}) => ({
  id: "guild-id",
  roles: {
    cache: {
      find: vi.fn().mockReturnValue({ id: "role-id", name: "Good Person" }),
    },
  },
  members: {
    fetch: vi.fn().mockResolvedValue(makeMember()),
  },
  channels: { cache: { find: vi.fn().mockReturnValue(undefined) } },
  ...overrides,
});

const makeMessage = (overrides = {}) => ({
  id: "msg-id",
  partial: false,
  author: { id: "author-id", bot: false },
  channel: { name: "general", send: vi.fn().mockResolvedValue(undefined) },
  guild: makeGuild(),
  reactions: { cache: { find: vi.fn() } },
  reply: vi.fn().mockResolvedValue(undefined),
  forward: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const makeReaction = (overrides = {}) => ({
  emoji: { name: "👍" },
  count: 4,
  me: true,
  message: makeMessage(),
  ...overrides,
});

const makeUser = (id = "reactor-id") => ({ id, username: "reactor" });

beforeEach(() => {
  vi.clearAllMocks();
  mockTempRole.findByMessageId.mockReset().mockResolvedValue(null);
  mockTempRole.findByKey.mockReset().mockResolvedValue(null);
  mockTempRole.create.mockReset().mockResolvedValue(undefined);
  mockTempRole.extend.mockReset().mockResolvedValue(undefined);
  mockTempRole.deleteById.mockReset().mockResolvedValue(undefined);
});

// --- messageReactionAdd tests ---

describe("messageReactionAdd handler", () => {
  it("ignores reactions from the bot itself", async () => {
    await handleReactionAdd(makeReaction(), makeUser("bot-id"), deps());
    expect(mockTempRole.findByKey).not.toHaveBeenCalled();
  });

  it("ignores reactions in disallowed channels", async () => {
    const { default: canPostInChannel } = await import("../../src/utils/canPostInChannel.js");
    canPostInChannel.mockReturnValueOnce(false);

    await handleReactionAdd(makeReaction(), makeUser(), deps());
    expect(mockTempRole.findByKey).not.toHaveBeenCalled();
  });

  it("ignores reactions from the message author", async () => {
    const reaction = makeReaction();
    reaction.message.author.id = "same-user";
    await handleReactionAdd(reaction, makeUser("same-user"), deps());
    expect(mockTempRole.findByKey).not.toHaveBeenCalled();
  });

  it("skips when emoji does not match any configured reaction role", async () => {
    const reaction = makeReaction({ emoji: { name: "❤️" } });
    await handleReactionAdd(reaction, makeUser(), deps());
    expect(mockTempRole.create).not.toHaveBeenCalled();
  });

  it("does not grant role when below threshold", async () => {
    // count=2, me=true → humanCount=1, threshold=3
    const reaction = makeReaction({ count: 2, me: true });
    await handleReactionAdd(reaction, makeUser(), deps());
    expect(mockTempRole.create).not.toHaveBeenCalled();
  });

  it("grants role and creates TempRole when threshold is first reached", async () => {
    // count=4, me=true → humanCount=3 = threshold
    const reaction = makeReaction({ count: 4, me: true });
    await handleReactionAdd(reaction, makeUser(), deps());
    expect(reaction.message.guild.members.fetch).toHaveBeenCalled();
    expect(mockTempRole.create).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: "role-id", messageId: "msg-id" }),
    );
    expect(reaction.message.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("extends expiration when a genuinely new reactor pushes count above HWM", async () => {
    const existingTempRole = {
      id: 1,
      maxReactionCount: 3,
      expirationTime: new Date(Date.now() + 10 * 60 * 60 * 1000),
    };
    mockTempRole.findByKey.mockResolvedValueOnce(existingTempRole);

    // humanCount=4 > maxReactionCount=3 → extend
    const reaction = makeReaction({ count: 5, me: true });
    await handleReactionAdd(reaction, makeUser(), deps());

    expect(mockTempRole.extend).toHaveBeenCalledWith(
      existingTempRole.id,
      expect.any(Date),
      4,
    );
    expect(reaction.message.reply).toHaveBeenCalledWith(
      expect.stringContaining("extended"),
    );
  });

  it("does not extend when count is at or below stored HWM", async () => {
    const existingTempRole = {
      id: 1,
      maxReactionCount: 4,
      expirationTime: new Date(Date.now() + 10 * 60 * 60 * 1000),
    };
    mockTempRole.findByKey.mockResolvedValueOnce(existingTempRole);

    // humanCount=4 = maxReactionCount=4 → no extend
    const reaction = makeReaction({ count: 5, me: true });
    await handleReactionAdd(reaction, makeUser(), deps());

    expect(mockTempRole.extend).not.toHaveBeenCalled();
    expect(reaction.message.reply).not.toHaveBeenCalled();
  });

  it("does not roll back role on SequelizeUniqueConstraintError (race condition)", async () => {
    const uniqueError = new Error("Unique constraint");
    uniqueError.name = "SequelizeUniqueConstraintError";
    mockTempRole.create.mockRejectedValueOnce(uniqueError);

    const reaction = makeReaction({ count: 4, me: true });
    await handleReactionAdd(reaction, makeUser(), deps());

    const member = await reaction.message.guild.members.fetch.mock.results[0].value;
    expect(member.roles.remove).not.toHaveBeenCalled();
  });

  it("looks up real memberId from TempRole when message is bot-authored", async () => {
    mockTempRole.findByMessageId.mockResolvedValueOnce({ memberId: "real-user-id" });
    mockTempRole.findByKey.mockResolvedValue(null);

    const reaction = makeReaction({ emoji: { name: "👍" }, count: 4, me: true });
    reaction.message.author = { id: "bot-id", bot: true };

    await handleReactionAdd(reaction, makeUser(), deps());

    expect(reaction.message.guild.members.fetch).toHaveBeenCalledWith("real-user-id");
  });

  it("returns early when bot-authored message has no source TempRole", async () => {
    mockTempRole.findByMessageId.mockResolvedValueOnce(null);

    const reaction = makeReaction();
    reaction.message.author = { id: "bot-id", bot: true };

    await handleReactionAdd(reaction, makeUser(), deps());

    expect(mockTempRole.create).not.toHaveBeenCalled();
  });
});

// --- Combined reaction role tests ---

describe("combined reaction role handling", () => {
  const makeCombinedReaction = (bestCount, worstCount) => {
    const reaction = makeReaction({ emoji: { name: "TheBest" } });
    reaction.message.reactions.cache.find = vi.fn().mockImplementation((fn) => {
      const best = { emoji: { name: "TheBest" }, count: bestCount + 1, me: true };
      const worst = { emoji: { name: "TheWorst" }, count: worstCount + 1, me: true };
      return fn(best) ? best : fn(worst) ? worst : undefined;
    });
    reaction.message.guild.roles.cache.find = vi.fn().mockReturnValue({
      id: "combined-role-id",
      name: "Controversial Person",
    });
    return reaction;
  };

  it("does not grant combined role when only one emoji hits threshold", async () => {
    const reaction = makeCombinedReaction(2, 1); // TheBest=2 ✓, TheWorst=1 ✗
    await handleReactionAdd(reaction, makeUser(), deps());
    expect(mockTempRole.create).not.toHaveBeenCalled();
  });

  it("grants combined role when all emoji hit threshold", async () => {
    const reaction = makeCombinedReaction(2, 2); // both ≥ 2
    mockTempRole.findByKey
      .mockResolvedValueOnce(null) // regular reactionRoles path
      .mockResolvedValueOnce(null); // combined path

    await handleReactionAdd(reaction, makeUser(), deps());

    expect(mockTempRole.create).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: "combined-role-id" }),
    );
  });

  it("uses Math.min of counts as HWM to prevent gaming via single-emoji inflation", async () => {
    const existingTempRole = {
      id: 2,
      maxReactionCount: 3,
      expirationTime: new Date(Date.now() + 10 * 60 * 60 * 1000),
    };
    mockTempRole.findByKey
      .mockResolvedValueOnce(null) // regular path
      .mockResolvedValueOnce(existingTempRole); // combined path

    // TheBest=5 (inflated), TheWorst=3 → min=3 = stored HWM → no extend
    const reaction = makeCombinedReaction(5, 3);
    await handleReactionAdd(reaction, makeUser(), deps());

    expect(mockTempRole.extend).not.toHaveBeenCalled();
  });
});

// --- messageReactionRemove tests ---

describe("messageReactionRemove handler", () => {
  const makeCombinedRemoveReaction = (bestCount, worstCount) => {
    const reaction = makeReaction({ emoji: { name: "TheBest" } });
    reaction.message.reactions.cache.find = vi.fn().mockImplementation((fn) => {
      const best = { emoji: { name: "TheBest" }, count: bestCount + 1, me: true };
      const worst = { emoji: { name: "TheWorst" }, count: worstCount + 1, me: true };
      return fn(best) ? best : fn(worst) ? worst : undefined;
    });
    reaction.message.guild.roles.cache.find = vi.fn().mockReturnValue({
      id: "combined-role-id",
      name: "Controversial Person",
    });
    return reaction;
  };

  it("revokes combined role when emoji count drops below threshold", async () => {
    const existingTempRole = { id: 99 };
    mockTempRole.findByKey.mockResolvedValueOnce(existingTempRole);

    // TheBest drops to 1, below threshold=2 → revoke
    const reaction = makeCombinedRemoveReaction(1, 2);
    await handleReactionRemove(reaction, makeUser(), deps());

    const member = await reaction.message.guild.members.fetch.mock.results[0].value;
    expect(member.roles.remove).toHaveBeenCalled();
    expect(mockTempRole.deleteById).toHaveBeenCalledWith(existingTempRole.id);
  });

  it("does not revoke combined role when all counts still meet threshold", async () => {
    // both still ≥ 2 → keep role
    const reaction = makeCombinedRemoveReaction(2, 2);
    await handleReactionRemove(reaction, makeUser(), deps());

    expect(mockTempRole.findByKey).not.toHaveBeenCalled();
  });

  it("does nothing when no TempRole exists for the combined role", async () => {
    mockTempRole.findByKey.mockResolvedValueOnce(null);

    const reaction = makeCombinedRemoveReaction(1, 1); // below threshold
    const member = makeMember();
    reaction.message.guild.members.fetch = vi.fn().mockResolvedValue(member);

    await handleReactionRemove(reaction, makeUser(), deps());

    expect(member.roles.remove).not.toHaveBeenCalled();
  });
});
