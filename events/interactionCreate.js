const handler = async(interaction) => {
	if (!interaction.isCommand()) {
		return;
	}

	const { commandName } = interaction;
	const selectedCommand = commands.find(c => commandName === c.name);
	selectedCommand.init(interaction, client, sequelize);
};

module.exports = {
    handler,
}