import { EmbedBuilder } from "discord.js";
import { formatInTimeZone } from "date-fns-tz";
import sendDebugMessage from "../utils/sendDebugMessage.js";
import formatError from "../utils/formatError.js";
import { buildLeaderboardFields } from "../utils/leaderboard.js";
import { CENTRAL_TIMEZONE } from "../constants.js";
import config from "../../config/config.json" with { type: "json" };

// Checked every minute; only actually posts once, in the first minute of
// the 9am-Monday-Central window, tracked in memory so a restart mid-window
// can't be the only thing standing between "posted" and "never posted".
let lastPostedDateKey = null;

const run = async (client, db) => {
  try {
    const channelName = config.workers.leaderboardChannel;
    if (!channelName) return;

    const now = new Date();
    const weekday = formatInTimeZone(now, CENTRAL_TIMEZONE, "iiii");
    const time = formatInTimeZone(now, CENTRAL_TIMEZONE, "HH:mm");
    const dateKey = formatInTimeZone(now, CENTRAL_TIMEZONE, "yyyy-MM-dd");

    if (weekday !== "Monday") return;
    if (time < "09:00" || time >= "09:05") return;
    if (lastPostedDateKey === dateKey) return;
    lastPostedDateKey = dateKey;

    for (const guild of client.guilds.cache.values()) {
      const channel = guild.channels.cache.find(
        (ch) => ch.name === channelName,
      );
      if (!channel) continue;

      const fields = await buildLeaderboardFields(config, guild, db);
      if (fields.length === 0) continue;

      const embed = new EmbedBuilder()
        .setTitle("Weekly Reaction Role Leaderboard")
        .setColor("#5865F2")
        .addFields(fields);
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    await sendDebugMessage(
      client,
      `Weekly leaderboard worker error: ${formatError(error)}`,
    );
  }
};

const interval = 60 * 1000;

export { run, interval };
