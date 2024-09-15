const { REST } = require('@discordjs/rest');
const { Client, Intents, MessageEmbed } = require('discord.js');
const { Routes } = require('discord-api-types/v9');
const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const config = require('../config.json');
require('colors');

// Add this helper function at the top of the file
const canPostInChannel = (channelName) => {
  if (config.whitelist && config.whitelist.length > 0) {
    return config.whitelist.includes(channelName);
  }
  if (config.blacklist && config.blacklist.length > 0) {
    return !config.blacklist.includes(channelName);
  }
  return true; // If neither whitelist nor blacklist is present, allow posting
};

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
  ],
});

const rest = new REST({ version: '9' }).setToken(config.discord.token);

const workerTmp = [];
const commandTmp = [];
let commands = [];

global.appRoot = path.resolve(__dirname);

const sequelize = new Sequelize(
  config.database.name,
  config.database.user,
  config.database.password,
  {
    host: config.database.host,
    dialect: config.database.dialect,
    logging: false,
    storage: config.database.storage,
  },
);

const TempRole = require(`${global.appRoot}/models/tempRole`)(sequelize);

client.once('ready', async () => {
  await TempRole.sync(/* { force: true } */);

  console.log(`😃${config.namePrefix}Squiggle`.red.bold + ' is online!'.red);

  const commandsFiles = fs.readdirSync(path.join(__dirname, './commands'));

  commandsFiles.forEach((file, i) => {
    commandTmp[i] = require(`./commands/${file}`);
    commands = [
      ...commands,
      {
        name: `${config.commandPrefix || ''}${commandTmp[i].commandName || file.split('.')[0]}`,
        description: commandTmp[i].description,
        init: commandTmp[i].init,
        options: commandTmp[i].options,
      },
    ];
  });

  const workersFiles = fs.readdirSync(path.join(__dirname, './workers'));

  workersFiles.forEach(async (file, i) => {
    workerTmp[i] = require(`./workers/${file}`);
    setInterval(() => { workerTmp[i].run(client, sequelize); }, workerTmp[i].interval);
  });

  if (workersFiles.length > 0) {
    console.log('✅ Workers registered!'.gray);
    workersFiles.forEach((file) => {
      console.log(`  - ${file}`.white);
    });
  }

  rest.put(
    Routes.applicationCommands(client.application.id),
    { body: commands },
  ).then(() => {
    console.log('✅ Commands registered!'.gray);
    commands.forEach((command) => {
      console.log(`  - /${command.name}: `.white + `${command.description}`.gray);
    });
  })
    .catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) {
    return;
  }

  const { commandName, channel } = interaction;

  if (canPostInChannel(channel.name)) {
    const selectedCommand = commands.find((c) => commandName === c.name);
    selectedCommand.init(interaction, client, sequelize);
  } else {
    await interaction.reply({ content: 'This bot is not allowed to post in this channel.', ephemeral: true });
  }
});

client.on('messageReactionAdd', async (reaction) => {
  const { channel } = reaction.message;

  if (!canPostInChannel(channel.name)) {
    return;
  }

  config.workers.reactionRoles.forEach(async (reactionRole) => {
    if (
      reaction.emoji.name === reactionRole.emojiName
      && reaction.count === reactionRole.threshold
    ) {
      try {
        const { guild } = reaction.message;
        const role = guild.roles.cache
          .find((findableRole) => findableRole.name === reactionRole.roleName);
        const member = guild.members.cache
          .find((findableMember) => findableMember.id === reaction.message.author.id);
        const memberName = member.nickname || member.user.username;
        const expirationTime = new Date(new Date().getTime() + (24 * 60 * 60 * 1000));

        await TempRole.create({
          guildId: guild.id,
          memberId: member.id,
          memberName,
          roleId: role.id,
          roleName: role.name,
          expirationTime,
        });

        member.roles.add(role);

        const embed = new MessageEmbed()
          .setTitle(`${memberName} was determined to be ${reactionRole.roleName.replace(/People who are /g, '')}`)
          .setColor(reactionRole.color)
          .setAuthor({
            name: memberName,
            iconURL: member.displayAvatarURL(),
          })
          .setTimestamp();

        await reaction.message.channel.send({ embeds: [embed] });
      } catch (error) {
        console.log(error);
        await reaction.message.channel.send('Something went wrong with storing a tempRole.');
      }
    }
  });
});

// run
client.login(config.discord.token);
