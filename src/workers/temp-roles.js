import { Op } from "sequelize";
import sendDebugMessage from "../utils/sendDebugMessage.js";

const run = async (client, sequelize) => {
  const TempRole = (
    await import(`${global.appRoot}/src/models/tempRole.js`)
  ).default(sequelize);
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
        },
      },
    });

    tempRoles.forEach(async (tempRole) => {
      const guild = client.guilds.cache.get(tempRole.guildId);
      const role = guild.roles.cache.get(tempRole.roleId);
      const member = await guild.members.fetch(tempRole.memberId);
      const memberName = member.nickname || member.user.username;

      // Check if there is another row that expires after the current row
      const laterTempRole = await TempRole.findOne({
        where: {
          guildId: tempRole.guildId,
          memberId: tempRole.memberId,
          roleId: tempRole.roleId,
          expirationTime: {
            [Op.gt]: tempRole.expirationTime,
          },
        },
      });

      if (laterTempRole) {
        // If there is a later expiration, only delete the current row
        const tempRoleDeletion = await TempRole.destroy({
          where: { id: tempRole.id },
        });
        if (tempRoleDeletion > 0) {
          const deletionMessage = `removed tempRole table row ${tempRole.id}`;
          console.log(deletionMessage);
          await sendDebugMessage(client, deletionMessage);
        } else {
          const errorMessage = "deletion went wrong";
          console.log(errorMessage);
          await sendDebugMessage(client, errorMessage);
        }
      } else {
        // If there is no later expiration, remove the role and delete the row
        const message = `Removing role ${role.name} from member ${memberName}`;
        console.log(message);
        await sendDebugMessage(client, message);
        member.roles.remove(role);

        // Remove all rows for this member, role, guild, and message combination
        const tempRoleDeletions = await TempRole.destroy({
          where: {
            guildId: tempRole.guildId,
            memberId: tempRole.memberId,
            roleId: tempRole.roleId,
            messageId: tempRole.messageId,
          },
        });
        if (tempRoleDeletions > 0) {
          const deletionMessage = `removed ${tempRoleDeletions} tempRole table row(s) for member ${memberName}, role ${role.name}, and message ${tempRole.messageId}`;
          console.log(deletionMessage);
          await sendDebugMessage(client, deletionMessage);
        } else {
          const errorMessage = "deletion went wrong";
          console.log(errorMessage);
          await sendDebugMessage(client, errorMessage);
        }
      }
    });
  } catch (error) {
    const errorMessage = "did-a-thing worker error";
    console.log(errorMessage);
    console.log(error);
    await sendDebugMessage(client, `${errorMessage}: ${error.message}`);
  }
};

const interval = 10000;

export { run, interval };
