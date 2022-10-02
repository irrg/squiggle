const initializeDiscord = (config) => {
	// DiscordJS
	const token = config.bot.token;
	const { REST } = require('@discordjs/rest');
	const { Client, Intents, MessageEmbed } = require('discord.js')
	const { Routes } = require('discord-api-types/v9');
	const client = new Client({ intents: [
		Intents.FLAGS.GUILDS,
		Intents.FLAGS.GUILD_MEMBERS,
		Intents.FLAGS.GUILD_MESSAGES,
		Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
	] });
	const rest = new REST({ version: '9' }).setToken(token);
	return { 
		client,
		rest,
		Routes,
	}
}

module.exports = {
	initializeDiscord,
};