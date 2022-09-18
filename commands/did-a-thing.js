const DiscordJS = require('discord.js')
const STRING = DiscordJS.Constants.ApplicationCommandOptionTypes.STRING;

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

const init = (interaction, client) => {
	// console.log(interaction.member);
	const thingName =  interaction.options.getString('thing');
	const thingCaption = interaction.options.getString('caption');
	const role = things.find(({ name }) => name === thingName).role;
	let reply = 'The role I should give you is: ' + role;
	console.log(thingCaption);
	if (thingCaption && thingCaption.length > 0) {
		reply += '\nYour description: ' + thingCaption;
	}
	interaction.reply(reply);
	// await interaction.reply(`Your username: ${interaction.user.username}\nYour ID: ${interaction.user.id}`);
}

module.exports = { 
	init, 
	description, 
	options ,
};
