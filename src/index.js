import dotenv from "dotenv";
dotenv.config();
import { REST } from "@discordjs/rest";
import { Client, Intents, MessageEmbed } from "discord.js";
import { Routes } from "discord-api-types/v9";
import fs from "fs";
import path from "path";
import { Sequelize } from "sequelize";
import config from "../config/config.json" assert { type: "json" };
import canPostInChannel from "./utils/canPostInChannel.js";
import sendDebugMessage from "./utils/sendDebugMessage.js";
import "colors";

// Initialize the Discord client with necessary intents
const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
  ],
});

// Initialize the REST client for Discord API
const rest = new REST({ version: "9" }).setToken(process.env.DISCORD_TOKEN);

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

  console.log(
    `😃${config.bot.namePrefix}Squiggle`.red.bold + " is online!".red
  );

  // Load and register commands
  const commandsFiles = fs.readdirSync(path.join(appRoot, "./commands"));
  commandsFiles.forEach((file, i) => {
    commandTmp[i] = import(`./commands/${file}`);
    commands = [
      ...commands,
      {
        name: `${config.bot.commandPrefix || ""}${
          commandTmp[i].commandName || file.split(".")[0]
        }`,
        description: commandTmp[i].description,
        init: commandTmp[i].init,
        options: commandTmp[i].options,
      },
    ];
  });

  // Load and register workers
  const workersFiles = fs.readdirSync(path.join(appRoot, "./workers"));
  workersFiles.forEach(async (file, i) => {
    workerTmp[i] = await import(`./workers/${file}`);
    setInterval(() => {
      workerTmp[i].run(client, sequelize);
    }, workerTmp[i].interval);
  });

  if (workersFiles.length > 0) {
    console.log("✅ Workers registered!".gray);
    workersFiles.forEach((file) => {
      console.log(`  - ${file}`.white);
    });
  }

  // Register commands with Discord API
  rest
    .put(Routes.applicationCommands(client.application.id), { body: commands })
    .then(() => {
      console.log("✅ Commands registered!".gray);
      commands.forEach((command) => {
        console.log(
          `  - /${command.name}: `.white + `${command.description}`.gray
        );
      });
    })
    .catch(async (error) => {
      console.error(error);
      await sendDebugMessage(
        client,
        `Error registering commands: ${JSON.stringify(error, null, 2)}`
      );
    });
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
client.on("messageReactionAdd", async (reaction) => {
  const { channel } = reaction.message;

  if (!canPostInChannel(channel.name)) {
    return;
  }

  config.workers.reactionRoles.forEach(async (reactionRole) => {
    if (
      reaction.emoji.name === reactionRole.emojiName &&
      reaction.count === reactionRole.threshold
    ) {
      try {
        const { guild } = reaction.message;
        const role = guild.roles.cache.find(
          (findableRole) => findableRole.name === reactionRole.roleName
        );
        const member = guild.members.cache.find(
          (findableMember) => findableMember.id === reaction.message.author.id
        );
        const memberName = member.nickname || member.user.username;
        const expirationTime = new Date(
          new Date().getTime() + 24 * 60 * 60 * 1000
        );

        // Delete existing instances of the role in the database
        await TempRole.destroy({
          where: {
            guildId: guild.id,
            memberId: member.id,
            roleId: role.id,
          },
        });

        // Create a new instance of the role in the database
        await TempRole.create({
          guildId: guild.id,
          memberId: member.id,
          memberName,
          roleId: role.id,
          roleName: role.name,
          expirationTime,
        });

        // Add the role to the member
        member.roles.add(role);

        const embed = new MessageEmbed()
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

        await reaction.message.channel.send({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await sendDebugMessage(
          client,
          `Error handling reaction: ${JSON.stringify(error, null, 2)}`
        );
        await reaction.message.channel.send(
          "Something went wrong with storing a tempRole."
        );
      }
    }
  });
});

// Log in to Discord
client.login(process.env.DISCORD_TOKEN);