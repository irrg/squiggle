import pc from "picocolors";
import config from "../../config/config.json" with { type: "json" };

const DEFAULT_DEBUG_CHANNEL = "🤖bot-messages";

/**
 * Sends a debug message to the configured debug channel and logs it to the console.
 * @param {Client} client - The Discord client.
 * @param {string|string[]} messages - The debug message(s) to send.
 * @param {Object} options - Additional options for formatting.
 * @param {string} options.emoji - The emoji to prepend to the message.
 * @param {string} options.color - The color to apply to the console message.
 * @param {boolean} options.bold - Whether to make the message bold.
 * @param {boolean} options.suboption - Whether the message is a sub-item.
 */
const sendDebugMessage = async (client, messages, options = {}) => {
  const emoji = options.emoji || "⚠️";
  const messageArray = Array.isArray(messages) ? messages : [messages];

  // Sub-items render as list entries; everything else gets an emoji prefix
  const formatted = messageArray
    .map((msg) => (options.suboption ? `- ${msg}` : `${emoji} ${msg}`))
    .join("\n");

  let plainMessage = formatted;
  // Strip backticks for console output
  let debugMessage = formatted.replace(/`/g, "");

  // Apply color and bold formatting for console output
  if (options.color && typeof pc[options.color] === "function") {
    debugMessage = pc[options.color](debugMessage);
  }
  if (options.bold) {
    debugMessage = pc.bold(debugMessage);
    plainMessage = `**${plainMessage}**`; // Bold the Discord message
  }

  console.log(debugMessage);

  // Send formatted message to Discord
  const debugChannelName = config.bot.debugChannel || DEFAULT_DEBUG_CHANNEL;
  const debugChannel = client.channels.cache.find(
    (ch) => ch.name === debugChannelName,
  );
  if (debugChannel) {
    await debugChannel.send(plainMessage);
  }
};

export default sendDebugMessage;
