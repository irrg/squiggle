// Config
const { 
		bot: { 
			commandPrefix,
			namePrefix,
		},
		discord: { token },
		database: databaseConfig,
} = require('./config/config.json');

// Imports
const requireFiles = require('./utils/require-files.js')
const { client, Routes, rest } = require('./utils/discord.js')(token);
const { MessageEmbed } = require('discord.js');
const colors = require('colors');
const fs = require('fs');
const path = require('path');

let commands = [];
let workers = [];

global.__appRoot = path.resolve(__dirname);

// Sequelize
const sequelize = require('./utils/sequelize.js')(databaseConfig);
const TempRole = require(`${__appRoot}/models/tempRole`)(sequelize);

client.once('ready', async () => {
	console.log('😃 ' + `~~${namePrefix}Squiggle~~`.red.bold + ' is online!'.red);

	commands = requireFiles('./modules/commands');
	workers = requireFiles('./modules/workers');

	await TempRole.sync();

	// Update Command name with prefix if needed
	if (commandPrefix.length > 0) {
		commands = commands.map((command) => ({
			...command,
			name: commandPrefix + command.name,
		}));
	}
	
	workers.forEach((worker) => {
		setInterval(() => { worker.run(client, sequelize); }, worker.interval);
	});
	
	if (workers.length > 0) {
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
	const command = commands.find(c => commandName === c.name);
	command.init(interaction, client, sequelize);
});

client.on('messageReactionAdd', async (reaction, user) => {
 const reactionRoles = require('./config/reaction-roles.json');
	reactionRoles.forEach(async (reactionRole) => {
		if (
			reaction.emoji.name === reactionRole.emojiName && 
			reaction.count === reactionRole.threshold
		) {
			const { guild } = reaction.message;
			const role = guild.roles.cache.find((role) => role.name === reactionRole.roleName); 
			const member = guild.members.cache.find(member => member.id === reaction.message.author.id); 
			const expirationTime = new Date(new Date().getTime() + (24 * 60 * 60 * 1000));

			const memberName = member.nickname || member.user.username;

			try {
				const tempRole = await TempRole.create({
					guildId: guild.id,
					memberId: member.id,
					memberName,
					roleId: role.id,
					roleName: role.name,
					expirationTime,
				});
		
				member.roles.add(role);
		
				const embed = new MessageEmbed()
					.setTitle(`${memberName} was determined to be ${reactionRole.roleName.replace(/People who are /g, '')}`)
					.setColor(reactionRole.color)
					.setAuthor({ 
						name: memberName, 
						iconURL: member.displayAvatarURL(),
					})
					.setTimestamp();

				await reaction.message.channel.send({ embeds: [embed] });
			} catch (error) {
				console.log(error);
				await reaction.message.channel.send('Something went wrong with storing a tempRole.');
			}			
		}
	});
});

// run
client.login(token);