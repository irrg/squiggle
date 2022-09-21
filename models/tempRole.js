const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
	const TempRole = sequelize.define('TempRole', {
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true
		},
		userName: DataTypes.STRING,
		userId: DataTypes.INTEGER,
		roleName: DataTypes.STRING,
		roleId: DataTypes.INTEGER,
		expirationTime: {
			type: DataTypes.DATE,
			defaultValue: DataTypes.NOW,
		},
	});

	return TempRole;
};