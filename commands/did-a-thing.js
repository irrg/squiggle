// Discord.js
const DiscordJS = require('discord.js');
const STRING = DiscordJS.Constants.ApplicationCommandOptionTypes.STRING;
// Sequelize
const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('database', 'user', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: false,
	storage: 'database.sqlite',
});
const TempRole = require(`${__appRoot}/models/tempRole`)(sequelize);
const description = 'Share that you did a thing!';
const things = [
	{ 
		name: 'adulting', 
		role: 'People who adulted THE BEJEEZUS out of life today',
	},
	{ 
		name:	'businessing',
		role: 'People who did a SRS BSNS today',
	},
	{
		name: 'coding',
		role: 'People who wrangled the EVERLIVIN\' BINARY out of some code today',
	},
	{ 
		name: 'editing',
		role: 'People who edited the EVERLOVIN SHIT out of some words today',
	},
	{ 
		name: 'exercising', 
		role: 'People who exercised the METRIC METERS out of THEIR BODIES today',
	},
	{ 
		name: 'GMing',
		role: 'People who ran THE GOSHDARN XP out of some players today',
	},
	{ 
		name: 'making pretty',
		role: 'People who made things SO FUCKIN PRETTY today',
	},
	{ 
		name: 'reading',
		role: 'People who READ LIKE WORDS WERE GOING OUT OF STYLE today',
	},
	{ 
		name: 'thinking',
		role: 'People who thought about shit REALLY HARD today',
	},
	{ 
		name: 'writing', 
		role: 'People who wrote THE ABSOLUTE SHIT out of some words today',
	},
];

const options = [
    {
        name: 'thing',
        description: 'Thing',
        required: true,
        type: STRING,
				choices: things.map(({ name }) => ({ 
						name, 
						value: name,
					}))
    },
		{
			name: 'caption',
			description: 'Describe what you did (optional)',
			type: STRING,
			required: true,
		}
];

const init = async (interaction, client) => {
	const { member } = interaction;
	const thingName =  interaction.options.getString('thing');
	const thingCaption = interaction.options.getString('caption');
	const roleName = things.find(({ name }) => name === thingName).role;
	const role = member.guild.roles.cache.find(({ name }) => name === roleName);
	const expirationDateTime = new Date(new Date().getTime() + (24 * 60 * 60 * 1000));

    await TempRole.sync();

	try {
		// equivalent to: INSERT INTO tags (name, description, username) values (?, ?, ?);
		const tempRole = await TempRole.create({
			userId: member.id,
			userName: member.nickname,
			roleId: role.id,
			roleName: role.name,
			expirationTime: expirationDateTime,
		});

		member.roles.add(role);
		
		return interaction.reply(`TempRole ${role.name} assigned to user ${member.nickname} for 24 hours.`);
	}
	catch (error) {
		if (error.name === 'SequelizeUniqueConstraintError') {
			return interaction.reply('That tag already exists.');
		}

		return interaction.reply('Something went wrong with storing a tempRole.');
	}
}

module.exports = { 
	init, 
	description, 
	options,
};
