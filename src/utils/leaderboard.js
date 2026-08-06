// Builds the embed fields for the reaction-role leaderboard: top 3 members
// per configured role, or a placeholder if the role has no data yet or
// can't be resolved in this guild. Shared by /squiggle leaderboard and the
// weekly leaderboard worker so they can't drift out of sync.
export async function buildLeaderboardFields(config, guild, db) {
  const configuredRoles = [
    ...(config.workers.reactionRoles ?? []),
    ...(config.workers.combinedReactionRoles ?? []),
  ];
  const roleNames = [...new Set(configuredRoles.map((r) => r.roleName))];

  const fields = [];
  for (const roleName of roleNames) {
    const role = guild.roles.cache.find((r) => r.name === roleName);
    if (!role) {
      fields.push({
        name: roleName,
        value:
          "⚠️ role not found in this server — check config for typos/whitespace",
      });
      continue;
    }

    const top = await db.topByRole(guild.id, role.id, 3);
    const value = top.length
      ? top
          .map((t, i) => `${i + 1}. **${t.memberName}** — ${t.count}`)
          .join("\n")
      : "No data yet";
    fields.push({ name: roleName, value });
  }

  return fields;
}
