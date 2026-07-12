import { Op } from "sequelize";
import sendDebugMessage from "../utils/sendDebugMessage.js";

const run = async (client, sequelize) => {
  const TempRole = (
    await import(`${global.appRoot}/src/models/tempRole.js`)
  ).default(sequelize);

  try {
    const tempRoles = await TempRole.findAll({
      raw: true,
      where: {
        expirationTime: {
          [Op.lt]: new Date(),
        },
      },
    });

    await Promise.all(
      tempRoles.map(async (tempRole) => {
        const guild = client.guilds.cache.get(tempRole.guildId);
        if (!guild) {
          await TempRole.destroy({ where: { id: tempRole.id } });
          return;
        }
        const role = guild.roles.cache.get(tempRole.roleId);
        if (!role) {
          await TempRole.destroy({ where: { id: tempRole.id } });
          return;
        }
        const member = await guild.members.fetch(tempRole.memberId);
        const memberName = member.nickname || member.user.username;

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
          const deleted = await TempRole.destroy({
            where: { id: tempRole.id },
          });
          if (deleted > 0) {
            const msg = `removed tempRole table row ${tempRole.id}`;
            console.log(msg);
            await sendDebugMessage(client, msg);
          } else {
            const msg = "deletion went wrong";
            console.log(msg);
            await sendDebugMessage(client, msg);
          }
        } else {
          const msg = `Removing role ${role.name} from member ${memberName}`;
          console.log(msg);
          await sendDebugMessage(client, msg);
          await member.roles.remove(role);

          const deleted = await TempRole.destroy({
            where: {
              guildId: tempRole.guildId,
              memberId: tempRole.memberId,
              roleId: tempRole.roleId,
              messageId: tempRole.messageId,
            },
          });
          if (deleted > 0) {
            const msg2 = `removed ${deleted} tempRole table row(s) for member ${memberName}, role ${role.name}, and message ${tempRole.messageId}`;
            console.log(msg2);
            await sendDebugMessage(client, msg2);
          } else {
            const msg2 = "deletion went wrong";
            console.log(msg2);
            await sendDebugMessage(client, msg2);
          }
        }
      }),
    );
  } catch (error) {
    const msg = "did-a-thing worker error";
    console.log(msg);
    console.log(error);
    await sendDebugMessage(client, `${msg}: ${error.message}`);
  }
};

const interval = 10000;

export { run, interval };
