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
