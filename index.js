// Misc
const colors = require('colors');
const fs = require('fs');
const path = require('path');

global.__appRoot = path.resolve(__dirname);

// Config
const { prefix, token } = require('./config.json');
const reactionRoles = require('./reaction-roles.json');

// DiscordJS
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

// Sequelize
const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('database', 'user', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: false,
	storage: 'database.sqlite',
});
const TempRole = require(`${__appRoot}/models/tempRole`)(sequelize);

// Methods
const loadScripts = (directory) => {
	const requiredFiles = [];

	fs.readdirSync(path.join(__dirname, `./${directory}`))
		.map((file) => ({ require(`./${directory}/${file}`) });

	return requiredFiles;
};

// Ready
client.once('ready', async () => {
	console.log('😃 ' + `~~${prefix}Squiggle~~`.red.bold + ' is online!'.red);
	const commands = loadScripts('commands')
		.map(( { init, props: { description, name, options },
		} ) => ({ 
			handler: init,
			description,
			name: `${prefix}${name}`,
			options,			
		})); 

	console.log(commands);

	const workers = loadScripts('workers');

	if (workers.length > 0) {
		console.log('✅ Workers registered!'.gray);

		// workers.forEach(({  handler, props: { interval },
		// }) => {
		// 	setInterval( () => { handler(client, sequelize); },  interval);
		// });		
	}

	try {
		await rest.put(
			Routes.applicationCommands(client.application.id), 
			{ body: commands },
		);
		console.log('✅ Commands registered!'.gray);
	} catch (e) {
		console.error(e);
	}
});

// run
client.login(token);