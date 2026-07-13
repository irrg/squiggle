import dotenv from "dotenv";
dotenv.config();
import { REST } from "@discordjs/rest";
import { Client, GatewayIntentBits, MessageFlags, Partials } from "discord.js";
import { Routes } from "discord-api-types/v10";
import path from "path";
import { formatInTimeZone } from "date-fns-tz";
import config from "../config/config.json" with { type: "json" };
import canPostInChannel from "./utils/canPostInChannel.js";
import sendDebugMessage from "./utils/sendDebugMessage.js";
import formatError from "./utils/formatError.js";
import {
  handleReactionAdd,
  handleReactionRemove,
} from "./handlers/reactions.js";
import createDB from "./models/tempRole.js";
import { loadCommands, loadWorkers, nonOverlapping } from "./loaders.js";

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

const db = await createDB(process.env.DB_STORAGE);

// Load before login so interactionCreate never sees an empty command list
const commands = await loadCommands(
  path.join(import.meta.dirname, "commands"),
  config.bot.commandPrefix || "",
);
const workers = await loadWorkers(path.join(import.meta.dirname, "workers"));

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

  for (const worker of workers) {
    const run = nonOverlapping(worker.run);
    setInterval(() => {
      run(client, db).catch((error) => {
        console.error(`Worker ${worker.name} failed:`, formatError(error));
      });
    }, worker.interval);
  }

  if (workers.length > 0) {
    sendDebugMessage(client, "Workers registered!", {
      color: "gray",
      emoji: "💪",
    });
    sendDebugMessage(
      client,
      workers.map((worker) => worker.name),
      { suboption: true },
    );
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

    for (const guild of client.guilds.cache.values()) {
      await rest.put(
        Routes.applicationGuildCommands(client.application.id, guild.id),
        { body: [] },
      );
    }
  } catch (error) {
    console.error("Error registering commands:", error);
    await sendDebugMessage(
      client,
      `Error registering commands: ${formatError(error)}`,
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
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedCommand = commands.find((c) => commandName === c.name);
  if (!selectedCommand) {
    await interaction.reply({
      content: "Unknown command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await selectedCommand.init(interaction, client, db);
  } catch (error) {
    console.error(error);
    await sendDebugMessage(
      client,
      `Error executing command ${commandName}: ${formatError(error)}`,
    );
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Something went wrong while executing the command.",
        flags: MessageFlags.Ephemeral,
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

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Failed to log in to Discord:", formatError(error));
  process.exit(1);
});
