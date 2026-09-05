const roleNotFoundValue =
  "⚠️ role not found in this server — check config for typos/whitespace";

const rankList = (entries, formatLine) =>
  entries.map((entry, i) => `${i + 1}. ${formatLine(entry)}`).join("\n");

// A configured role's own emoji doubles as its leaderboard icon: a literal
// unicode emoji (single reactionRoles) is used as-is, while a custom guild
// emoji's name (combinedReactionRoles, or any config using server emoji)
// is resolved through the guild so it renders as the actual image instead
// of raw text.
const isCustomEmojiName = (name) => /^\w+$/.test(name);

// Discord sizes an embed card to its widest line of content, so a role
// with short names/counts renders a visibly narrower card than one with
// long ones. U+2800 (Braille Pattern Blank) is invisible like a space but
// — unlike a real space — has real glyph width, so padding every title
// with a run of them nudges every card up to Discord's max render width
// regardless of how little data it actually holds, making them all the
// same size. The count below is a guess, not a measured pixel target;
// if cards still don't match in the real client, adjust it up or down.
const WIDTH_PAD = "⠀".repeat(40);

function resolveIcon(emojiName, guild) {
  if (!emojiName) return null;
  if (!isCustomEmojiName(emojiName)) return emojiName;
  const emoji = guild.emojis.cache.find((e) => e.name === emojiName);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : null;
}

// Builds one embed spec per configured reaction role — title is the
// role's own icon (from its configured emoji) plus its name, and its two
// inline fields are separate rankings: "Most Popular" (total votes behind
// a member's earns for that role, most-reacted posts weighted heaviest)
// and "Most Attained" (times they've earned/extended it). The two can
// crown different people, since one big viral post can outscore many
// steady small ones. Top 3 members per ranking, or a bare description if
// the role has no data yet or can't be resolved in this guild. Shared by
// /squiggle leaderboard and the weekly leaderboard worker so they can't
// drift out of sync.
export async function buildLeaderboardEmbeds(config, guild, db) {
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

  const embeds = [];

  for (const [roleName, entry] of roleEntries) {
    const icon = resolveIcon(entry.emojiName ?? entry.emojiNames?.[0], guild);
    const title = `${icon ? `${icon} ${roleName}` : roleName}${WIDTH_PAD}`;

    const role = guild.roles.cache.find((r) => r.name === roleName);
    if (!role) {
      embeds.push({ title, description: roleNotFoundValue });
      continue;
    }

    const { byAttainment, byVotes } = await db.topByRole(guild.id, role.id, 3);

    if (byVotes.length === 0) {
      embeds.push({ title, description: "No data yet" });
      continue;
    }

    const popularity = rankList(
      byVotes,
      (t) => `**${t.memberName}** — ${t.totalReactions} votes`,
    );
    const attainment = rankList(
      byAttainment,
      (t) =>
        `**${t.memberName}** — ${t.postCount} time${t.postCount === 1 ? "" : "s"}`,
    );

    embeds.push({
      title,
      fields: [
        { name: "🔥 Most Popular", value: popularity, inline: true },
        { name: "🎖️ Most Attained", value: attainment, inline: true },
      ],
    });
  }

  return embeds;
}
