// DiscordJS
const { token } = require('./config/discord.json');
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

const colors = require('colors');
const fs = require('fs');
const path = require('path');
const reactionRoles = require('./config/reaction-roles.json');

let workerTmp = [];
let commandTmp = [];
let commands = [];

global.__appRoot = path.resolve(__dirname);

// Sequelize
const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('database', 'user', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: false,
	storage: 'database.sqlite',
});
const TempRole = require(`${__appRoot}/models/tempRole`)(sequelize);

client.once('ready', async () => {
	await TempRole.sync(/* { force: true } */);

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

client.on('messageReactionAdd', async (reaction, user) => {
	reactionRoles.forEach(async (reactionRole) => {
		if (
			reaction.emoji.name === reactionRole.emojiName && 
			reaction.count === reactionRole.threshold
		) {
			const { guild } = reaction.message;
			const role = guild.roles.cache.find((role) => role.name === reactionRole.roleName); 
			const member = guild.members.cache.find(member => member.id === reaction.message.author.id); 
			const expirationDateTime = new Date(new Date().getTime() + (24 * 60 * 60 * 1000));

			try {
				const tempRole = await TempRole.create({
					guildId: guild.id,
					memberId: member.id,
					memberName: member.nickname,
					roleId: role.id,
					roleName: role.name,
					expirationTime: expirationDateTime,
				});
		
				member.roles.add(role);
		
				const embed = new MessageEmbed()
					.setTitle(`${member.nickname} was determined to be ${reactionRole.roleName.replace(/People who are /g, '')}`)
					.setColor(reactionRole.color)
					.setAuthor({ 
						name: member.nickname, 
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