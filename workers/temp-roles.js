const { QueryTypes, Op } = require('sequelize');

const worker = async (client, sequelize) => {
	const TempRole = require(`${__appRoot}/models/tempRole`)(sequelize);
    await TempRole.sync();

	try {
        // find all old jobs
        // remove all the roles
        // delete the jobs
        const tempRoles = await TempRole.findAll({
					raw: true,
					where: {
						expirationTime: {
							[Op.lt]: new Date(),
						}
					}
        });

				tempRoles.forEach(async (tempRole) => {
					const guild = client.guilds.cache.get(tempRole.guildId);
					const role = guild.roles.cache.get(tempRole.roleId);
					const member = await guild.members.fetch(tempRole.memberId);
					console.log(`Removing role ${role.name} from member ${member.nickname}`);
					member.roles.remove(role);
					const tempRoleDeletion = await TempRole.destroy({ where: { id: tempRole.id } });
					if (tempRoleDeletion > 0) {
						console.log(`removed tempRole table row ${tempRole.id}`);
					} else {
						console.log('deletion went wrong');
					}
				});
	}
	catch (error) {
		console.log('did-a-thing worker error');
		console.log(error);
	}
}

module.exports = { 
	name: 'temp-roles',
	worker, 
	interval: 10000,
};
