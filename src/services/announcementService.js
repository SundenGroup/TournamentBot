const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getAnnouncementChannelId, getAnnouncementChannelName, setAnnouncementChannel } = require('../data/serverSettings');

async function getOrCreateAnnouncementChannel(guild) {
  const guildId = guild.id;

  // Check if we have a saved channel ID
  let channelId = await getAnnouncementChannelId(guildId);

  if (channelId) {
    // Try to fetch the channel
    try {
      const channel = await guild.channels.fetch(channelId);
      if (channel) {
        return channel;
      }
    } catch (error) {
      // Channel doesn't exist anymore, will create a new one
    }
  }

  // Look for existing channel by name
  const channelName = await getAnnouncementChannelName(guildId);
  let channel = guild.channels.cache.find(
    c => c.type === ChannelType.GuildText &&
    (c.name === channelName || c.name === 'tournament-announcements')
  );

  if (channel) {
    // Save the channel ID for future use
    await setAnnouncementChannel(guildId, channel.id, channel.name);
    return channel;
  }

  // Create the channel
  try {
    channel = await guild.channels.create({
      name: channelName || 'tournament-announcements',
      type: ChannelType.GuildText,
      topic: 'Tournament announcements and signups',
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages],
        },
        {
          id: guild.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageMessages,
          ],
        },
      ],
    });

    await setAnnouncementChannel(guildId, channel.id, channel.name);
    console.log(`Created announcement channel: ${channel.name} in ${guild.name}`);
    return channel;
  } catch (error) {
    console.error('Error creating announcement channel:', error);
    // Fall back to the channel where command was used
    return null;
  }
}

module.exports = {
  getOrCreateAnnouncementChannel,
};
