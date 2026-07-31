import { EmbedBuilder, MessageReferenceType } from "discord.js";
import canPostInChannel from "../utils/canPostInChannel.js";
import sendDebugMessage from "../utils/sendDebugMessage.js";
import formatError from "../utils/formatError.js";
import {
  TEMP_ROLE_DURATION_MS,
  TEMP_ROLE_EXTENSION_MS,
  REACTION_DEBOUNCE_MS,
} from "../constants.js";

// Reactions mashed on the same message within this window collapse into a
// single evaluation pass and a single reply, instead of one per reaction.
const pendingEvaluations = new Map();

function scheduleEvaluation(messageId, evaluate) {
  clearTimeout(pendingEvaluations.get(messageId));
  const timer = setTimeout(() => {
    pendingEvaluations.delete(messageId);
    evaluate();
  }, REACTION_DEBOUNCE_MS);
  pendingEvaluations.set(messageId, timer);
}

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
// Returns "extended" | "granted" | null so callers can batch notifications
// instead of replying per role.
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
    // Already expired and role removed — don't resurrect it as a "new" besting.
    if (existingTempRole.spent) return null;
    if (count > existingTempRole.maxReactionCount) {
      const expirationTime = new Date(
        existingTempRole.expirationTime.getTime() + TEMP_ROLE_EXTENSION_MS,
      );
      await TempRole.extend(existingTempRole.id, expirationTime, count);
      return "extended";
    }
    return null;
  }

  if (!shouldGrant) return null;

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
    if (dbError.name === "UniqueConstraintError") return null;
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

  return "granted";
}

// Runs once per debounce window, regardless of how many reactions landed
// during it. Re-reads reaction counts fresh from the message's live cache,
// so it reflects everything that happened in the window.
async function evaluateReactionRoles({
  client,
  TempRole,
  config,
  guild,
  message,
  messageAuthorId,
}) {
  let member;
  try {
    member = await guild.members.fetch(messageAuthorId);
  } catch (error) {
    await sendDebugMessage(
      client,
      `Error fetching member for reaction roles: ${formatError(error)}`,
    );
    return;
  }
  const memberName = member.nickname || member.user.username;
  const extendedRoleNames = [];

  // Sequential, not Promise.all — two config entries can target the same
  // Discord role, and interleaving their read-then-write TempRole calls
  // would race the same way the original per-event handling did.
  for (const reactionRole of config.workers.reactionRoles) {
    try {
      const role = guild.roles.cache.find(
        (findableRole) => findableRole.name === reactionRole.roleName,
      );
      if (!role) {
        await sendDebugMessage(
          client,
          `Role ${reactionRole.roleName} not found`,
        );
        continue;
      }

      const [humanCount] = humanCounts(message, [reactionRole.emojiName]);

      const action = await grantOrExtendTempRole({
        client,
        TempRole,
        guild,
        message,
        member,
        memberName,
        role,
        count: humanCount,
        shouldGrant: humanCount >= reactionRole.threshold,
        embedTitle: `${memberName} was determined to be ${reactionRole.roleName.replace(/People who are /g, "")}`,
        color: reactionRole.color,
        forwardChannel: reactionRole.forwardChannel,
      });
      if (action === "extended") extendedRoleNames.push(role.name);
    } catch (error) {
      await sendDebugMessage(
        client,
        `Error handling reaction: ${formatError(error)}`,
      );
      await message.channel.send(
        "Something went wrong with storing a tempRole.",
      );
    }
  }

  const combinedRoles = config.workers.combinedReactionRoles ?? [];
  for (const combinedRole of combinedRoles) {
    try {
      const counts = humanCounts(message, combinedRole.emojiNames);

      if (!counts.every((count) => count >= combinedRole.threshold)) continue;

      const role = guild.roles.cache.find(
        (r) => r.name === combinedRole.roleName,
      );
      if (!role) {
        await sendDebugMessage(
          client,
          `Combined role ${combinedRole.roleName} not found`,
        );
        continue;
      }

      const action = await grantOrExtendTempRole({
        client,
        TempRole,
        guild,
        message,
        member,
        memberName,
        role,
        count: Math.min(...counts),
        shouldGrant: true,
        embedTitle: `${memberName} ${combinedRole.roleName.replace(/People who are |people who /gi, "")}`,
        color: combinedRole.color,
        forwardChannel: combinedRole.forwardChannel,
      });
      if (action === "extended") extendedRoleNames.push(role.name);
    } catch (error) {
      await sendDebugMessage(
        client,
        `Error handling combined reaction: ${formatError(error)}`,
      );
      await message.channel.send("Something went wrong with a combined role.");
    }
  }

  if (extendedRoleNames.length > 0) {
    const names = [...new Set(extendedRoleNames)];
    const roleList = names.map((name) => `**${name}**`).join(", ");
    await message.reply(`Extended by four hours: ${roleList}`);
  }
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

  scheduleEvaluation(message.id, () =>
    evaluateReactionRoles({
      client,
      TempRole,
      config,
      guild,
      message,
      messageAuthorId,
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

        if (!existingTempRole || existingTempRole.spent) return;

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
