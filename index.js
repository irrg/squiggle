// Sequelize
const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('database', 'user', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: false,
	storage: 'database.sqlite',
});

// DiscordJS
const { token } = require('./config.json');
const { REST } = require('@discordjs/rest');
const { Client, Intents } = require('discord.js')
const { Routes } = require('discord-api-types/v9');
const client = new Client({ intents: [Intents.FLAGS.GUILDS] })
const rest = new REST({ version: '9' }).setToken(token);

const colors = require('colors');
const fs = require('fs');
const path = require('path');

let workerTmp = [];
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

	let workersFiles = fs.readdirSync(path.join(__dirname, './workers'));

	commandsFiles.forEach(async (file, i) => {
		workerTmp[i] = require('./workers/' + file);
		setInterval(() => { workerTmp[i].run(client, sequelize); }, workerTmp[i].interval);
	});
	
	if (workersFiles.length > 0) {
		console.log('✅ Workers registered!'.gray);
	}

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
	selectedCommand.init(interaction, client, sequelize);
});

// run
client.login(token);