import { EmbedBuilder } from "discord.js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import sendDebugMessage from "../utils/sendDebugMessage.js";
import formatError from "../utils/formatError.js";
import { buildLeaderboardFields } from "../utils/leaderboard.js";
import { CENTRAL_TIMEZONE } from "../constants.js";
import config from "../../config/config.json" with { type: "json" };

// Checked every minute; only actually posts once, in the first minute of
// the 9am-first-of-the-month-Central window, tracked in memory so a
// restart mid-window can't be the only thing standing between "posted"
// and "never posted".
let lastPostedDateKey = null;

// systemChannelId is set once at server creation and stays pinned to that
// channel's ID even if it's renamed — the closest thing Discord has to a
// stable "the general channel" reference. Literal name match as a fallback
// for servers where the system channel was cleared.
function resolveLeaderboardChannel(guild, channelName) {
  if (channelName) {
    return guild.channels.cache.find((ch) => ch.name === channelName);
  }
  return (
    guild.systemChannel ??
    guild.channels.cache.find((ch) => ch.name === "general")
  );
}

// Midnight on the 1st of the given Central month, as the UTC instant that
// corresponds to — which is what createdAt is compared against. Built from
// the wall-clock string rather than by subtracting a fixed offset so the
// two DST transitions a year don't shift a month boundary by an hour.
const centralMonthStart = (year, month) =>
  fromZonedTime(
    `${year}-${String(month).padStart(2, "0")}-01T00:00:00`,
    CENTRAL_TIMEZONE,
  );

// Posting on the 1st means reporting the month that just ended, so every
// window is anchored to *that* month rather than to now. It matters most
// on January 1st: "year to date" there has to mean the year that just
// finished, not the nine hours of the new one that have elapsed by 9am.
// That's also what makes the year-end callout fall out for free — the
// January post's second window is already the complete prior year, so it
// only needs a different label.
function reportingWindows(now) {
  const nowYear = Number(formatInTimeZone(now, CENTRAL_TIMEZONE, "yyyy"));
  const nowMonth = Number(formatInTimeZone(now, CENTRAL_TIMEZONE, "MM"));

  const isJanuary = nowMonth === 1;
  const year = isJanuary ? nowYear - 1 : nowYear;
  const month = isJanuary ? 12 : nowMonth - 1;

  const periodStart = centralMonthStart(year, month);
  const periodEnd = centralMonthStart(nowYear, nowMonth);
  const yearStart = centralMonthStart(year, 1);

  const monthLabel = formatInTimeZone(periodStart, CENTRAL_TIMEZONE, "MMMM");

  return {
    isYearEnd: isJanuary,
    title: isJanuary
      ? `Absolute Best — ${year} in Review`
      : "Monthly Absolute Best",
    windows: [
      { label: `${monthLabel} ${year}`, since: periodStart, until: periodEnd },
      {
        label: isJanuary ? `Best of ${year}` : "Year to Date",
        since: yearStart,
        until: periodEnd,
      },
    ],
  };
}

const run = async (client, db) => {
  try {
    const channelName = config.workers.leaderboardChannel;

    const now = new Date();
    const dayOfMonth = formatInTimeZone(now, CENTRAL_TIMEZONE, "dd");
    const time = formatInTimeZone(now, CENTRAL_TIMEZONE, "HH:mm");
    const dateKey = formatInTimeZone(now, CENTRAL_TIMEZONE, "yyyy-MM-dd");

    if (dayOfMonth !== "01") return;
    if (time < "09:00" || time >= "09:05") return;
    if (lastPostedDateKey === dateKey) return;
    lastPostedDateKey = dateKey;

    const { title, windows } = reportingWindows(now);

    for (const guild of client.guilds.cache.values()) {
      const channel = resolveLeaderboardChannel(guild, channelName);
      if (!channel) continue;

      const fields = await buildLeaderboardFields(config, guild, db, windows);
      if (fields.length === 0) continue;

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor("#5865F2")
        .addFields(fields);
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    await sendDebugMessage(
      client,
      `Monthly leaderboard worker error: ${formatError(error)}`,
    );
  }
};

const interval = 60 * 1000;

export { run, interval, reportingWindows };
