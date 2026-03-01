const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getServerSettings } = require('../data/serverSettings');

// Track in-progress channel creations to prevent race conditions
const pendingCreations = new Set();

async function createMatchRoom(guild, match, tournament) {
  // Deduplicate: if this match already has a channel or is being created, skip
  const creationKey = `match:${guild.id}:${match.id}`;
  if (match.channelId || pendingCreations.has(creationKey)) {
    if (match.channelId) {
      try {
        const existing = await guild.channels.fetch(match.channelId);
        if (existing) return existing;
      } catch {
        // Channel was deleted, recreate below
      }
    }
    // Another call is in progress — wait briefly then check if it finished
    if (pendingCreations.has(creationKey)) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (match.channelId) {
        try {
          return await guild.channels.fetch(match.channelId);
        } catch {
          // Fall through to recreate
        }
      }
    }
  }
  pendingCreations.add(creationKey);

  try {
    return await _createMatchRoom(guild, match, tournament);
  } finally {
    pendingCreations.delete(creationKey);
  }
}

async function _createMatchRoom(guild, match, tournament) {
  const isSolo = tournament.settings.teamSize === 1;

  // Generate channel name
  const p1Name = isSolo
    ? match.participant1?.username?.substring(0, 12) || 'TBD'
    : match.participant1?.name?.substring(0, 12) || 'TBD';
  const p2Name = isSolo
    ? match.participant2?.username?.substring(0, 12) || 'TBD'
    : match.participant2?.name?.substring(0, 12) || 'TBD';

  const channelName = `match-${match.matchNumber}-${sanitize(p1Name)}-vs-${sanitize(p2Name)}`;

  // Check if a channel with this name already exists in the guild
  const existingChannel = guild.channels.cache.find(
    c => c.name === channelName && c.type === ChannelType.GuildText
  );
  if (existingChannel) {
    return existingChannel;
  }

  // Find or create match rooms category
  let category = await findOrCreateMatchCategory(guild, tournament);

  // Permission overwrites
  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      // Bot needs access to its own channels
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  // Add tournament admin roles
  const settings = await getServerSettings(guild.id);
  for (const roleId of settings.tournamentAdminRoles || []) {
    permissionOverwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  // Add participants
  if (isSolo) {
    if (match.participant1 && match.participant1.id && !match.participant1.id.startsWith('fake_')) {
      permissionOverwrites.push({
        id: match.participant1.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      });
    }
    if (match.participant2 && match.participant2.id && !match.participant2.id.startsWith('fake_')) {
      permissionOverwrites.push({
        id: match.participant2.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      });
    }
  } else {
    // Team tournament - add all team members
    if (match.participant1?.members) {
      for (const member of match.participant1.members) {
        if (member.id && !member.id.startsWith('fake_')) {
          permissionOverwrites.push({
            id: member.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          });
        }
      }
    }
    if (match.participant2?.members) {
      for (const member of match.participant2.members) {
        if (member.id && !member.id.startsWith('fake_')) {
          permissionOverwrites.push({
            id: member.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          });
        }
      }
    }
  }

  // Create the channel
  const channelOptions = {
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites,
  };

  // Only set parent if we have a valid category with space
  if (category) {
    channelOptions.parent = category.id;
  }

  let channel;
  try {
    channel = await guild.channels.create(channelOptions);
  } catch (error) {
    // If category is full, try without category
    if (error.code === 50035 && error.message.includes('MAX_CHANNELS')) {
      console.log('Category full, creating channel without category');
      delete channelOptions.parent;
      channel = await guild.channels.create(channelOptions);
    } else {
      throw error;
    }
  }

  // Grant ManageRoles after creation (can't include in initial overwrites)
  try {
    await channel.permissionOverwrites.edit(guild.client.user.id, {
      ManageRoles: true,
    });
  } catch {}

  // Create match embed
  const embed = createMatchEmbed(match, tournament);

  // Create report buttons
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`matchWin:${tournament.id}:${match.id}:1`)
      .setLabel(`👑 ${p1Name} Wins`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`matchWin:${tournament.id}:${match.id}:2`)
      .setLabel(`👑 ${p2Name} Wins`)
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [buttons] });

  return channel;
}

async function findOrCreateMatchCategory(guild, tournament) {
  const settings = await getServerSettings(guild.id);

  // Check if admin set a specific category
  if (settings.matchRoomCategory) {
    try {
      const category = await guild.channels.fetch(settings.matchRoomCategory);
      if (category && category.type === ChannelType.GuildCategory) {
        // Check if it has space (Discord limit is 50 channels per category)
        const channelsInCategory = guild.channels.cache.filter(c => c.parentId === category.id);
        if (channelsInCategory.size < 50) {
          return category;
        }
      }
    } catch (error) {
      // Category doesn't exist anymore
    }
  }

  // Look for existing category for this game with space
  const categoryName = `${tournament.game.shortName} Matches`;
  const existingCategories = guild.channels.cache.filter(
    c => c.type === ChannelType.GuildCategory &&
    (c.name === categoryName || c.name.startsWith(categoryName))
  );

  for (const [, category] of existingCategories) {
    const channelsInCategory = guild.channels.cache.filter(c => c.parentId === category.id);
    if (channelsInCategory.size < 50) {
      return category;
    }
  }

  // Create new category
  try {
    // Find a unique name if needed
    let newCategoryName = categoryName;
    let counter = 1;
    while (guild.channels.cache.find(c => c.name === newCategoryName && c.type === ChannelType.GuildCategory)) {
      counter++;
      newCategoryName = `${categoryName} ${counter}`;
    }

    const category = await guild.channels.create({
      name: newCategoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
    });

    // Grant ManageRoles after creation
    try {
      await category.permissionOverwrites.edit(guild.client.user.id, {
        ManageRoles: true,
      });
    } catch {}

    console.log(`Created new match category: ${newCategoryName}`);
    return category;
  } catch (error) {
    console.error('Error creating match category:', error);
    return null; // Will create channels without category
  }
}

function createMatchEmbed(match, tournament) {
  const isSolo = tournament.settings.teamSize === 1;

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ ${match.roundName} — Match ${match.matchNumber}`)
    .setColor(0x3498db);

  let description = '';

  if (isSolo) {
    description += `**${match.participant1?.username || 'TBD'}** vs **${match.participant2?.username || 'TBD'}**\n\n`;
  } else {
    const team1 = match.participant1;
    const team2 = match.participant2;

    description += `**${team1?.name || 'TBD'}** vs **${team2?.name || 'TBD'}**\n\n`;

    if (team1?.members) {
      description += `👥 **${team1.name}:**\n`;
      description += team1.members.map(m => {
        const isCaptain = m.id && m.id === team1.captain?.id;
        const pendingTag = m.pending ? ' (pending)' : '';
        return `   ${isCaptain ? '(C) ' : ''}${m.username}${pendingTag}`;
      }).join('\n');
      description += '\n\n';
    }

    if (team2?.members) {
      description += `👥 **${team2.name}:**\n`;
      description += team2.members.map(m => {
        const isCaptain = m.id && m.id === team2.captain?.id;
        const pendingTag = m.pending ? ' (pending)' : '';
        return `   ${isCaptain ? '(C) ' : ''}${m.username}${pendingTag}`;
      }).join('\n');
      description += '\n\n';
    }
  }

  description += `📋 **Match Info:**\n`;
  description += `• Best of ${tournament.settings.bestOf}\n`;

  if (tournament.settings.mapPool && tournament.settings.mapPool.length > 0) {
    description += `• Map Pick: ${tournament.settings.mapPickProcess || 'Admin pick'}\n`;
    description += `• Available Maps: ${tournament.settings.mapPool.join(', ')}\n`;
  }

  description += '\n';

  if (tournament.settings.ruleset) {
    description += `📜 **Rules:**\n${tournament.settings.ruleset}\n\n`;
  }

  description += 'Good luck! 🎮';

  embed.setDescription(description);

  return embed;
}

function sanitize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 12);
}

async function deleteMatchRoom(guild, channelId) {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (channel) {
      await channel.delete();
    }
  } catch (error) {
    console.error('Error deleting match room:', error);
  }
}

/**
 * Create a lobby room for a Battle Royale group (one room for all games)
 * @param {Guild} guild - Discord guild
 * @param {Object} group - Group object containing teams and games
 * @param {Object} tournament - Tournament object
 * @returns {TextChannel} Created channel
 */
async function createBRGroupRoom(guild, group, tournament) {
  // Deduplicate: if this group already has a channel or is being created, skip
  const creationKey = `br:${guild.id}:${group.id}`;
  if (group.channelId || pendingCreations.has(creationKey)) {
    if (group.channelId) {
      try {
        const existing = await guild.channels.fetch(group.channelId);
        if (existing) return existing;
      } catch {
        // Channel was deleted, recreate below
      }
    }
    if (pendingCreations.has(creationKey)) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (group.channelId) {
        try {
          return await guild.channels.fetch(group.channelId);
        } catch {
          // Fall through to recreate
        }
      }
    }
  }
  pendingCreations.add(creationKey);

  try {
    return await _createBRGroupRoom(guild, group, tournament);
  } finally {
    pendingCreations.delete(creationKey);
  }
}

async function _createBRGroupRoom(guild, group, tournament) {
  const isSolo = tournament.settings.teamSize === 1;
  const groupName = group.name.replace(/\s+/g, '-').toLowerCase();

  const channelName = `br-${groupName}`;

  // Check if a channel with this name already exists
  const existingChannel = guild.channels.cache.find(
    c => c.name === channelName && c.type === ChannelType.GuildText
  );
  if (existingChannel) {
    return existingChannel;
  }

  // Find or create match rooms category
  let category = await findOrCreateMatchCategory(guild, tournament);

  // Permission overwrites
  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  // Add tournament admin roles
  const brSettings = await getServerSettings(guild.id);
  for (const roleId of brSettings.tournamentAdminRoles || []) {
    permissionOverwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  // Add all teams/participants in the group
  for (const team of group.teams) {
    if (isSolo) {
      if (team.id && !team.id.startsWith('fake_')) {
        permissionOverwrites.push({
          id: team.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        });
      }
    } else {
      // Team tournament - add all team members
      if (team.members) {
        for (const member of team.members) {
          if (member.id && !member.id.startsWith('fake_')) {
            permissionOverwrites.push({
              id: member.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
            });
          }
        }
      }
    }
  }

  // Create the channel
  const channelOptions = {
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites,
  };

  if (category) {
    channelOptions.parent = category.id;
  }

  let channel;
  try {
    channel = await guild.channels.create(channelOptions);
  } catch (error) {
    if (error.code === 50035 && error.message.includes('MAX_CHANNELS')) {
      console.log('Category full, creating BR group channel without category');
      delete channelOptions.parent;
      channel = await guild.channels.create(channelOptions);
    } else {
      throw error;
    }
  }

  // Grant ManageRoles after creation (can't include in initial overwrites)
  try {
    await channel.permissionOverwrites.edit(guild.client.user.id, {
      ManageRoles: true,
    });
  } catch {}

  // Create group info embed
  const embed = createBRGroupEmbed(group, tournament);
  await channel.send({ embeds: [embed] });

  // Send team list with lobby numbers
  const teamListEmbed = createBRTeamListEmbed(group, tournament);
  await channel.send({ embeds: [teamListEmbed] });

  return channel;
}

/**
 * Create embed for BR group info
 */
function createBRGroupEmbed(group, tournament) {
  const isFinale = group.id === 'finals' || group.name === 'Grand Finals';
  const gamesCount = group.games?.length || tournament.settings.gamesPerStage || 3;

  const embed = new EmbedBuilder()
    .setTitle(`🎮 ${group.name}`)
    .setColor(isFinale ? 0xffd700 : 0xff6b35);

  let description = `**${tournament.title}**\n\n`;
  description += `📋 **Lobby Info:**\n`;
  description += `• Stage: ${isFinale ? 'Grand Finals' : 'Group Stage'}\n`;
  description += `• Games to play: ${gamesCount}\n`;
  description += `• Teams in lobby: ${group.teams.length}\n\n`;

  if (tournament.settings.mapPool && tournament.settings.mapPool.length > 0) {
    description += `🗺️ **Map Pool:**\n${tournament.settings.mapPool.join(', ')}\n\n`;
  }

  if (tournament.settings.ruleset) {
    description += `📜 **Rules:**\n${tournament.settings.ruleset}\n\n`;
  }

  description += `━━━━━━━━━━━━━━━━━━━━\n`;
  description += `**Reporting Results:**\n`;
  description += `After each game, admin reports with:\n`;
  description += `\`/tournament br-report group:${group.name} game_number:X placements:1,5,3,...\`\n\n`;
  description += `Good luck! 🎮`;

  embed.setDescription(description);

  return embed;
}

/**
 * Create embed listing all teams in a BR game with lobby numbers
 */
function createBRTeamListEmbed(group, tournament) {
  const isSolo = tournament.settings.teamSize === 1;

  const embed = new EmbedBuilder()
    .setTitle(`👥 Lobby Numbers — ${group.name}`)
    .setColor(0xff6b35);

  let description = '**Use these numbers when reporting results:**\n\n';

  if (isSolo) {
    group.teams.forEach((player, i) => {
      const num = String(i + 1).padStart(2, ' ');
      description += `\`${num}\` → ${player.username}`;
      if (player.gameNick) description += ` *(${player.gameNick})*`;
      description += '\n';
    });
  } else {
    group.teams.forEach((team, i) => {
      const num = String(i + 1).padStart(2, ' ');
      description += `\`${num}\` → **${team.name}**`;
      if (team.qualifiedFrom) description += ` *(${team.qualifiedFrom})*`;
      description += '\n';
    });
  }

  description += '\n━━━━━━━━━━━━━━━━━━━━\n';
  description += '**To report results:**\n';
  description += '`/tournament br-report placements:1,5,3,2,...`\n';
  description += '*(Enter lobby numbers in finish order)*\n\n';
  description += '💡 You can report just top placements.\n';
  description += 'Unreported teams share last place points.';

  // Truncate if needed
  if (description.length > 4000) {
    description = description.substring(0, 3900) + '\n...and more teams';
  }

  embed.setDescription(description);

  return embed;
}

function collectTournamentChannels(bracket) {
  const channelIds = [];
  if (!bracket) return channelIds;

  if (bracket.type === 'battle_royale') {
    // Collect group channel IDs
    if (bracket.groups) {
      for (const group of bracket.groups) {
        if (group.channelId) channelIds.push(group.channelId);
      }
    }
    // Collect finals channel ID
    if (bracket.finals?.channelId) {
      channelIds.push(bracket.finals.channelId);
    }
  } else if (bracket.type === 'double_elimination') {
    const allRounds = [
      ...(bracket.winnersRounds || []),
      ...(bracket.losersRounds || []),
      ...(bracket.grandFinalsRounds || []),
    ];
    for (const round of allRounds) {
      for (const match of round.matches) {
        if (match.channelId) channelIds.push(match.channelId);
      }
    }
  } else {
    // single_elimination, swiss, round_robin
    if (bracket.rounds) {
      for (const round of bracket.rounds) {
        for (const match of round.matches) {
          if (match.channelId) channelIds.push(match.channelId);
        }
      }
    }
  }

  return channelIds;
}

async function findOrCreateArchiveCategory(guild) {
  const archiveName = 'Archived Matches';

  // Look for existing archive category with space
  const existing = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === archiveName
  );

  if (existing) {
    const channelsInCategory = guild.channels.cache.filter(c => c.parentId === existing.id);
    if (channelsInCategory.size < 50) {
      return existing;
    }
  }

  // Create new archive category (with counter if needed)
  let name = archiveName;
  let counter = 1;
  while (guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory)) {
    counter++;
    name = `${archiveName} ${counter}`;
  }

  try {
    const category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
    });

    // Grant ManageRoles after creation
    try {
      await category.permissionOverwrites.edit(guild.client.user.id, {
        ManageRoles: true,
      });
    } catch {}

    console.log(`Created archive category: ${name}`);
    return category;
  } catch (error) {
    console.error('Error creating archive category:', error);
    return null;
  }
}

async function archiveMatchRoom(guild, channelId, archiveCategory) {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel) return false;

    // Lock channel - deny SendMessages for everyone
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
      SendMessages: false,
    });

    // Move to archive category
    if (archiveCategory) {
      await channel.setParent(archiveCategory.id, { lockPermissions: false });
    }

    return true;
  } catch (error) {
    console.error(`Error archiving channel ${channelId}:`, error);
    return false;
  }
}

async function bulkCleanupChannels(guild, channelIds, mode) {
  let success = 0;
  let archiveCategory = null;

  if (mode === 'archive') {
    archiveCategory = await findOrCreateArchiveCategory(guild);
  }

  for (const channelId of channelIds) {
    try {
      if (mode === 'delete') {
        const channel = await guild.channels.fetch(channelId);
        if (channel) {
          await channel.delete();
          success++;
        }
      } else if (mode === 'archive') {
        const archived = await archiveMatchRoom(guild, channelId, archiveCategory);
        if (archived) {
          // Check if archive category is full, get a new one
          if (archiveCategory) {
            const count = guild.channels.cache.filter(c => c.parentId === archiveCategory.id).size;
            if (count >= 50) {
              archiveCategory = await findOrCreateArchiveCategory(guild);
            }
          }
          success++;
        }
      }
    } catch (error) {
      console.error(`Error cleaning up channel ${channelId}:`, error);
    }
  }

  return success;
}

function clearBracketChannelIds(bracket) {
  if (!bracket) return;

  if (bracket.type === 'battle_royale') {
    if (bracket.groups) {
      for (const group of bracket.groups) {
        delete group.channelId;
      }
    }
    if (bracket.finals) {
      delete bracket.finals.channelId;
    }
  } else if (bracket.type === 'double_elimination') {
    const allRounds = [
      ...(bracket.winnersRounds || []),
      ...(bracket.losersRounds || []),
      ...(bracket.grandFinalsRounds || []),
    ];
    for (const round of allRounds) {
      for (const match of round.matches) {
        delete match.channelId;
      }
    }
  } else {
    if (bracket.rounds) {
      for (const round of bracket.rounds) {
        for (const match of round.matches) {
          delete match.channelId;
        }
      }
    }
  }
}

module.exports = {
  createMatchRoom,
  createMatchEmbed,
  deleteMatchRoom,
  createBRGroupRoom,
  createBRGroupEmbed,
  createBRTeamListEmbed,
  collectTournamentChannels,
  findOrCreateArchiveCategory,
  archiveMatchRoom,
  bulkCleanupChannels,
  clearBracketChannelIds,
};
