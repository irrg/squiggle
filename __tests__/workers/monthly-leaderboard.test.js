import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/sendDebugMessage.js", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("discord.js", () => ({
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

// Known 09:02 America/Chicago instants. September/October are CDT (UTC-5),
// January is CST (UTC-6) — the offsets differ on purpose, so a month
// boundary built by subtracting a fixed offset would fail these.
const SEP_1_9AM_CENTRAL = new Date("2026-09-01T14:02:00.000Z");
const SEP_1_10AM_CENTRAL = new Date("2026-09-01T15:00:00.000Z");
const SEP_2_9AM_CENTRAL = new Date("2026-09-02T14:02:00.000Z");
const OCT_1_9AM_CENTRAL = new Date("2026-10-01T14:02:00.000Z");
const JAN_1_9AM_CENTRAL = new Date("2027-01-01T15:02:00.000Z");

const mockDb = {
  topByRole: vi.fn().mockResolvedValue({ byAttainment: [], byVotes: [] }),
};

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
let reportingWindows;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  mockConfig = {
    workers: {
      reactionRoles: [{ roleName: "Good Person" }],
      combinedReactionRoles: [],
    },
  };
  mockDb.topByRole
    .mockReset()
    .mockResolvedValue({ byAttainment: [], byVotes: [] });
  ({ run, reportingWindows } =
    await import("../../src/workers/monthly-leaderboard.js"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("monthly-leaderboard worker", () => {
  it("does nothing on a day that isn't the 1st", async () => {
    vi.setSystemTime(SEP_2_9AM_CENTRAL);

    const systemChannel = makeChannel();
    const client = makeClient([makeGuild({ systemChannel })]);
    await run(client, mockDb);

    expect(systemChannel.send).not.toHaveBeenCalled();
  });

  it("does nothing outside the 9:00-9:05 window on the 1st", async () => {
    vi.setSystemTime(SEP_1_10AM_CENTRAL);

    const systemChannel = makeChannel();
    const client = makeClient([makeGuild({ systemChannel })]);
    await run(client, mockDb);

    expect(systemChannel.send).not.toHaveBeenCalled();
  });

  it("posts to the guild's system channel by default", async () => {
    vi.setSystemTime(SEP_1_9AM_CENTRAL);

    const systemChannel = makeChannel("totally-renamed-channel");
    const client = makeClient([makeGuild({ systemChannel })]);
    await run(client, mockDb);

    expect(systemChannel.send).toHaveBeenCalledTimes(1);
    expect(systemChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("falls back to a channel literally named 'general' when there's no system channel", async () => {
    vi.setSystemTime(SEP_1_9AM_CENTRAL);

    const general = makeChannel("general");
    const client = makeClient([
      makeGuild({ systemChannel: null, namedChannels: [general] }),
    ]);
    await run(client, mockDb);

    expect(general.send).toHaveBeenCalledTimes(1);
  });

  it("skips a guild with no system channel and no 'general' channel", async () => {
    vi.setSystemTime(SEP_1_9AM_CENTRAL);

    const client = makeClient([
      makeGuild({ systemChannel: null, namedChannels: [] }),
    ]);
    await expect(run(client, mockDb)).resolves.toBeUndefined();
  });

  it("uses workers.leaderboardChannel as an override when configured", async () => {
    mockConfig.workers.leaderboardChannel = "announcements";
    vi.setSystemTime(SEP_1_9AM_CENTRAL);

    const systemChannel = makeChannel("general");
    const announcements = makeChannel("announcements");
    const client = makeClient([
      makeGuild({ systemChannel, namedChannels: [announcements] }),
    ]);
    await run(client, mockDb);

    expect(announcements.send).toHaveBeenCalledTimes(1);
    expect(systemChannel.send).not.toHaveBeenCalled();
  });

  it("does not double-post within the same window", async () => {
    vi.setSystemTime(SEP_1_9AM_CENTRAL);
    const systemChannel = makeChannel();
    const client = makeClient([makeGuild({ systemChannel })]);

    await run(client, mockDb);
    vi.setSystemTime(new Date(SEP_1_9AM_CENTRAL.getTime() + 60 * 1000));
    await run(client, mockDb);

    expect(systemChannel.send).toHaveBeenCalledTimes(1);
  });

  it("posts again the following month", async () => {
    vi.setSystemTime(SEP_1_9AM_CENTRAL);
    const systemChannel = makeChannel();
    const client = makeClient([makeGuild({ systemChannel })]);

    await run(client, mockDb);
    vi.setSystemTime(OCT_1_9AM_CENTRAL);
    await run(client, mockDb);

    expect(systemChannel.send).toHaveBeenCalledTimes(2);
  });

  it("queries the month just ended and year-to-date, not all time", async () => {
    vi.setSystemTime(SEP_1_9AM_CENTRAL);
    const systemChannel = makeChannel();
    const client = makeClient([makeGuild({ systemChannel })]);

    await run(client, mockDb);

    const windows = mockDb.topByRole.mock.calls.map((call) => call[3]);
    expect(windows).toEqual([
      {
        label: "August 2026",
        since: new Date("2026-08-01T05:00:00.000Z"),
        until: new Date("2026-09-01T05:00:00.000Z"),
      },
      {
        label: "Year to Date",
        since: new Date("2026-01-01T06:00:00.000Z"),
        until: new Date("2026-09-01T05:00:00.000Z"),
      },
    ]);
  });
});

describe("reportingWindows", () => {
  it("reports the previous month, anchoring year-to-date to that month's year", () => {
    const { title, isYearEnd, windows } = reportingWindows(SEP_1_9AM_CENTRAL);

    expect(title).toBe("Monthly Absolute Best");
    expect(isYearEnd).toBe(false);
    expect(windows[0].label).toBe("August 2026");
    expect(windows[1].label).toBe("Year to Date");
    expect(windows[1].since).toEqual(new Date("2026-01-01T06:00:00.000Z"));
  });

  // The whole reason the monthly cadence replaced the Monday one: the
  // January post's year window is the completed prior year, so the
  // year-end callout needs a label and nothing else. Anchoring to `now`
  // instead would report the nine hours of the new year elapsed by 9am.
  it("covers the full prior year on January 1st rather than the new one", () => {
    const { title, isYearEnd, windows } = reportingWindows(JAN_1_9AM_CENTRAL);

    expect(title).toBe("Absolute Best — 2026 in Review");
    expect(isYearEnd).toBe(true);

    expect(windows[0]).toEqual({
      label: "December 2026",
      since: new Date("2026-12-01T06:00:00.000Z"),
      until: new Date("2027-01-01T06:00:00.000Z"),
    });
    expect(windows[1]).toEqual({
      label: "Best of 2026",
      since: new Date("2026-01-01T06:00:00.000Z"),
      until: new Date("2027-01-01T06:00:00.000Z"),
    });
  });
});
