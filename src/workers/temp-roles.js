import sendDebugMessage from "../utils/sendDebugMessage.js";

const run = async (client, db) => {
  try {
    const tempRoles = await db.findExpired();

    await Promise.all(
      tempRoles.map(async (tempRole) => {
        const guild = client.guilds.cache.get(tempRole.guildId);
        if (!guild) {
          await db.markSpent(tempRole.id);
          return;
        }
        const role = guild.roles.cache.get(tempRole.roleId);
        if (!role) {
          await db.markSpent(tempRole.id);
          return;
        }
        let member;
        try {
          member = await guild.members.fetch(tempRole.memberId);
        } catch {
          // Member left the guild — mark spent or this retries every interval
          await db.markSpent(tempRole.id);
          await sendDebugMessage(
            client,
            `Member ${tempRole.memberName} (${tempRole.memberId}) not in guild; marked expired tempRole row ${tempRole.id} spent`,
          );
          return;
        }
        const memberName = member.nickname || member.user.username;

        const hasLater = await db.hasLaterExpiration(
          tempRole.guildId,
          tempRole.memberId,
          tempRole.roleId,
          tempRole.expirationTime.getTime(),
        );

        if (hasLater) {
          // Superseded by a later grant of the same role — role stays on
          // the member until that one expires. Mark spent (not delete) so
          // a later reaction on this same message can't look like a fresh
          // besting/worsting.
          const marked = await db.markSpent(tempRole.id);
          if (marked > 0) {
            const msg = `marked superseded tempRole row ${tempRole.id} spent`;
            console.log(msg);
            await sendDebugMessage(client, msg);
          } else {
            const msg = "marking spent went wrong";
            console.log(msg);
            await sendDebugMessage(client, msg);
          }
        } else {
          const msg = `Removing role ${role.name} from member ${memberName}`;
          console.log(msg);
          await sendDebugMessage(client, msg);
          await member.roles.remove(role);

          // Mark spent rather than delete, so a later reaction on the same
          // message can't be mistaken for a fresh besting/worsting.
          await db.markSpent(tempRole.id);
          const msg2 = `marked tempRole row ${tempRole.id} spent for member ${memberName}, role ${role.name}, and message ${tempRole.messageId}`;
          console.log(msg2);
          await sendDebugMessage(client, msg2);
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
