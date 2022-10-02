// Load stuff, and things.
const colors = require('colors');
const path = require('path');
const { requireFiles } = require('./utils/require-files');
const { sequelize } = require('./utils/sequelize');
global.appRoot = path.resolve(__dirname);
global.config = {};
global.config.bot = require('./config/bot.json');
global.config.modules = requireFiles('config/modules', true);

const { 
	client, 
	rest, 
	Routes 
} = require ('./utils/discord')
	.initializeDiscord(config);

// Ready
client.once('ready', async () => {
	console.log('😃 ' + `~~${config.bot.namePrefix}Squiggle~~`.rainbow + ' is online!'.red);
	let commands = requireFiles('modules/commands');
	const workers = requireFiles('modules/workers');
	const watchers = requireFiles('modules/watchers');

	// Workers
	if (workers.length > 0) {
		console.log('💪 Loading Workers…'.brightRed);
		workers.forEach(({ worker, interval, name }) => {
			setInterval(() => { worker(client, sequelize); },  interval);
			console.log(`💪 Worker '${name}' registered!`.gray);
		});
	}

	// Commands
	if (commands.length > 0) {
		try {
			console.log('📣 Loading Commands…'.brightRed);

			await rest.put(
				Routes.applicationCommands(client.application.id), 
				{ body: commands },
			);
			commands.forEach(({ name }) => {
				console.log(`📣 Command '${name}' registered!`.gray);
			});
		} catch (e) {
			console.error(e);
		}
	}
});

// run
client.login(config.bot.token);