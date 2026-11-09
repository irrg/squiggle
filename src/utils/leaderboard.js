const roleNotFoundValue =
  "⚠️ role not found in this server — check config for typos/whitespace";

const noDataValue = "No data yet";

// A single all-time window, matching what /squiggle leaderboard asks for
// when it passes no windows at all. An unlabeled window renders bare (no
// heading above its ranking), which is what keeps the one-window output
// byte-identical to the pre-windowing layout.
const ALL_TIME = [{ label: null }];

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

// A TempRole row's memberName is a snapshot from whenever that row was
// created — extending a role never updates it, so it goes stale the
// moment someone changes their nickname without earning/extending that
// role again. Resolving live from the guild keeps the leaderboard
// current; the stored name is only a fallback for a member who's since
// left the server (fetch fails) and can no longer be looked up at all.
async function resolveMemberName(guild, memberId, fallbackName) {
  const member =
    guild.members.cache.get(memberId) ??
    (await guild.members.fetch(memberId).catch(() => null));
  return member ? member.nickname || member.user.username : fallbackName;
}

// Stacks each window's ranking into one field value under its own bold
// heading, rather than giving each window its own field or its own embed.
// Both of those blow past limits or reopen old bugs: a role costs 4 fields
// (spacer + header + two inline rankings), so at 5 configured roles a
// second window would need 40 of Discord's 25 available fields, and
// splitting the windows across two embeds reintroduces exactly the
// mismatched-card-width problem that collapsing to one shared embed fixed
// — a quiet month renders mostly placeholders, so the sparse card next to
// the dense year-to-date one is the worst case, not the rare one. Nesting
// keeps the field count flat at 4 per role no matter how many windows.
const stackWindows = (perWindow) => {
  if (perWindow.length === 1 && perWindow[0].label === null) {
    return perWindow[0].value;
  }
  return perWindow
    .map(({ label, value }) => `**${label}**\n${value}`)
    .join("\n\n");
};

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
// the role has no data yet or can't be resolved in this guild.
//
// `windows` is a list of {label, since, until} date ranges, each ranked
// independently and stacked inside those same two fields — the monthly
// worker passes the month just ended plus year-to-date, while
// /squiggle leaderboard passes none and gets a single all-time ranking.
// Shared by both so they can't drift out of sync.
export async function buildLeaderboardFields(
  config,
  guild,
  db,
  windows = ALL_TIME,
) {
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

    // Zero-width space: Discord rejects an empty field value, and the
    // header field below needs one just to force the line break before
    // its content. That forced-blank value sits *after* the title with
    // nothing matching it *before* — this spacer mirrors it so the gap on
    // both sides of a title is the same size, instead of the title
    // reading like it belongs to the block above it.
    fields.push({ name: "​", value: "​" });

    const role = guild.roles.cache.find((r) => r.name === roleName);
    if (!role) {
      fields.push({ name: header, value: roleNotFoundValue });
      continue;
    }

    const ranked = [];
    for (const window of windows) {
      const { byAttainment, byVotes } = await db.topByRole(
        guild.id,
        role.id,
        3,
        window,
      );
      ranked.push({ label: window.label ?? null, byAttainment, byVotes });
    }

    // Only a role with nothing in *any* window collapses to the
    // placeholder — a role that was quiet this month but busy over the
    // year still has a year-to-date ranking worth showing.
    if (ranked.every((r) => r.byVotes.length === 0)) {
      fields.push({ name: header, value: noDataValue });
      continue;
    }

    // Resolved once per unique member across every window (not per list)
    // since the top scorer typically appears in both rankings, and the
    // year's leaders are usually a superset of the month's.
    const uniqueMembers = new Map();
    for (const { byVotes, byAttainment } of ranked) {
      for (const t of [...byVotes, ...byAttainment]) {
        if (!uniqueMembers.has(t.memberId)) {
          uniqueMembers.set(t.memberId, t.memberName);
        }
      }
    }
    const resolvedNames = new Map(
      await Promise.all(
        [...uniqueMembers].map(async ([memberId, fallbackName]) => [
          memberId,
          displayName(await resolveMemberName(guild, memberId, fallbackName)),
        ]),
      ),
    );

    const rankOrPlaceholder = (entries, formatLine) =>
      entries.length === 0 ? noDataValue : rankList(entries, formatLine);

    const popularity = stackWindows(
      ranked.map(({ label, byVotes }) => ({
        label,
        value: rankOrPlaceholder(
          byVotes,
          (t) =>
            `**${resolvedNames.get(t.memberId)}** — ${t.totalReactions} votes`,
        ),
      })),
    );
    const attainment = stackWindows(
      ranked.map(({ label, byAttainment }) => ({
        label,
        value: rankOrPlaceholder(
          byAttainment,
          (t) =>
            `**${resolvedNames.get(t.memberId)}** — ${t.postCount} time${t.postCount === 1 ? "" : "s"}`,
        ),
      })),
    );

    fields.push(
      { name: header, value: "​" },
      { name: "🔥 Most Popular", value: popularity, inline: true },
      { name: "🎖️ Most Attained", value: attainment, inline: true },
    );
  }

  return fields;
}
