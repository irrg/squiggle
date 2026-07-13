import dotenv from "dotenv";
dotenv.config();
import { REST } from "@discordjs/rest";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { Routes } from "discord-api-types/v10";
import fs from "fs";
import path from "path";
import { formatInTimeZone } from "date-fns-tz";
import config from "../config/config.json" with { type: "json" };
import canPostInChannel from "./utils/canPostInChannel.js";
import sendDebugMessage from "./utils/sendDebugMessage.js";
import { handleReactionAdd, handleReactionRemove } from "./handlers/reactions.js";
import createDB from "./models/tempRole.js";
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

const db = await createDB(process.env.DB_STORAGE);

client.once("clientReady", async () => {
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

  const appRoot = path.resolve();

  const commandsFiles = fs.readdirSync(path.join(appRoot, "./src/commands"));
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

  const workersFiles = fs.readdirSync(path.join(appRoot, "./src/workers"));
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
      workerModule.run(client, db);
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
    await selectedCommand.init(interaction, client, db);
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

client.on("messageReactionAdd", (reaction, user) =>
  handleReactionAdd(reaction, user, { client, TempRole: db, config }),
);

client.on("messageReactionRemove", (reaction, user) =>
  handleReactionRemove(reaction, user, { client, TempRole: db, config }),
);

client.login(process.env.DISCORD_TOKEN);
