// Discord.js
const DiscordJS = require('discord.js');
const STRING = DiscordJS.Constants.ApplicationCommandOptionTypes.STRING;

const description = 'Share that you did a thing!';
const things = require(`${__appRoot}/did-a-thing.json`);
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

const init = async (interaction, client, sequelize) => {
	const { member } = interaction;
	const thingName =  interaction.options.getString('thing');
	const thingCaption = interaction.options.getString('caption');
	const roleName = things.find(({ name }) => name === thingName).role;
	const role = member.guild.roles.cache.find(({ name }) => name === roleName);
	const expirationDateTime = new Date(new Date().getTime() + (24 * 60 * 60 * 1000));

	const TempRole = require(`${__appRoot}/models/tempRole`)(sequelize);
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
