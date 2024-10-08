import { ApplicationCommandOptionType, EmbedBuilder } from "discord.js";
import config from "../../config/config.json" assert { type: "json" };

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

const init = async (interaction, client, sequelize) => {
  const { member } = interaction;
  const thing = interaction.options.getString("thing");
  const caption = interaction.options.getString("caption");
  const thingObject = things.find(({ name }) => name === thing);
  const role = member.guild.roles.cache.find(
    ({ name }) => name === thingObject.role
  );
  const expirationDateTime = new Date(
    new Date().getTime() + 24 * 60 * 60 * 1000
  );

  const TempRole = (
    await import(`${global.appRoot}/src/models/tempRole.js`)
  ).default(sequelize);

  await interaction.deferReply();
  await TempRole.sync();

  const memberName = member.nickname || member.user.username;

  try {
    await TempRole.create({
      guildId: member.guild.id,
      memberId: member.id,
      memberName,
      roleId: role.id,
      roleName: role.name,
      expirationTime: expirationDateTime,
    });

    member.roles.add(role);

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
    reply.react("🙌");

    return reply;
  } catch (error) {
    console.log(error);
    return interaction.reply("Something went wrong with storing a tempRole.");
  }
};

const commandName = "did-a-thing";

export { init, description, options, commandName };
