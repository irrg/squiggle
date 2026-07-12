import { EmbedBuilder } from "discord.js";
import canPostInChannel from "../utils/canPostInChannel.js";
import sendDebugMessage from "../utils/sendDebugMessage.js";

export async function handleReactionAdd(reaction, user, { client, TempRole, config }) {
  if (user.id === client.user?.id) return;

  let { message } = reaction;

  if (message.partial) {
    try {
      await message.fetch();
    } catch (error) {
      await sendDebugMessage(client, `Error fetching message: ${error.message}`);
      return;
    }
  }

  const { channel, guild } = message;

  if (!canPostInChannel(channel.name)) return;

  let messageAuthorId = message.author.id;
  if (message.author?.bot) {
    const sourceRole = await TempRole.findOne({
      where: { messageId: message.id },
    });
    if (!sourceRole) return;
    messageAuthorId = sourceRole.memberId;
  }

  if (user.id === messageAuthorId) return;

  await Promise.all(
    config.workers.reactionRoles.map(async (reactionRole) => {
      if (reaction.emoji.name !== reactionRole.emojiName) return;

      try {
        const role = guild.roles.cache.find(
          (findableRole) => findableRole.name === reactionRole.roleName,
        );
        if (!role) {
          await sendDebugMessage(client, `Role ${reactionRole.roleName} not found`);
          return;
        }

        const humanCount = reaction.count - (reaction.me ? 1 : 0);
        const { threshold } = reactionRole;

        const member = await guild.members.fetch(messageAuthorId);
        const memberName = member.nickname || member.user.username;

        const extenderMember = await guild.members.fetch(user.id);
        const extenderName = extenderMember.nickname || user.username;

        const existingTempRole = await TempRole.findOne({
          where: {
            guildId: guild.id,
            memberId: member.id,
            roleId: role.id,
            messageId: message.id,
          },
        });

        if (existingTempRole) {
          if (humanCount > existingTempRole.maxReactionCount) {
            if (!existingTempRole.expirationTime) {
              throw new Error(`TempRole ${existingTempRole.id} has null expirationTime`);
            }
            const expirationTime = new Date(
              existingTempRole.expirationTime.getTime() + 4 * 60 * 60 * 1000,
            );
            await existingTempRole.update({ expirationTime, maxReactionCount: humanCount });
            await message.reply(`${extenderName} extended your role by four hours`);
          }
        } else {
          if (humanCount >= threshold) {
            const expirationTime = new Date(new Date().getTime() + 16 * 60 * 60 * 1000);

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
                maxReactionCount: humanCount,
              });
            } catch (dbError) {
              if (dbError.name === "SequelizeUniqueConstraintError") return;
              await member.roles.remove(role).catch(() => {});
              throw dbError;
            }

            const embed = new EmbedBuilder()
              .setTitle(
                `${memberName} was determined to be ${reactionRole.roleName.replace(/People who are /g, "")}`,
              )
              .setColor(reactionRole.color)
              .setAuthor({ name: memberName, iconURL: member.displayAvatarURL() })
              .setTimestamp();

            await message.reply({ embeds: [embed] });

            if (reactionRole.forwardChannel) {
              const fwdChannel = guild.channels.cache.find(
                (ch) => ch.name === reactionRole.forwardChannel,
              );
              if (fwdChannel) {
                await message.forward(fwdChannel);
              } else {
                await sendDebugMessage(
                  client,
                  `forwardChannel "${reactionRole.forwardChannel}" not found`,
                );
              }
            }
          }
        }
      } catch (error) {
        await sendDebugMessage(
          client,
          `Error handling reaction: ${JSON.stringify(error, null, 2)}`,
        );
        await message.channel.send("Something went wrong with storing a tempRole.");
      }
    }),
  );

  const combinedRoles = config.workers.combinedReactionRoles ?? [];
  await Promise.all(
    combinedRoles.map(async (combinedRole) => {
      try {
        const counts = combinedRole.emojiNames.map((emojiName) => {
          const r = message.reactions.cache.find((rc) => rc.emoji.name === emojiName);
          return r ? r.count - (r.me ? 1 : 0) : 0;
        });

        if (!counts.every((count) => count >= combinedRole.threshold)) return;

        const role = guild.roles.cache.find((r) => r.name === combinedRole.roleName);
        if (!role) {
          await sendDebugMessage(client, `Combined role ${combinedRole.roleName} not found`);
          return;
        }

        const member = await guild.members.fetch(messageAuthorId);
        const memberName = member.nickname || member.user.username;

        const existingTempRole = await TempRole.findOne({
          where: {
            guildId: guild.id,
            memberId: member.id,
            roleId: role.id,
            messageId: message.id,
          },
        });

        const combinedCount = Math.min(...counts);

        if (existingTempRole) {
          if (combinedCount > existingTempRole.maxReactionCount) {
            if (!existingTempRole.expirationTime) {
              throw new Error(`TempRole ${existingTempRole.id} has null expirationTime`);
            }
            const expirationTime = new Date(
              existingTempRole.expirationTime.getTime() + 4 * 60 * 60 * 1000,
            );
            await existingTempRole.update({ expirationTime, maxReactionCount: combinedCount });
            await message.reply(`${memberName}'s role was extended by four hours`);
          }
        } else {
          const expirationTime = new Date(new Date().getTime() + 16 * 60 * 60 * 1000);
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
              maxReactionCount: combinedCount,
            });
          } catch (dbError) {
            if (dbError.name === "SequelizeUniqueConstraintError") return;
            await member.roles.remove(role).catch(() => {});
            throw dbError;
          }

          const embed = new EmbedBuilder()
            .setTitle(
              `${memberName} ${combinedRole.roleName.replace(/People who are |people who /gi, "")}`,
            )
            .setColor(combinedRole.color)
            .setAuthor({ name: memberName, iconURL: member.displayAvatarURL() })
            .setTimestamp();

          await message.reply({ embeds: [embed] });

          if (combinedRole.forwardChannel) {
            const fwdChannel = guild.channels.cache.find(
              (ch) => ch.name === combinedRole.forwardChannel,
            );
            if (fwdChannel) {
              await message.forward(fwdChannel);
            } else {
              await sendDebugMessage(
                client,
                `forwardChannel "${combinedRole.forwardChannel}" not found`,
              );
            }
          }
        }
      } catch (error) {
        await sendDebugMessage(
          client,
          `Error handling combined reaction: ${JSON.stringify(error, null, 2)}`,
        );
        await message.channel.send("Something went wrong with a combined role.");
      }
    }),
  );
}

export async function handleReactionRemove(reaction, user, { client, TempRole, config }) {
  if (user.id === client.user?.id) return;

  let { message } = reaction;
  if (message.partial) {
    try {
      await message.fetch();
    } catch (error) {
      await sendDebugMessage(client, `Error fetching message: ${error.message}`);
      return;
    }
  }

  const { channel, guild } = message;
  if (!canPostInChannel(channel.name)) return;

  const combinedRoles = config.workers.combinedReactionRoles ?? [];
  await Promise.all(
    combinedRoles.map(async (combinedRole) => {
      try {
        const counts = combinedRole.emojiNames.map((emojiName) => {
          const r = message.reactions.cache.find((rc) => rc.emoji.name === emojiName);
          return r ? r.count - (r.me ? 1 : 0) : 0;
        });

        if (counts.every((count) => count >= combinedRole.threshold)) return;

        const role = guild.roles.cache.find((r) => r.name === combinedRole.roleName);
        if (!role) return;

        let messageAuthorId = message.author.id;
        if (message.author?.bot) {
          const sourceRole = await TempRole.findOne({
            where: { messageId: message.id },
          });
          if (!sourceRole) return;
          messageAuthorId = sourceRole.memberId;
        }

        const member = await guild.members.fetch(messageAuthorId);

        const existingTempRole = await TempRole.findOne({
          where: {
            guildId: guild.id,
            memberId: member.id,
            roleId: role.id,
            messageId: message.id,
          },
        });

        if (!existingTempRole) return;

        await member.roles.remove(role).catch(() => {});
        await existingTempRole.destroy();
      } catch (error) {
        await sendDebugMessage(
          client,
          `Error handling reaction remove: ${JSON.stringify(error, null, 2)}`,
        );
      }
    }),
  );
}
