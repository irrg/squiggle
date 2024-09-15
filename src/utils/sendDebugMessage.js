/**
 * Sends a debug message to the #🤖bot-messages channel and logs it to the console.
 * @param {Client} client - The Discord client.
 * @param {string|string[]} messages - The debug message(s) to send.
 * @param {Object} options - Additional options for formatting.
 * @param {string} options.emoji - The emoji to prepend to the message.
 * @param {string} options.color - The color to apply to the console message.
 * @param {boolean} options.bold - Whether to make the console message bold.
 */
const sendDebugMessage = async (client, messages, options = {}) => {
  const emoji = options.emoji || "⚠️";
  const messageArray = Array.isArray(messages) ? messages : [messages];
  const plainMessage = messageArray.join("\n");
  let debugMessage = `${emoji} ${plainMessage}`;

  // Apply color and bold formatting for console output
  if (options.color) {
    debugMessage = debugMessage[options.color];
  }
  if (options.bold) {
    debugMessage = debugMessage.bold;
  }

  console.log(debugMessage);

  // Send plain message to Discord
  const discordMessage = `${emoji} ${plainMessage}`;
  const debugChannel = client.channels.cache.find(
    (ch) => ch.name === "🤖bot-messages"
  );
  if (debugChannel) {
    await debugChannel.send(discordMessage);
  }
};

export default sendDebugMessage;
