/**
 * Sends a debug message to the #🤖bot-messages channel and logs it to the console.
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

  // Add spaces before sub-items and handle emojis
  const formattedMessages = messageArray.map((msg) => {
    if (options.suboption) {
      return `- ${msg}`;
    }
    return `${emoji} ${msg}`;
  });

  let plainMessage = formattedMessages.join("\n");
  let debugMessage = messageArray
    .map((msg) => {
      if (options.suboption) {
        return `- ${msg}`;
      }
      return `${emoji} ${msg}`;
    })
    .join("\n");

  // Strip backticks for console output
  debugMessage = debugMessage.replace(/`/g, "");

  // Apply color and bold formatting for console output
  if (options.color) {
    debugMessage = debugMessage[options.color];
  }
  if (options.bold) {
    debugMessage = debugMessage.bold;
    plainMessage = `**${plainMessage}**`; // Bold the Discord message
  }

  console.log(debugMessage);

  // Send formatted message to Discord
  const debugChannel = client.channels.cache.find(
    (ch) => ch.name === "🤖bot-messages"
  );
  if (debugChannel) {
    await debugChannel.send(plainMessage);
  }
};

export default sendDebugMessage;
