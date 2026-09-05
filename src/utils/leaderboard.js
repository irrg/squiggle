const roleNotFoundValue =
  "⚠️ role not found in this server — check config for typos/whitespace";

const rankList = (entries, formatLine) =>
  entries.map((entry, i) => `${i + 1}. ${formatLine(entry)}`).join("\n");

// Some members put their real name/pronouns in a trailing parenthetical
// on their server nickname (e.g. "Veiled Fury (Manu, he/him)") — trimmed
// here for a cleaner, more consistent leaderboard. Only the display name
// is affected; the full nickname is still what's granted/credited
// everywhere else. Falls back to the untrimmed name if stripping it
// would leave nothing (e.g. a nickname that's only a parenthetical).
const displayName = (memberName) =>
  memberName.replace(/\s*\([^)]*\)\s*$/, "") || memberName;

// A configured role's own emoji doubles as its leaderboard icon: a literal
// unicode emoji (single reactionRoles) is used as-is, while a custom guild
// emoji's name (combinedReactionRoles, or any config using server emoji)
// is resolved through the guild so it renders as the actual image instead
// of raw text.
const isCustomEmojiName = (name) => /^\w+$/.test(name);

function resolveIcon(emojiName, guild) {
  if (!emojiName) return null;
  if (!isCustomEmojiName(emojiName)) return emojiName;
  const emoji = guild.emojis.cache.find((e) => e.name === emojiName);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : null;
}

// Builds the fields for one shared leaderboard embed. Discord sizes an
// embed to its widest line of content, so giving each role its own embed
// left short-data roles rendering as visibly narrower cards than
// data-heavy ones with no reliable way to force them to match. Keeping
// every role in a single embed sidesteps that: there's only one card, so
// there's nothing to mismatch. Each role contributes a non-inline header
// field (its own icon + name, forcing a line break) followed by two real
// inline fields — "Most Popular" (total votes behind a member's earns for
// that role, most-reacted posts weighted heaviest) and "Most Attained"
// (times they've earned/extended it). The two can crown different
// people, since one big viral post can outscore many steady small ones.
// Top 3 members per ranking, or a placeholder value under the header if
// the role has no data yet or can't be resolved in this guild. Shared by
// /squiggle leaderboard and the weekly leaderboard worker so they can't
// drift out of sync.
export async function buildLeaderboardFields(config, guild, db) {
  const configuredRoles = [
    ...(config.workers.reactionRoles ?? []),
    ...(config.workers.combinedReactionRoles ?? []),
  ];
  const roleEntries = new Map();
  for (const entry of configuredRoles) {
    if (!roleEntries.has(entry.roleName)) {
      roleEntries.set(entry.roleName, entry);
    }
  }

  const fields = [];

  for (const [roleName, entry] of roleEntries) {
    const icon = resolveIcon(entry.emojiName ?? entry.emojiNames?.[0], guild);
    const header = icon ? `${icon} ${roleName}` : roleName;

    const role = guild.roles.cache.find((r) => r.name === roleName);
    if (!role) {
      fields.push({ name: header, value: roleNotFoundValue });
      continue;
    }

    const { byAttainment, byVotes } = await db.topByRole(guild.id, role.id, 3);

    if (byVotes.length === 0) {
      fields.push({ name: header, value: "No data yet" });
      continue;
    }

    const popularity = rankList(
      byVotes,
      (t) => `**${displayName(t.memberName)}** — ${t.totalReactions} votes`,
    );
    const attainment = rankList(
      byAttainment,
      (t) =>
        `**${displayName(t.memberName)}** — ${t.postCount} time${t.postCount === 1 ? "" : "s"}`,
    );

    // Zero-width space: Discord rejects an empty field value, and this
    // header field only exists to force the line break before the two
    // inline fields below it.
    fields.push(
      { name: header, value: "​" },
      { name: "🔥 Most Popular", value: popularity, inline: true },
      { name: "🎖️ Most Attained", value: attainment, inline: true },
    );
  }

  return fields;
}
