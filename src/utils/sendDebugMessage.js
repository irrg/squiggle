/**
 * Sends a debug message to the #🤖bot-messages channel.
 * @param {Client} client - The Discord client.
 * @param {string} message - The debug message to send.
 */
const sendDebugMessage = async (client, message) => {
  const debugChannel = client.channels.cache.find(
    (ch) => ch.name === "🤖bot-messages"
  );
  if (debugChannel) {
    await debugChannel.send(message);
  }
};

module.exports = sendDebugMessage;
