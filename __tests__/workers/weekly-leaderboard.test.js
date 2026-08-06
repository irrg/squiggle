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

const makeChannel = (name = "general") => ({
  name,
  send: vi.fn().mockResolvedValue(undefined),
});

const makeGuild = ({
  id = "guild-1",
  systemChannel = null,
  namedChannels = [],
} = {}) => ({
  id,
  systemChannel,
  roles: {
    cache: {
      find: vi.fn().mockReturnValue({ id: "role-id", name: "Good Person" }),
    },
  },
  channels: {
    cache: {
      find: vi.fn((fn) => namedChannels.find(fn)),
    },
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
  it("does nothing outside Monday 9am Central", async () => {
    vi.setSystemTime(TUESDAY_9AM_CENTRAL);

    const systemChannel = makeChannel();
    const client = makeClient([makeGuild({ systemChannel })]);
    await run(client, mockDb);

    expect(systemChannel.send).not.toHaveBeenCalled();
  });

  it("does nothing outside the 9:00-9:05 window on Monday", async () => {
    vi.setSystemTime(MONDAY_10AM_CENTRAL);

    const systemChannel = makeChannel();
    const client = makeClient([makeGuild({ systemChannel })]);
    await run(client, mockDb);

    expect(systemChannel.send).not.toHaveBeenCalled();
  });

  it("posts to the guild's system channel by default", async () => {
    vi.setSystemTime(MONDAY_9AM_CENTRAL);

    const systemChannel = makeChannel("totally-renamed-channel");
    const client = makeClient([makeGuild({ systemChannel })]);
    await run(client, mockDb);

    expect(systemChannel.send).toHaveBeenCalledTimes(1);
    expect(systemChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("falls back to a channel literally named 'general' when there's no system channel", async () => {
    vi.setSystemTime(MONDAY_9AM_CENTRAL);

    const general = makeChannel("general");
    const client = makeClient([
      makeGuild({ systemChannel: null, namedChannels: [general] }),
    ]);
    await run(client, mockDb);

    expect(general.send).toHaveBeenCalledTimes(1);
  });

  it("skips a guild with no system channel and no 'general' channel", async () => {
    vi.setSystemTime(MONDAY_9AM_CENTRAL);

    const client = makeClient([
      makeGuild({ systemChannel: null, namedChannels: [] }),
    ]);
    await expect(run(client, mockDb)).resolves.toBeUndefined();
  });

  it("uses workers.leaderboardChannel as an override when configured", async () => {
    mockConfig.workers.leaderboardChannel = "announcements";
    vi.setSystemTime(MONDAY_9AM_CENTRAL);

    const systemChannel = makeChannel("general");
    const announcements = makeChannel("announcements");
    const client = makeClient([
      makeGuild({ systemChannel, namedChannels: [announcements] }),
    ]);
    await run(client, mockDb);

    expect(announcements.send).toHaveBeenCalledTimes(1);
    expect(systemChannel.send).not.toHaveBeenCalled();
  });

  it("does not double-post within the same Monday window", async () => {
    vi.setSystemTime(MONDAY_9AM_CENTRAL);
    const systemChannel = makeChannel();
    const client = makeClient([makeGuild({ systemChannel })]);

    await run(client, mockDb);
    vi.setSystemTime(new Date(MONDAY_9AM_CENTRAL.getTime() + 60 * 1000));
    await run(client, mockDb);

    expect(systemChannel.send).toHaveBeenCalledTimes(1);
  });

  it("posts again the following Monday", async () => {
    vi.setSystemTime(MONDAY_9AM_CENTRAL);
    const systemChannel = makeChannel();
    const client = makeClient([makeGuild({ systemChannel })]);

    await run(client, mockDb);

    const nextMonday = new Date(
      MONDAY_9AM_CENTRAL.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    vi.setSystemTime(nextMonday);
    await run(client, mockDb);

    expect(systemChannel.send).toHaveBeenCalledTimes(2);
  });
});
