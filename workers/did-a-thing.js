const { QueryTypes, Op } = require('sequelize');

const run = async (client, sequelize) => {
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
					const user = await client.users.fetch(tempRole.roleId);
					console.log(user);
					// member.roles.remove(role);
				});
	}
	catch (error) {
		console.log('did-a-thing worker error');
		console.log(error);
	}
}

module.exports = { 
	run, 
    interval: 10000,
};
