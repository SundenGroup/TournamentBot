const { Events } = require('discord.js');

module.exports = {
  name: Events.GuildCreate,
  execute(guild) {
    console.log(`Joined new guild: ${guild.name} (${guild.id})`);
  },
};
