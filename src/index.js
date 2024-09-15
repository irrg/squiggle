import dotenv from "dotenv";
dotenv.config();
import { REST } from "@discordjs/rest";
import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "discord.js";
import { Routes } from "discord-api-types/v10";
import fs from "fs";
import path from "path";
import { Sequelize } from "sequelize";
import { formatInTimeZone } from "date-fns-tz";
import config from "../config/config.json" assert { type: "json" };
import canPostInChannel from "./utils/canPostInChannel.js";
import sendDebugMessage from "./utils/sendDebugMessage.js";
import "colors";

// Initialize the Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Initialize the REST client for Discord API
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

const workerTmp = [];
const commandTmp = [];
let commands = [];

global.appRoot = path.resolve();

// Initialize Sequelize for database interaction
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT,
    storage: process.env.DB_STORAGE,
    logging: false,
  }
);

// Import the TempRole model
import TempRoleModel from "./models/tempRole.js";
const TempRole = TempRoleModel(sequelize);

// Event handler for when the bot is ready
client.once("ready", async () => {
  await TempRole.sync(/* { force: true } */);

  const now = new Date();
  const formattedDate = formatInTimeZone(now, "America/Chicago", "MMMM do yyyy, h:mm:ss a zzz");
  sendDebugMessage(client, `${config.bot.namePrefix}Squiggle came online at ${formattedDate}`, { emoji: '😃', color: 'red', bold: true });

  // Load and register commands
  const commandsFiles = fs.readdirSync(path.join(global.appRoot, "./src/commands"));
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

  // Wait for all command imports to complete
  commands = await Promise.all(commandPromises);

  // Load and register workers
  const workersFiles = fs.readdirSync(path.join(appRoot, "./src/workers"));
  const workerPromises = workersFiles.map(async (file) => {
    const workerModule = await import(`./workers/${file}`);
    setInterval(() => {
      workerModule.run(client, sequelize);
    }, workerModule.interval);
  });

  // Wait for all worker imports to complete
  await Promise.all(workerPromises);

  if (workersFiles.length > 0) {
    sendDebugMessage(client, "Workers registered!", { color: 'gray', emoji: '💪' });
    const workerMessages = workersFiles.map((file) => `${file}`);
    sendDebugMessage(client, workerMessages, { suboption: true });
  }

  // Register commands with Discord API
  try {
    await rest.put(Routes.applicationCommands(client.application.id), { body: commands });
    sendDebugMessage(client, "Commands registered!", { color: 'gray', emoji: '⌨️' });
    const commandMessages = commands.map((command) => `\`/${command.name}\`: ${command.description}`);
    sendDebugMessage(client, commandMessages, { suboption: true });
  } catch (error) {
    console.error("Error registering commands:", error);
    await sendDebugMessage(
      client,
      `Error registering commands: ${JSON.stringify(error, null, 2)}`,
      { emoji: '⚠️', color: 'red', bold: true }
    );
  }
});

// Event handler for command interactions
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) {
    return;
  }

  const { commandName, channel } = interaction;

  if (canPostInChannel(channel.name)) {
    const selectedCommand = commands.find((c) => commandName === c.name);
    try {
      await selectedCommand.init(interaction, client, sequelize);
    } catch (error) {
      console.error(error);
      await sendDebugMessage(
        client,
        `Error executing command ${commandName}: ${JSON.stringify(
          error,
          null,
          2
        )}`
      );
      await interaction.reply({
        content: "Something went wrong while executing the command.",
        ephemeral: true,
      });
    }
  } else {
    await interaction.reply({
      content: "This bot is not allowed to post in this channel.",
      ephemeral: true,
    });
  }
});

// Event handler for message reactions
client.on("messageReactionAdd", async (reaction, user) => {
  let { message } = reaction;

  // Fetch the message if it's not cached
  if (message.partial) {
    try {
      message = await message.fetch();
    } catch (error) {
      console.error("Error fetching message:", error);
      return;
    }
  }

  const { channel } = message;

  if (!canPostInChannel(channel.name)) {
    return;
  }

  config.workers.reactionRoles.forEach(async (reactionRole) => {
    if (reaction.emoji.name === reactionRole.emojiName) {
      try {
        const { guild } = message;
        const role = guild.roles.cache.find(
          (findableRole) => findableRole.name === reactionRole.roleName
        );
        if (!role) {
          console.error(`Role ${reactionRole.roleName} not found`);
          return;
        }

        const member = guild.members.cache.find(
          (findableMember) => findableMember.id === message.author.id
        );
        if (!member) {
          console.error(`Member ${message.author.id} not found`);
          return;
        }

        const memberName = member.nickname || member.user.username;

        // Fetch the member object for the user who added the reaction
        const extenderMember = await guild.members.fetch(user.id);
        const extenderName = extenderMember.nickname || user.username;

        // Fetch the existing TempRole entry for the specific message
        const existingTempRole = await TempRole.findOne({
          where: {
            guildId: guild.id,
            memberId: member.id,
            roleId: role.id,
            messageId: message.id, // Filter by message ID
          },
        });

        let expirationTime;
        if (existingTempRole) {
          // Update the expiration time by adding 2 hours
          expirationTime = new Date(existingTempRole.expirationTime.getTime() + 4 * 60 * 60 * 1000);
          await existingTempRole.update({ expirationTime });

          // Send a message to the channel
          await message.reply(`${extenderName} extended your role by two hours`);
        } else {
          // Set the expiration time to 24 hours from now
          expirationTime = new Date(new Date().getTime() + 16 * 60 * 60 * 1000);

          // Create a new instance of the role in the database
          await TempRole.create({
            guildId: guild.id,
            memberId: member.id,
            memberName,
            roleId: role.id,
            roleName: role.name,
            messageId: message.id, // Store the message ID
            expirationTime,
          });

          // Add the role to the member
          member.roles.add(role);

          const embed = new EmbedBuilder()
            .setTitle(
              `${memberName} was determined to be ${reactionRole.roleName.replace(
                /People who are /g,
                ""
              )}`
            )
            .setColor(reactionRole.color)
            .setAuthor({
              name: memberName,
              iconURL: member.displayAvatarURL(),
            })
            .setTimestamp();

          await message.reply({ embeds: [embed] });
        }
      } catch (error) {
        console.error(error);
        await sendDebugMessage(
          client,
          `Error handling reaction: ${JSON.stringify(error, null, 2)}`
        );
        await message.channel.send(
          "Something went wrong with storing a tempRole."
        );
      }
    }
  });
});

// Log in to Discord
client.login(process.env.DISCORD_TOKEN);