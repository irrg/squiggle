import { PermissionFlagsBits, EmbedBuilder } from "discord.js";
import { run as runWorker } from "../workers/temp-roles.js";

export const commandName = "squiggle";
export const description = "Squiggle admin commands";

export const options = [
  {
    name: "list",
    type: 1,
    description: "List all active temp roles",
  },
  {
    name: "expire",
    type: 1,
    description: "Manually expire a member's temp role",
    options: [
      { name: "member", type: 6, description: "Member", required: true },
      { name: "role", type: 8, description: "Role", required: true },
    ],
  },
  {
    name: "grant",
    type: 1,
    description: "Manually grant a temp role (16-hour expiration)",
    options: [
      { name: "member", type: 6, description: "Member", required: true },
      { name: "role", type: 8, description: "Role", required: true },
    ],
  },
  {
    name: "run-worker",
    type: 1,
    description: "Trigger the temp-roles worker now",
  },
];

export async function init(interaction, client, db) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "Admin only.", ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "list") {
    const rows = await db.findAll();
    if (rows.length === 0) {
      return interaction.reply({ content: "No active temp roles.", ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setTitle("Active Temp Roles")
      .setColor("#5865F2")
      .addFields(
        rows.slice(0, 25).map((r) => ({
          name: `${r.memberName} — ${r.roleName}`,
          value: `Expires <t:${Math.floor(r.expirationTime.getTime() / 1000)}:R>`,
        })),
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === "expire") {
    const targetMember = interaction.options.getMember("member");
    const targetRole = interaction.options.getRole("role");
    const rows = await db.findAllByMemberRole(
      interaction.guildId,
      targetMember.id,
      targetRole.id,
    );
    if (rows.length === 0) {
      return interaction.reply({ content: "No active temp role found.", ephemeral: true });
    }
    await targetMember.roles.remove(targetRole);
    for (const row of rows) {
      await db.deleteById(row.id);
    }
    return interaction.reply({
      content: `Removed **${targetRole.name}** from **${targetMember.displayName}** (${rows.length} record${rows.length > 1 ? "s" : ""} deleted).`,
      ephemeral: true,
    });
  }

  if (sub === "grant") {
    const targetMember = interaction.options.getMember("member");
    const targetRole = interaction.options.getRole("role");
    const expirationTime = new Date(Date.now() + 16 * 60 * 60 * 1000);
    await targetMember.roles.add(targetRole);
    try {
      await db.create({
        guildId: interaction.guildId,
        memberId: targetMember.id,
        memberName: targetMember.nickname || targetMember.user.username,
        roleId: targetRole.id,
        roleName: targetRole.name,
        messageId: interaction.id,
        expirationTime,
        maxReactionCount: 0,
      });
    } catch (err) {
      if (err.name === "SequelizeUniqueConstraintError") {
        return interaction.reply({
          content: `**${targetMember.displayName}** already has an active **${targetRole.name}** record.`,
          ephemeral: true,
        });
      }
      await targetMember.roles.remove(targetRole).catch(() => {});
      throw err;
    }
    return interaction.reply({
      content: `Granted **${targetRole.name}** to **${targetMember.displayName}** for 16 hours.`,
      ephemeral: true,
    });
  }

  if (sub === "run-worker") {
    await interaction.deferReply({ ephemeral: true });
    await runWorker(client, db);
    return interaction.editReply({ content: "Worker ran." });
  }
}
