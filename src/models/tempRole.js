const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const TempRole = sequelize.define('TempRole', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    guildId: DataTypes.STRING,
    memberName: DataTypes.STRING,
    memberId: DataTypes.STRING,
    roleName: DataTypes.STRING,
    roleId: DataTypes.STRING,
    expirationTime: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  });

  return TempRole;
};
