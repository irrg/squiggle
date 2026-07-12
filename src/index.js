import dotenv from "dotenv";
dotenv.config();
import { REST } from "@discordjs/rest";
import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "discord.js";
import { Routes } from "discord-api-types/v10";
import fs from "fs";
import path from "path";
import { Sequelize } from "sequelize";
import { formatInTimeZone } from "date-fns-tz";
import config from "../config/config.json" with { type: "json" };
import canPostInChannel from "./utils/canPostInChannel.js";
import sendDebugMessage from "./utils/sendDebugMessage.js";
import "colors";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

let commands = [];

global.appRoot = path.resolve();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT,
    storage: process.env.DB_STORAGE,
    logging: false,
  },
);

import TempRoleModel from "./models/tempRole.js";
const TempRole = TempRoleModel(sequelize);

client.once("ready", async () => {
  await TempRole.sync({ alter: true });

  const now = new Date();
  const formattedDate = formatInTimeZone(
    now,
    "America/Chicago",
    "MMMM do yyyy, h:mm:ss a zzz",
  );
  sendDebugMessage(
    client,
    `${config.bot.namePrefix}Squiggle came online at ${formattedDate}`,
    { emoji: "😃", color: "red", bold: true },
  );

  const commandsFiles = fs.readdirSync(
    path.join(global.appRoot, "./src/commands"),
  );
  const commandPromises = commandsFiles.map(async (file) => {
    const commandModule = await import(`./commands/${file}`);
    const commandName = commandModule.commandName || file.split(".")[0];
    return {
      name: `${config.bot.commandPrefix || ""}${commandName}`,
      description: commandModule.description || "No description provided",
      init: commandModule.init,
      options: commandModule.options || [],
    };
  });

  commands = await Promise.all(commandPromises);

  const workersFiles = fs.readdirSync(
    path.join(global.appRoot, "./src/workers"),
  );
  const workerPromises = workersFiles.map(async (file) => {
    const workerModule = await import(`./workers/${file}`);
    if (
      typeof workerModule.interval !== "number" ||
      workerModule.interval <= 0
    ) {
      console.error(
        `Worker ${file} has invalid interval: ${workerModule.interval}`,
      );
      return;
    }
    setInterval(() => {
      workerModule.run(client, sequelize);
    }, workerModule.interval);
  });

  await Promise.all(workerPromises);

  if (workersFiles.length > 0) {
    sendDebugMessage(client, "Workers registered!", {
      color: "gray",
      emoji: "💪",
    });
    sendDebugMessage(client, workersFiles, { suboption: true });
  }

  try {
    await rest.put(Routes.applicationCommands(client.application.id), {
      body: commands,
    });
    sendDebugMessage(client, "Commands registered!", {
      color: "gray",
      emoji: "⌨️",
    });
    const commandMessages = commands.map(
      (command) => `\`/${command.name}\`: ${command.description}`,
    );
    sendDebugMessage(client, commandMessages, { suboption: true });
  } catch (error) {
    console.error("Error registering commands:", error);
    await sendDebugMessage(
      client,
      `Error registering commands: ${JSON.stringify(error, null, 2)}`,
      { emoji: "⚠️", color: "red", bold: true },
    );
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) {
    return;
  }

  const { commandName, channel } = interaction;

  // Guard against DMs where channel is null or has no name
  if (!channel || !canPostInChannel(channel.name)) {
    await interaction.reply({
      content: "This bot is not allowed to post in this channel.",
      ephemeral: true,
    });
    return;
  }

  const selectedCommand = commands.find((c) => commandName === c.name);
  if (!selectedCommand) {
    await interaction.reply({ content: "Unknown command.", ephemeral: true });
    return;
  }

  try {
    await selectedCommand.init(interaction, client, sequelize);
  } catch (error) {
    console.error(error);
    await sendDebugMessage(
      client,
      `Error executing command ${commandName}: ${JSON.stringify(
        error,
        null,
        2,
      )}`,
    );
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Something went wrong while executing the command.",
        ephemeral: true,
      });
    }
  }
});

client.on("messageReactionAdd", async (reaction, user) => {
  let { message } = reaction;

  if (message.partial) {
    try {
      await message.fetch();
    } catch (error) {
      await sendDebugMessage(
        client,
        `Error fetching message: ${error.message}`,
      );
      return;
    }
  }

  const { channel } = message;

  if (!canPostInChannel(channel.name)) {
    return;
  }

  await Promise.all(
    config.workers.reactionRoles.map(async (reactionRole) => {
      if (reaction.emoji.name !== reactionRole.emojiName) {
        return;
      }

      try {
        const { guild } = message;
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

        // Fetch from API instead of cache to guarantee the member is found
        const member = await guild.members.fetch(message.author.id);
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

        const { threshold } = reactionRole;

        if (existingTempRole) {
          // Only extend if this is a genuinely new reactor — count must exceed
          // the previous high-water mark to prevent remove+re-add gaming
          if (reaction.count > existingTempRole.maxReactionCount) {
            if (!existingTempRole.expirationTime) {
              throw new Error(
                `TempRole ${existingTempRole.id} has null expirationTime`,
              );
            }
            const expirationTime = new Date(
              existingTempRole.expirationTime.getTime() + 4 * 60 * 60 * 1000,
            );
            await existingTempRole.update({
              expirationTime,
              maxReactionCount: reaction.count,
            });
            await message.reply(
              `${extenderName} extended your role by four hours`,
            );
          }
        } else {
          if (reaction.count >= threshold) {
            const expirationTime = new Date(
              new Date().getTime() + 16 * 60 * 60 * 1000,
            );

            // Add role first; if DB write fails, roll back the role assignment
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
                maxReactionCount: reaction.count,
              });
            } catch (dbError) {
              await member.roles.remove(role).catch(() => {});
              throw dbError;
            }

            const embed = new EmbedBuilder()
              .setTitle(
                `${memberName} was determined to be ${reactionRole.roleName.replace(
                  /People who are /g,
                  "",
                )}`,
              )
              .setColor(reactionRole.color)
              .setAuthor({
                name: memberName,
                iconURL: member.displayAvatarURL(),
              })
              .setTimestamp();

            await message.reply({ embeds: [embed] });
          }
        }
      } catch (error) {
        await sendDebugMessage(
          client,
          `Error handling reaction: ${JSON.stringify(error, null, 2)}`,
        );
        await message.channel.send(
          "Something went wrong with storing a tempRole.",
        );
      }
    }),
  );

  // Check combined reaction role conditions (e.g. both TheBest + TheWorst)
  const combinedRoles = config.workers.combinedReactionRoles ?? [];
  await Promise.all(
    combinedRoles.map(async (combinedRole) => {
      try {
        const { guild } = message;

        const counts = combinedRole.emojiNames.map((emojiName) => {
          const r = message.reactions.cache.find(
            (rc) => rc.emoji.name === emojiName,
          );
          return r ? r.count : 0;
        });

        if (!counts.every((count) => count >= combinedRole.threshold)) {
          return;
        }

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

        const member = await guild.members.fetch(message.author.id);
        const memberName = member.nickname || member.user.username;

        const existingTempRole = await TempRole.findOne({
          where: {
            guildId: guild.id,
            memberId: member.id,
            roleId: role.id,
            messageId: message.id,
          },
        });

        const combinedCount = counts.reduce((sum, c) => sum + c, 0);

        if (existingTempRole) {
          if (combinedCount > existingTempRole.maxReactionCount) {
            if (!existingTempRole.expirationTime) {
              throw new Error(
                `TempRole ${existingTempRole.id} has null expirationTime`,
              );
            }
            const expirationTime = new Date(
              existingTempRole.expirationTime.getTime() + 4 * 60 * 60 * 1000,
            );
            await existingTempRole.update({
              expirationTime,
              maxReactionCount: combinedCount,
            });
            await message.reply(
              `${memberName}'s role was extended by four hours`,
            );
          }
        } else {
          const expirationTime = new Date(
            new Date().getTime() + 16 * 60 * 60 * 1000,
          );
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
            await member.roles.remove(role).catch(() => {});
            throw dbError;
          }

          const embed = new EmbedBuilder()
            .setTitle(
              `${memberName} ${combinedRole.roleName.replace(/People who are |people who /gi, "")}`,
            )
            .setColor(combinedRole.color)
            .setAuthor({
              name: memberName,
              iconURL: member.displayAvatarURL(),
            })
            .setTimestamp();

          await message.reply({ embeds: [embed] });
        }
      } catch (error) {
        await sendDebugMessage(
          client,
          `Error handling combined reaction: ${JSON.stringify(error, null, 2)}`,
        );
        await message.channel.send(
          "Something went wrong with a combined role.",
        );
      }
    }),
  );
});

client.login(process.env.DISCORD_TOKEN);
