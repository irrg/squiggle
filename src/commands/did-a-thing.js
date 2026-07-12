import { ApplicationCommandOptionType, EmbedBuilder } from "discord.js";
import config from "../../config/config.json" with { type: "json" };

const { String } = ApplicationCommandOptionType;

const description = "Share that you did a thing!";
const things = config.commands.didAThing;
const options = [
  {
    name: "thing",
    description: "Thing",
    required: true,
    type: String,
    choices: things.map(({ name }) => ({
      name,
      value: name,
    })),
  },
  {
    name: "caption",
    description: "Describe what you did (optional)",
    type: String,
    required: true,
  },
];

const init = async (interaction, client, db) => {
  const { member } = interaction;
  const thing = interaction.options.getString("thing");
  const caption = interaction.options.getString("caption");
  const thingObject = things.find(({ name }) => name === thing);

  if (!thingObject) {
    await interaction.reply({ content: "Unknown thing.", ephemeral: true });
    return;
  }

  const role = member.guild.roles.cache.find(
    ({ name }) => name === thingObject.role,
  );

  if (!role) {
    await interaction.reply({
      content: `Role "${thingObject.role}" not found.`,
      ephemeral: true,
    });
    return;
  }

  const expirationDateTime = new Date(
    new Date().getTime() + 24 * 60 * 60 * 1000,
  );

  await interaction.deferReply();

  const memberName = member.nickname || member.user.username;

  try {
    await member.roles.add(role);

    const embed = new EmbedBuilder()
      .setTitle(`${memberName} ${thingObject.role.replace(/People who /g, "")}`)
      .setColor(thingObject.color)
      .setAuthor({
        name: memberName,
        iconURL: member.displayAvatarURL(),
      })
      .setDescription(caption)
      .setTimestamp();

    const reply = await interaction.editReply({ embeds: [embed] });
    await reply.react("🙌");

    try {
      db.create({
        guildId: member.guild.id,
        memberId: member.id,
        memberName,
        roleId: role.id,
        roleName: role.name,
        messageId: reply.id,
        expirationTime: expirationDateTime,
        maxReactionCount: 1,
      });
    } catch (dbError) {
      await member.roles.remove(role).catch(() => {});
      await interaction.followUp({
        content:
          "Something went wrong saving your progress. Role has been removed.",
        ephemeral: true,
      });
      console.error(dbError);
    }

    return reply;
  } catch (error) {
    console.log(error);
    return interaction.editReply(
      "Something went wrong with storing a tempRole.",
    );
  }
};

const commandName = "did-a-thing";

export { init, description, options, commandName };
