// Discord.js
const { Constants, MessageEmbed } = require('discord.js');
const STRING = Constants.ApplicationCommandOptionTypes.STRING;

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
	const thing =  interaction.options.getString('thing');
	const caption = interaction.options.getString('caption');
	const thingObject = things.find(({ name }) => name === thing);
	const role = member.guild.roles.cache.find(({ name }) => name === thingObject.role);
	const expirationDateTime = new Date(new Date().getTime() + (24 * 60 * 60 * 1000));

	const TempRole = require(`${__appRoot}/models/tempRole`)(sequelize);
    await TempRole.sync();

	try {
		const tempRole = await TempRole.create({
			userId: member.id,
			userName: member.nickname,
			roleId: role.id,
			roleName: role.name,
			expirationTime: expirationDateTime,
		});

		member.roles.add(role);

		// console.log(member);

		const embed = new MessageEmbed()
			.setTitle(`${member.nickname} ${thingObject.role.replace(/People who /g, '')}`)
			.setColor(thingObject.color)
			.setAuthor({ 
				name: member.nickname, 
				iconURL: member.displayAvatarURL(),
			})
			.setDescription(caption)
			.setTimestamp();
			
		return interaction.reply({ embeds: [embed] });
	}
	catch (error) {
		console.log(error);
		return interaction.reply('Something went wrong with storing a tempRole.');
	}
}

module.exports = { 
	init, 
	description, 
	options,
};
