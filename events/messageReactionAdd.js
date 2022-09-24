const handler = async (reaction, user) => {
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

module.exports = {
    handler,
}