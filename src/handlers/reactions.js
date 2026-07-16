import { EmbedBuilder, MessageReferenceType } from "discord.js";
import canPostInChannel from "../utils/canPostInChannel.js";
import sendDebugMessage from "../utils/sendDebugMessage.js";
import formatError from "../utils/formatError.js";
import { TEMP_ROLE_DURATION_MS, TEMP_ROLE_EXTENSION_MS } from "../constants.js";

// Author is null for system/webhook messages; bot-authored messages map back
// to the member the bot posted for via the TempRole record.
async function resolveMessageAuthorId(message, TempRole) {
  const { author } = message;
  if (author && !author.bot) return author.id;
  const sourceRole = await TempRole.findByMessageId(message.id);
  return sourceRole ? sourceRole.memberId : null;
}

// Reaction counts for each emoji with the bot's own reaction excluded
function humanCounts(message, emojiNames) {
  return emojiNames.map((emojiName) => {
    const r = message.reactions.cache.find((rc) => rc.emoji.name === emojiName);
    return r ? r.count - (r.me ? 1 : 0) : 0;
  });
}

async function fetchPartialMessage(message, client) {
  if (!message.partial) return true;
  try {
    await message.fetch();
    return true;
  } catch (error) {
    await sendDebugMessage(client, `Error fetching message: ${error.message}`);
    return false;
  }
}

// Anyone can react 🚫 on a bot forward in a forward channel to remove it
// (e.g. the original author would rather post it themselves).
async function deleteForwardIfVetoed(reaction, message, { client, config }) {
  if (reaction.emoji.name !== "🚫") return false;
  if (message.author?.id !== client.user?.id) return false;
  if (message.reference?.type !== MessageReferenceType.Forward) return false;

  const forwardChannels = [
    ...config.workers.reactionRoles,
    ...(config.workers.combinedReactionRoles ?? []),
  ]
    .map((role) => role.forwardChannel)
    .filter(Boolean);
  if (!forwardChannels.includes(message.channel.name)) return false;

  try {
    await message.delete();
  } catch (error) {
    await sendDebugMessage(
      client,
      `Error deleting vetoed forward: ${formatError(error)}`,
    );
  }
  return true;
}

async function forwardIfConfigured({ client, guild, message, channelName }) {
  if (!channelName) return;
  const fwdChannel = guild.channels.cache.find((ch) => ch.name === channelName);
  if (fwdChannel) {
    await message.forward(fwdChannel);
  } else {
    await sendDebugMessage(client, `forwardChannel "${channelName}" not found`);
  }
}

// Extends an existing temp role when `count` sets a new high-water mark, or
// grants a fresh one (role + record + announcement embed + optional forward).
async function grantOrExtendTempRole({
  client,
  TempRole,
  guild,
  message,
  member,
  memberName,
  role,
  count,
  shouldGrant,
  extendMessage,
  embedTitle,
  color,
  forwardChannel,
}) {
  const existingTempRole = await TempRole.findByKey(
    guild.id,
    member.id,
    role.id,
    message.id,
  );

  if (existingTempRole) {
    if (count > existingTempRole.maxReactionCount) {
      const expirationTime = new Date(
        existingTempRole.expirationTime.getTime() + TEMP_ROLE_EXTENSION_MS,
      );
      await TempRole.extend(existingTempRole.id, expirationTime, count);
      await message.reply(extendMessage);
    }
    return;
  }

  if (!shouldGrant) return;

  const expirationTime = new Date(Date.now() + TEMP_ROLE_DURATION_MS);
  await member.roles.add(role);
  try {
    await TempRole.create({
      guildId: guild.id,
      memberId: member.id,
      memberName,
      roleId: role.id,
      roleName: role.name,
      messageId: message.id,
      expirationTime,
      maxReactionCount: count,
    });
  } catch (dbError) {
    if (dbError.name === "UniqueConstraintError") return;
    await member.roles.remove(role).catch(() => {});
    throw dbError;
  }

  const embed = new EmbedBuilder()
    .setTitle(embedTitle)
    .setColor(color)
    .setAuthor({ name: memberName, iconURL: member.displayAvatarURL() })
    .setTimestamp();

  await message.reply({ embeds: [embed] });

  await forwardIfConfigured({
    client,
    guild,
    message,
    channelName: forwardChannel,
  });
}

export async function handleReactionAdd(
  reaction,
  user,
  { client, TempRole, config },
) {
  if (user.id === client.user?.id) return;

  const { message } = reaction;

  if (!(await fetchPartialMessage(message, client))) return;

  if (await deleteForwardIfVetoed(reaction, message, { client, config }))
    return;

  const { channel, guild } = message;

  if (!canPostInChannel(channel.name)) return;

  const messageAuthorId = await resolveMessageAuthorId(message, TempRole);
  if (!messageAuthorId) return;

  if (user.id === messageAuthorId) return;

  await Promise.all(
    config.workers.reactionRoles.map(async (reactionRole) => {
      if (reaction.emoji.name !== reactionRole.emojiName) return;

      try {
        const role = guild.roles.cache.find(
          (findableRole) => findableRole.name === reactionRole.roleName,
        );
        if (!role) {
          await sendDebugMessage(
            client,
            `Role ${reactionRole.roleName} not found`,
          );
          return;
        }

        const humanCount = reaction.count - (reaction.me ? 1 : 0);

        const member = await guild.members.fetch(messageAuthorId);
        const memberName = member.nickname || member.user.username;

        const extenderMember = await guild.members.fetch(user.id);
        const extenderName = extenderMember.nickname || user.username;

        await grantOrExtendTempRole({
          client,
          TempRole,
          guild,
          message,
          member,
          memberName,
          role,
          count: humanCount,
          shouldGrant: humanCount >= reactionRole.threshold,
          extendMessage: `${extenderName} extended your role by four hours`,
          embedTitle: `${memberName} was determined to be ${reactionRole.roleName.replace(/People who are /g, "")}`,
          color: reactionRole.color,
          forwardChannel: reactionRole.forwardChannel,
        });
      } catch (error) {
        await sendDebugMessage(
          client,
          `Error handling reaction: ${formatError(error)}`,
        );
        await message.channel.send(
          "Something went wrong with storing a tempRole.",
        );
      }
    }),
  );

  const combinedRoles = config.workers.combinedReactionRoles ?? [];
  await Promise.all(
    combinedRoles.map(async (combinedRole) => {
      try {
        const counts = humanCounts(message, combinedRole.emojiNames);

        if (!counts.every((count) => count >= combinedRole.threshold)) return;

        const role = guild.roles.cache.find(
          (r) => r.name === combinedRole.roleName,
        );
        if (!role) {
          await sendDebugMessage(
            client,
            `Combined role ${combinedRole.roleName} not found`,
          );
          return;
        }

        const member = await guild.members.fetch(messageAuthorId);
        const memberName = member.nickname || member.user.username;

        await grantOrExtendTempRole({
          client,
          TempRole,
          guild,
          message,
          member,
          memberName,
          role,
          count: Math.min(...counts),
          shouldGrant: true,
          extendMessage: `${memberName}'s role was extended by four hours`,
          embedTitle: `${memberName} ${combinedRole.roleName.replace(/People who are |people who /gi, "")}`,
          color: combinedRole.color,
          forwardChannel: combinedRole.forwardChannel,
        });
      } catch (error) {
        await sendDebugMessage(
          client,
          `Error handling combined reaction: ${formatError(error)}`,
        );
        await message.channel.send(
          "Something went wrong with a combined role.",
        );
      }
    }),
  );
}

export async function handleReactionRemove(
  reaction,
  user,
  { client, TempRole, config },
) {
  if (user.id === client.user?.id) return;

  const { message } = reaction;

  if (!(await fetchPartialMessage(message, client))) return;

  const { channel, guild } = message;
  if (!canPostInChannel(channel.name)) return;

  const combinedRoles = config.workers.combinedReactionRoles ?? [];
  await Promise.all(
    combinedRoles.map(async (combinedRole) => {
      try {
        const counts = humanCounts(message, combinedRole.emojiNames);

        if (counts.every((count) => count >= combinedRole.threshold)) return;

        const role = guild.roles.cache.find(
          (r) => r.name === combinedRole.roleName,
        );
        if (!role) return;

        const messageAuthorId = await resolveMessageAuthorId(message, TempRole);
        if (!messageAuthorId) return;

        const member = await guild.members.fetch(messageAuthorId);

        const existingTempRole = await TempRole.findByKey(
          guild.id,
          member.id,
          role.id,
          message.id,
        );

        if (!existingTempRole) return;

        await member.roles.remove(role).catch(() => {});
        await TempRole.deleteById(existingTempRole.id);
      } catch (error) {
        await sendDebugMessage(
          client,
          `Error handling reaction remove: ${formatError(error)}`,
        );
      }
    }),
  );
}
