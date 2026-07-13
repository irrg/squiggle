import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import createDB from "../../src/models/tempRole.js";

vi.mock("../../config/config.json", () => ({
  default: {
    bot: { commandPrefix: "" },
    commands: {
      didAThing: [
        { name: "coding", role: "People who coded today", color: "#5865F2" },
      ],
    },
  },
}));

vi.mock("discord.js", () => ({
  ApplicationCommandOptionType: { String: 3 },
  MessageFlags: { Ephemeral: 64 },
  EmbedBuilder: class {
    setTitle() {
      return this;
    }
    setColor() {
      return this;
    }
    setAuthor() {
      return this;
    }
    setDescription() {
      return this;
    }
    setTimestamp() {
      return this;
    }
  },
}));

const { init, options } = await import("../../src/commands/did-a-thing.js");

let db;

beforeEach(async () => {
  db = await createDB();
  vi.clearAllMocks();
});

afterEach(async () => {
  await db.close();
});

const makeReply = () => ({
  id: "reply-msg-id",
  react: vi.fn().mockResolvedValue(undefined),
});

const makeInteraction = (thingName = "coding") => {
  const reply = makeReply();
  const interaction = {
    member: {
      id: "member-1",
      nickname: null,
      user: { username: "testuser" },
      guild: {
        id: "guild-1",
        roles: {
          cache: {
            find: vi.fn().mockReturnValue({
              id: "role-1",
              name: "People who coded today",
            }),
          },
        },
      },
      roles: {
        add: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      displayAvatarURL: vi.fn().mockReturnValue("https://example.com/avatar"),
    },
    options: {
      getString: vi
        .fn()
        .mockImplementation((key) =>
          key === "thing" ? thingName : "I wrote some code!",
        ),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(reply),
    followUp: vi.fn().mockResolvedValue(undefined),
    _reply: reply,
  };
  return interaction;
};

const mockClient = {
  channels: { cache: { find: vi.fn().mockReturnValue(undefined) } },
};

describe("did-a-thing command", () => {
  it("declares caption as required with no misleading label", () => {
    const caption = options.find((o) => o.name === "caption");
    expect(caption.required).toBe(true);
    expect(caption.description).not.toContain("optional");
  });

  it("replies ephemeral when thing not in config", async () => {
    const interaction = makeInteraction("unknown-thing");

    await init(interaction, mockClient, db);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
    expect(interaction.member.roles.add).not.toHaveBeenCalled();
  });

  it("replies ephemeral when role not found in guild", async () => {
    const interaction = makeInteraction();
    interaction.member.guild.roles.cache.find.mockReturnValue(undefined);

    await init(interaction, mockClient, db);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
    expect(interaction.member.roles.add).not.toHaveBeenCalled();
  });

  it("adds role, creates TempRole with maxReactionCount 1, and reacts 🙌", async () => {
    const interaction = makeInteraction();

    await init(interaction, mockClient, db);

    expect(interaction.member.roles.add).toHaveBeenCalled();
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalled();
    expect(interaction._reply.react).toHaveBeenCalledWith("🙌");

    const row = await db.findByKey(
      "guild-1",
      "member-1",
      "role-1",
      "reply-msg-id",
    );
    expect(row).not.toBeNull();
    expect(row.memberId).toBe("member-1");
    expect(row.roleId).toBe("role-1");
    expect(row.messageId).toBe("reply-msg-id");
    expect(row.maxReactionCount).toBe(1);
    expect(row.expirationTime.getTime()).toBeGreaterThan(Date.now());
  });

  it("removes role and sends followUp when DB write fails", async () => {
    const interaction = makeInteraction();

    // Pre-create a row with the same unique key to force a constraint error.
    // We intercept editReply so we can insert the conflicting row before db.create runs.
    const original = interaction.editReply;
    interaction.editReply = vi.fn().mockImplementation(async (...args) => {
      const result = await original(...args);
      await db.create({
        guildId: "guild-1",
        memberId: "member-1",
        roleId: "role-1",
        messageId: "reply-msg-id",
        memberName: "testuser",
        roleName: "People who coded today",
        expirationTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        maxReactionCount: 1,
      });
      return result;
    });

    await init(interaction, mockClient, db);

    expect(interaction.member.roles.remove).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64 }),
    );
  });
});
