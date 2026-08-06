import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/sendDebugMessage.js", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("discord.js", () => ({
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

let mockConfig = {
  workers: {
    leaderboardChannel: "leaderboard-channel",
    reactionRoles: [{ roleName: "Good Person" }],
    combinedReactionRoles: [],
  },
};

vi.mock("../../config/config.json", () => ({
  get default() {
    return mockConfig;
  },
}));

// A known Monday 09:02 America/Chicago instant (2026-08-03 is a Monday).
const MONDAY_9AM_CENTRAL = new Date("2026-08-03T14:02:00.000Z");
const MONDAY_10AM_CENTRAL = new Date("2026-08-03T15:00:00.000Z");
const TUESDAY_9AM_CENTRAL = new Date("2026-08-04T14:02:00.000Z");

const mockDb = { topByRole: vi.fn().mockResolvedValue([]) };

const makeChannel = (name = "leaderboard-channel") => ({
  name,
  send: vi.fn().mockResolvedValue(undefined),
});

const makeGuild = ({ id = "guild-1", channel = makeChannel() } = {}) => ({
  id,
  roles: {
    cache: {
      find: vi.fn().mockReturnValue({ id: "role-id", name: "Good Person" }),
    },
  },
  channels: {
    cache: { find: vi.fn().mockReturnValue(channel) },
  },
});

const makeClient = (guilds) => ({
  guilds: { cache: new Map(guilds.map((g) => [g.id, g])) },
});

let run;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  mockConfig = {
    workers: {
      leaderboardChannel: "leaderboard-channel",
      reactionRoles: [{ roleName: "Good Person" }],
      combinedReactionRoles: [],
    },
  };
  mockDb.topByRole.mockReset().mockResolvedValue([]);
  ({ run } = await import("../../src/workers/weekly-leaderboard.js"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("weekly-leaderboard worker", () => {
  it("does nothing when leaderboardChannel is not configured", async () => {
    mockConfig.workers.leaderboardChannel = undefined;
    vi.setSystemTime(MONDAY_9AM_CENTRAL);

    const channel = makeChannel();
    const client = makeClient([makeGuild({ channel })]);
    await run(client, mockDb);

    expect(channel.send).not.toHaveBeenCalled();
  });

  it("does nothing outside Monday 9am Central", async () => {
    vi.setSystemTime(TUESDAY_9AM_CENTRAL);

    const channel = makeChannel();
    const client = makeClient([makeGuild({ channel })]);
    await run(client, mockDb);

    expect(channel.send).not.toHaveBeenCalled();
  });

  it("does nothing outside the 9:00-9:05 window on Monday", async () => {
    vi.setSystemTime(MONDAY_10AM_CENTRAL);

    const channel = makeChannel();
    const client = makeClient([makeGuild({ channel })]);
    await run(client, mockDb);

    expect(channel.send).not.toHaveBeenCalled();
  });

  it("posts the leaderboard to the configured channel during the Monday 9am window", async () => {
    vi.setSystemTime(MONDAY_9AM_CENTRAL);

    const channel = makeChannel();
    const client = makeClient([makeGuild({ channel })]);
    await run(client, mockDb);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("skips guilds that don't have the configured channel", async () => {
    vi.setSystemTime(MONDAY_9AM_CENTRAL);

    const guildWithout = makeGuild({ id: "guild-2" });
    guildWithout.channels.cache.find = vi.fn().mockReturnValue(undefined);

    const client = makeClient([guildWithout]);
    await expect(run(client, mockDb)).resolves.toBeUndefined();
  });

  it("does not double-post within the same Monday window", async () => {
    vi.setSystemTime(MONDAY_9AM_CENTRAL);
    const channel = makeChannel();
    const client = makeClient([makeGuild({ channel })]);

    await run(client, mockDb);
    vi.setSystemTime(new Date(MONDAY_9AM_CENTRAL.getTime() + 60 * 1000));
    await run(client, mockDb);

    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it("posts again the following Monday", async () => {
    vi.setSystemTime(MONDAY_9AM_CENTRAL);
    const channel = makeChannel();
    const client = makeClient([makeGuild({ channel })]);

    await run(client, mockDb);

    const nextMonday = new Date(
      MONDAY_9AM_CENTRAL.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    vi.setSystemTime(nextMonday);
    await run(client, mockDb);

    expect(channel.send).toHaveBeenCalledTimes(2);
  });
});
