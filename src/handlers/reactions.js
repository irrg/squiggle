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

// Everyone who reacted during the current debounce window, so the rollup
// reply can credit them instead of naming only the reaction that happened
// to close the window.
const pendingReactors = new Map();

// Stores the raw reactor (no nickname lookup here) — resolving on every
// single reaction event would mean a members.fetch() per event even when
// the burst never ends up granting or extending anything. Display names
// get resolved once, in bulk, only if the evaluation actually needs them.
function trackReactor(messageId, user) {
  if (!pendingReactors.has(messageId))
    pendingReactors.set(messageId, new Map());
  pendingReactors.get(messageId).set(user.id, user);
}

function takeReactors(messageId) {
  const reactors = pendingReactors.get(messageId);
  pendingReactors.delete(messageId);
  return reactors ? [...reactors.values()] : [];
}

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

// Nickname if the member set one for this server, otherwise their global
// username — mirrors how the post author's own name is resolved
// (member.nickname || member.user.username) so credited names read like
// the rest of the card instead of falling back to Discord's global handle.
async function resolveDisplayName(guild, user) {
  const member =
    guild.members.cache.get(user.id) ??
    (await guild.members.fetch(user.id).catch(() => null));
  return member ? member.nickname || member.user.username : user.username;
}

// Discord keeps the real roster of who reacted with each emoji — no need to
// store it ourselves. Union across emojiNames (a combined role needs more
// than one) and dedupe, since the same person can react with several.
async function reactorUsernames(message, guild, emojiNames, botId) {
  const names = new Map();
  for (const emojiName of emojiNames) {
    const r = message.reactions.cache.find((rc) => rc.emoji.name === emojiName);
    if (!r) continue;
    const users = await r.users.fetch();
    for (const user of users.values()) {
      if (user.id === botId || names.has(user.id)) continue;
      names.set(user.id, await resolveDisplayName(guild, user));
    }
  }
  return [...names.values()];
}

function formatNameList(names) {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

// Shared "X determined Y to be Z" phrasing used by both grant and extend
// titles. Falls back to a subject-less phrasing when Discord doesn't hand
// back a voter list (should be rare — see reactorUsernames).
function determinedTitle(subject, memberName, predicate, fallback) {
  return subject
    ? `${subject} determined ${memberName} to be ${predicate}`
    : fallback;
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
  buildTitle,
  color,
  forwardChannel,
  emojiNames,
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

  const voterNames = await reactorUsernames(
    message,
    guild,
    emojiNames,
    client.user?.id,
  );

  const embed = new EmbedBuilder()
    .setTitle(buildTitle(voterNames))
    .setColor(color)
    .setAuthor({ name: memberName, iconURL: member.displayAvatarURL() })
    .setTimestamp();

  await message.reply({ embeds: [embed] });

  // Role + tempRole record are already committed at this point, so a forward
  // failure (e.g. Discord rejects cross-posting between NSFW/non-NSFW
  // channels) isn't a grant failure — don't let it be reported as one.
  try {
    await forwardIfConfigured({
      client,
      guild,
      message,
      channelName: forwardChannel,
    });
  } catch (forwardError) {
    await sendDebugMessage(
      client,
      `Error forwarding to "${forwardChannel}": ${formatError(forwardError)}`,
    );
  }

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
  reactors,
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
  const extendedRoles = [];

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
      const predicate = reactionRole.roleName.replace(/People who are /g, "");

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
        buildTitle: (voterNames) =>
          determinedTitle(
            formatNameList(voterNames),
            memberName,
            predicate,
            `${memberName} was determined to be ${predicate}`,
          ),
        color: reactionRole.color,
        forwardChannel: reactionRole.forwardChannel,
        emojiNames: [reactionRole.emojiName],
      });
      if (action === "extended")
        extendedRoles.push({
          name: role.name,
          predicate,
          color: reactionRole.color,
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

      const predicate = combinedRole.roleName.replace(
        /People who are |people who /gi,
        "",
      );

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
        buildTitle: (voterNames) =>
          determinedTitle(
            formatNameList(voterNames),
            memberName,
            predicate,
            `${memberName} ${predicate}`,
          ),
        color: combinedRole.color,
        forwardChannel: combinedRole.forwardChannel,
        emojiNames: combinedRole.emojiNames,
      });
      if (action === "extended")
        extendedRoles.push({
          name: role.name,
          predicate,
          color: combinedRole.color,
        });
    } catch (error) {
      await sendDebugMessage(
        client,
        `Error handling combined reaction: ${formatError(error)}`,
      );
      await message.channel.send("Something went wrong with a combined role.");
    }
  }

  if (extendedRoles.length > 0) {
    const uniqueRoles = [
      ...new Map(extendedRoles.map((r) => [r.name, r])).values(),
    ];
    const reactorNames = await Promise.all(
      reactors.map((reactor) => resolveDisplayName(guild, reactor)),
    );
    const subject = formatNameList(reactorNames);

    const embed = new EmbedBuilder()
      .setAuthor({ name: memberName, iconURL: member.displayAvatarURL() })
      .setTimestamp();

    if (uniqueRoles.length === 1) {
      const { predicate, color } = uniqueRoles[0];
      const title = determinedTitle(
        subject,
        memberName,
        predicate,
        `${memberName} was determined to be ${predicate}`,
      );
      embed
        .setTitle(`${title} and extended their role for another four hours`)
        .setColor(color);
    } else {
      const roleList = uniqueRoles.map((r) => r.name).join(", ");
      embed
        .setTitle(
          subject
            ? `${subject} extended ${memberName}'s roles for another four hours`
            : `${memberName}'s roles were extended for another four hours`,
        )
        .addFields({ name: "Roles", value: roleList })
        .setColor("#5865F2");
    }

    await message.reply({ embeds: [embed] });
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

  trackReactor(message.id, user);

  scheduleEvaluation(message.id, () =>
    evaluateReactionRoles({
      client,
      TempRole,
      config,
      guild,
      message,
      messageAuthorId,
      reactors: takeReactors(message.id),
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
        // Mark spent (not delete) — reactions climbing back up shouldn't
        // let this message re-qualify as a "fresh" besting/worsting.
        await TempRole.markSpent(existingTempRole.id);
      } catch (error) {
        await sendDebugMessage(
          client,
          `Error handling reaction remove: ${formatError(error)}`,
        );
      }
    }),
  );
}
