import config from "../../config/config.json" assert { type: "json" };

/**
 * Determines if the bot can post in a given channel based on whitelist/blacklist configuration.
 * @param {string} channelName - The name of the channel.
 * @returns {boolean} - True if the bot can post in the channel, false otherwise.
 */
const canPostInChannel = (channelName) => {
  if (config.bot.whitelist && config.bot.whitelist.length > 0) {
    return config.bot.whitelist.includes(channelName);
  }
  if (config.bot.blacklist && config.bot.blacklist.length > 0) {
    return !config.bot.blacklist.includes(channelName);
  }
  return true; // If neither whitelist nor blacklist is present, allow posting
};

export default canPostInChannel;