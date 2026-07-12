import sendDebugMessage from "../utils/sendDebugMessage.js";

const run = async (client, db) => {
  try {
    const tempRoles = db.findExpired();

    await Promise.all(
      tempRoles.map(async (tempRole) => {
        const guild = client.guilds.cache.get(tempRole.guildId);
        if (!guild) {
          db.deleteById(tempRole.id);
          return;
        }
        const role = guild.roles.cache.get(tempRole.roleId);
        if (!role) {
          db.deleteById(tempRole.id);
          return;
        }
        const member = await guild.members.fetch(tempRole.memberId);
        const memberName = member.nickname || member.user.username;

        const hasLater = db.hasLaterExpiration(
          tempRole.guildId,
          tempRole.memberId,
          tempRole.roleId,
          tempRole.expirationTime.getTime(),
        );

        if (hasLater) {
          const deleted = db.deleteById(tempRole.id);
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

          const deleted = db.deleteByKey(
            tempRole.guildId,
            tempRole.memberId,
            tempRole.roleId,
            tempRole.messageId,
          );
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
