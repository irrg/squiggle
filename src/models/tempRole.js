import { DataTypes } from "sequelize";

const TempRoleModel = (sequelize) => {
  const TempRole = sequelize.define(
    "TempRole",
    {
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
      messageId: DataTypes.STRING,
      expirationTime: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      maxReactionCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["guildId", "memberId", "roleId", "messageId"],
        },
      ],
    },
  );

  return TempRole;
};

export default TempRoleModel;
