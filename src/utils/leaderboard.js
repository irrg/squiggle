const roleNotFoundValue =
  "⚠️ role not found in this server — check config for typos/whitespace";

// Builds the embed fields for the two reaction-role leaderboards: "most
// attained" (times a member has earned/extended the role) and "most
// popular" (total votes behind those earns, most-reacted posts weighted
// heaviest). Top 3 members per configured role, or a placeholder if the
// role has no data yet or can't be resolved in this guild. Shared by
// /squiggle leaderboard and the weekly leaderboard worker so they can't
// drift out of sync.
export async function buildLeaderboardFields(config, guild, db) {
  const configuredRoles = [
    ...(config.workers.reactionRoles ?? []),
    ...(config.workers.combinedReactionRoles ?? []),
  ];
  const roleNames = [...new Set(configuredRoles.map((r) => r.roleName))];

  const attainmentFields = [];
  const popularityFields = [];

  for (const roleName of roleNames) {
    const role = guild.roles.cache.find((r) => r.name === roleName);
    if (!role) {
      attainmentFields.push({ name: roleName, value: roleNotFoundValue });
      popularityFields.push({ name: roleName, value: roleNotFoundValue });
      continue;
    }

    const { byAttainment, byVotes } = await db.topByRole(guild.id, role.id, 3);

    attainmentFields.push({
      name: roleName,
      value: byAttainment.length
        ? byAttainment
            .map(
              (t, i) =>
                `${i + 1}. **${t.memberName}** — ${t.postCount} time${t.postCount === 1 ? "" : "s"}`,
            )
            .join("\n")
        : "No data yet",
    });

    popularityFields.push({
      name: roleName,
      value: byVotes.length
        ? byVotes
            .map(
              (t, i) =>
                `${i + 1}. **${t.memberName}** — ${t.totalReactions} votes`,
            )
            .join("\n")
        : "No data yet",
    });
  }

  return { attainmentFields, popularityFields };
}
