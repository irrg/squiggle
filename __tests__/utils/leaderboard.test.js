import { describe, it, expect, vi } from "vitest";
import { buildLeaderboardFields } from "../../src/utils/leaderboard.js";

const config = {
  workers: {
    reactionRoles: [{ roleName: "Cool Person" }],
    combinedReactionRoles: [],
  },
};

const makeGuild = () => ({
  id: "guild-1",
  roles: { cache: { find: vi.fn(() => ({ id: "role-1" })) } },
  emojis: { cache: { find: vi.fn(() => undefined) } },
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
});
