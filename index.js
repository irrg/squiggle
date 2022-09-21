const colors = require('colors');

// DiscordJS
const { token } = require('./config.json');
const { REST } = require('@discordjs/rest');
const { Client, Intents } = require('discord.js')
const { Routes } = require('discord-api-types/v9');
const client = new Client({ intents: [Intents.FLAGS.GUILDS] })
const rest = new REST({ version: '9' }).setToken(token);

const fs = require('fs');
const path = require('path');

let commandTmp = [];
let commands = [];

global.__appRoot = path.resolve(__dirname);

client.once('ready', () => {
	console.log('😃 ' + '~~Squiggle~~'.red.bold + ' is online!'.red);

	let commandsFiles = fs.readdirSync(path.join(__dirname, './commands'));

	commandsFiles.forEach((file, i) => {
		commandTmp[i] = require('./commands/' + file);
		commands = [
			...commands,
			{
				name: file.split('.')[0],
				description: commandTmp[i].description,
				init: commandTmp[i].init,
				options: commandTmp[i].options,
			},
		];
	})

	rest.put(
		Routes.applicationCommands(client.application.id), 
		{ body: commands },
	).then(() => {
		console.log('✅ Commands registered!'.gray);
	})
	.catch(console.error);
})

client.on('interactionCreate', async interaction => {
	if (!interaction.isCommand()) {
		return;
	}

	const { commandName } = interaction;
	const selectedCommand = commands.find(c => commandName === c.name);
	selectedCommand.init(interaction, client);
});

// run
client.login(token);