import { describe, it, expect, vi } from "vitest";
import { buildLeaderboardFields } from "../../src/utils/leaderboard.js";

const config = {
  workers: {
    reactionRoles: [{ roleName: "Cool Person" }],
    combinedReactionRoles: [],
  },
};

const makeGuild = ({ member } = {}) => ({
  id: "guild-1",
  roles: { cache: { find: vi.fn(() => ({ id: "role-1" })) } },
  emojis: { cache: { find: vi.fn(() => undefined) } },
  members: {
    // No member param: simulates someone who's since left the server —
    // cache miss, fetch fails, callers fall back to the stored name.
    cache: { get: vi.fn(() => member) },
    fetch: vi.fn().mockRejectedValue(new Error("not in guild")),
  },
});

const makeDb = (memberName) => ({
  topByRole: vi.fn().mockResolvedValue({
    byVotes: [{ memberId: "m1", memberName, totalReactions: 30 }],
    byAttainment: [{ memberId: "m1", memberName, postCount: 6 }],
  }),
});

describe("buildLeaderboardFields", () => {
  it("trims a trailing parenthetical off member names for display", async () => {
    const db = makeDb("Veiled Fury (Manu, he/him)");

    const fields = await buildLeaderboardFields(config, makeGuild(), db);

    expect(fields.find((f) => f.name === "🔥 Most Popular").value).toBe(
      "1. **Veiled Fury** — 30 votes",
    );
    expect(fields.find((f) => f.name === "🎖️ Most Attained").value).toBe(
      "1. **Veiled Fury** — 6 times",
    );
  });

  it("leaves a name with no trailing parenthetical untouched", async () => {
    const db = makeDb("K. M. Alexander");

    const fields = await buildLeaderboardFields(config, makeGuild(), db);

    expect(fields.find((f) => f.name === "🔥 Most Popular").value).toBe(
      "1. **K. M. Alexander** — 30 votes",
    );
  });

  it("falls back to the full name if trimming would leave nothing", async () => {
    const db = makeDb("(nickname only)");

    const fields = await buildLeaderboardFields(config, makeGuild(), db);

    expect(fields.find((f) => f.name === "🔥 Most Popular").value).toBe(
      "1. **(nickname only)** — 30 votes",
    );
  });

  it("puts a matching blank spacer field before every role's header", async () => {
    const db = makeDb("testuser");

    const fields = await buildLeaderboardFields(config, makeGuild(), db);

    expect(fields[0]).toEqual({ name: "​", value: "​" });
    expect(fields[1].name).toBe("Cool Person");
    expect(fields[1].value).toBe("​");
  });

  it("resolves the member's current nickname live instead of the stored snapshot", async () => {
    const db = makeDb("Old Stale Nickname");
    const guild = makeGuild({
      member: { nickname: "New Nickname", user: { username: "globalhandle" } },
    });

    const fields = await buildLeaderboardFields(config, guild, db);

    expect(fields.find((f) => f.name === "🔥 Most Popular").value).toBe(
      "1. **New Nickname** — 30 votes",
    );
  });

  it("falls back to the stored name when the member can no longer be looked up", async () => {
    const db = makeDb("Last Known Name");
    const guild = makeGuild(); // no member: cache miss + failed fetch

    const fields = await buildLeaderboardFields(config, guild, db);

    expect(fields.find((f) => f.name === "🔥 Most Popular").value).toBe(
      "1. **Last Known Name** — 30 votes",
    );
  });
});

describe("buildLeaderboardFields windows", () => {
  const MONTH = { label: "August 2026", since: 1, until: 2 };
  const YEAR = { label: "Year to Date", since: 0, until: 2 };

  // Keyed on the window's label so each range can return its own ranking.
  const makeWindowedDb = (byLabel) => ({
    topByRole: vi.fn(async (_guildId, _roleId, _limit, window) => {
      return byLabel[window.label] ?? { byVotes: [], byAttainment: [] };
    }),
  });

  it("stacks each window's ranking under its own heading in both fields", async () => {
    const db = makeWindowedDb({
      "August 2026": {
        byVotes: [{ memberId: "m1", memberName: "Ada", totalReactions: 9 }],
        byAttainment: [{ memberId: "m1", memberName: "Ada", postCount: 1 }],
      },
      "Year to Date": {
        byVotes: [{ memberId: "m2", memberName: "Grace", totalReactions: 80 }],
        byAttainment: [{ memberId: "m2", memberName: "Grace", postCount: 12 }],
      },
    });

    const fields = await buildLeaderboardFields(config, makeGuild(), db, [
      MONTH,
      YEAR,
    ]);

    expect(fields.find((f) => f.name === "🔥 Most Popular").value).toBe(
      "**August 2026**\n1. **Ada** — 9 votes\n\n" +
        "**Year to Date**\n1. **Grace** — 80 votes",
    );
    expect(fields.find((f) => f.name === "🎖️ Most Attained").value).toBe(
      "**August 2026**\n1. **Ada** — 1 time\n\n" +
        "**Year to Date**\n1. **Grace** — 12 times",
    );
  });

  it("keeps the field count at 4 per role no matter how many windows", async () => {
    const data = {
      byVotes: [{ memberId: "m1", memberName: "Ada", totalReactions: 9 }],
      byAttainment: [{ memberId: "m1", memberName: "Ada", postCount: 1 }],
    };
    const db = makeWindowedDb({ "August 2026": data, "Year to Date": data });

    const oneWindow = await buildLeaderboardFields(config, makeGuild(), db, [
      MONTH,
    ]);
    const twoWindows = await buildLeaderboardFields(config, makeGuild(), db, [
      MONTH,
      YEAR,
    ]);

    expect(oneWindow).toHaveLength(4);
    expect(twoWindows).toHaveLength(4);
  });

  it("placeholders only the empty window, not the whole role", async () => {
    const db = makeWindowedDb({
      "Year to Date": {
        byVotes: [{ memberId: "m2", memberName: "Grace", totalReactions: 80 }],
        byAttainment: [{ memberId: "m2", memberName: "Grace", postCount: 12 }],
      },
    });

    const fields = await buildLeaderboardFields(config, makeGuild(), db, [
      MONTH,
      YEAR,
    ]);

    expect(fields.find((f) => f.name === "🔥 Most Popular").value).toBe(
      "**August 2026**\nNo data yet\n\n" +
        "**Year to Date**\n1. **Grace** — 80 votes",
    );
  });

  it("collapses to one placeholder when every window is empty", async () => {
    const db = makeWindowedDb({});

    const fields = await buildLeaderboardFields(config, makeGuild(), db, [
      MONTH,
      YEAR,
    ]);

    expect(fields).toEqual([
      { name: "​", value: "​" },
      { name: "Cool Person", value: "No data yet" },
    ]);
  });

  it("resolves each member's name once across all windows", async () => {
    const shared = {
      byVotes: [{ memberId: "m1", memberName: "Ada", totalReactions: 9 }],
      byAttainment: [{ memberId: "m1", memberName: "Ada", postCount: 1 }],
    };
    const db = makeWindowedDb({
      "August 2026": shared,
      "Year to Date": shared,
    });
    const guild = makeGuild({
      member: { nickname: "Ada L.", user: { username: "ada" } },
    });

    await buildLeaderboardFields(config, guild, db, [MONTH, YEAR]);

    expect(guild.members.cache.get).toHaveBeenCalledTimes(1);
  });

  it("renders a single unlabeled window bare, with no heading", async () => {
    const db = makeDb("Ada");

    const fields = await buildLeaderboardFields(config, makeGuild(), db);

    expect(fields.find((f) => f.name === "🔥 Most Popular").value).toBe(
      "1. **Ada** — 30 votes",
    );
  });
});
