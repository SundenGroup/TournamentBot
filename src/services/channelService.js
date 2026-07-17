const { ChannelType, PermissionFlagsBits, OverwriteType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getServerSettings } = require('../data/serverSettings');

// Track in-progress channel creations to prevent race conditions
const pendingCreations = new Set();

// ============================================================================
// Guild channel capacity (Discord caps servers at 500 channels — categories
// included, threads excluded). docs/CHANNEL-CAPACITY-PLAN.md Phase 1.
// ============================================================================

const GUILD_CHANNEL_CAP = 500;
const CAPACITY_MARGIN = 5; // leave headroom for logs/announcement channels

function getChannelCapacity(guild) {
  const used = guild.channels.cache.size;
  return {
    used,
    cap: GUILD_CHANNEL_CAP,
    available: Math.max(0, GUILD_CHANNEL_CAP - CAPACITY_MARGIN - used),
  };
}

/** Discord error 30013 = maximum guild channels reached. */
function isCapacityError(error) {
  return error?.code === 30013 || error?.capacity === true;
}

function capacityError(guild) {
  const { used, cap } = getChannelCapacity(guild);
  const err = new Error(
    `This server has hit Discord's ${cap}-channel limit (${used} in use) — no more rooms can be created. ` +
    'Free slots with `/admin cleanup mode:archive` (saves history, deletes rooms), then run `/tournament create-rooms`.'
  );
  err.capacity = true;
  return err;
}

const PLAYER_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
];

/**
 * Create a private channel, adding each player as an explicitly-typed Member
 * overwrite. If the bulk create fails (most commonly because a participant
 * isn't in the bot's user cache — which makes discord.js unable to infer the
 * overwrite type and throw before any API call), fall back to creating the
 * channel with the base overwrites only, then grant each player access
 * individually so one bad/unresolvable member can't sink the whole room.
 */
async function createPrivateChannel(guild, { name, parentId, baseOverwrites, memberIds }) {
  const memberOverwrites = memberIds.map(id => ({
    id, type: OverwriteType.Member, allow: PLAYER_ALLOW,
  }));
  const options = { name, type: ChannelType.GuildText, permissionOverwrites: [...baseOverwrites, ...memberOverwrites] };
  if (parentId) options.parent = parentId;

  try {
    return await guild.channels.create(options);
  } catch (error) {
    // Server-wide 500-channel cap: nothing to retry — surface a typed error
    // so callers stop the creation loop and inform admins once.
    if (isCapacityError(error)) throw capacityError(guild);

    const noParentRetry = error.code === 50035 && /MAX_CHANNELS/.test(error.message || '');
    if (noParentRetry) {
      delete options.parent;
      try { return await guild.channels.create(options); } catch (retryErr) {
        if (isCapacityError(retryErr)) throw capacityError(guild);
        /* fall through */
      }
    }

    // Resilient fallback: base channel first, then members one at a time.
    console.error(`createPrivateChannel bulk create failed for "${name}", falling back to per-member:`, error.message);
    let channel;
    try {
      channel = await guild.channels.create({
        name, type: ChannelType.GuildText, parent: parentId || undefined, permissionOverwrites: baseOverwrites,
      });
    } catch (fallbackErr) {
      if (isCapacityError(fallbackErr)) throw capacityError(guild);
      throw fallbackErr;
    }
    for (const id of memberIds) {
      try {
        await channel.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { type: OverwriteType.Member });
      } catch (memberErr) {
        console.error(`  could not grant ${id} access to ${name}:`, memberErr.message);
      }
    }
    return channel;
  }
}

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

  // Base permission overwrites (explicitly typed so discord.js never has to
  // resolve ids from cache — uncached team members used to make the whole
  // create throw before any API call).
  const baseOverwrites = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: guild.client.user.id,
      type: OverwriteType.Member,
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
    baseOverwrites.push({ id: roleId, type: OverwriteType.Role, allow: PLAYER_ALLOW });
  }

  // Collect the player member ids for this match (skip fakes / unresolved)
  const memberIds = [];
  const sides = isSolo ? [match.participant1, match.participant2] : null;
  if (isSolo) {
    for (const p of sides) {
      if (p?.id && !String(p.id).startsWith('fake_')) memberIds.push(p.id);
    }
  } else {
    for (const team of [match.participant1, match.participant2]) {
      for (const member of team?.members || []) {
        if (member.id && !String(member.id).startsWith('fake_')) memberIds.push(member.id);
      }
    }
  }

  const channel = await createPrivateChannel(guild, {
    name: channelName,
    parentId: category ? category.id : null,
    baseOverwrites,
    memberIds,
  });

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

  // Ping the players so they know where their match is played
  const content = memberIds.length
    ? `⚔️ ${memberIds.map(id => `<@${id}>`).join(' ')} — your match is ready, play it out here!`
    : undefined;

  await channel.send({ content, embeds: [embed], components: [buttons] });

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

  // Base permission overwrites (explicitly typed — see createPrivateChannel)
  const baseOverwrites = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: guild.client.user.id,
      type: OverwriteType.Member,
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
    baseOverwrites.push({ id: roleId, type: OverwriteType.Role, allow: PLAYER_ALLOW });
  }

  // Collect player member ids across the whole group
  const memberIds = [];
  for (const team of group.teams) {
    if (isSolo) {
      if (team.id && !String(team.id).startsWith('fake_')) memberIds.push(team.id);
    } else {
      for (const member of team.members || []) {
        if (member.id && !String(member.id).startsWith('fake_')) memberIds.push(member.id);
      }
    }
  }

  const channel = await createPrivateChannel(guild, {
    name: channelName,
    parentId: category ? category.id : null,
    baseOverwrites,
    memberIds,
  });

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
  description += `**Reporting results (admins):**\n`;
  description += `Tap a **🎮 Game** button on the standings board below after each game `;
  description += `and pick the teams in finish order — no typing needed.\n\n`;
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

  let description = '**In-game lobby slots:**\n\n';

  // gameNick is the public display value only (private ids live in gameFields).
  if (isSolo) {
    group.teams.forEach((player, i) => {
      const num = String(i + 1).padStart(2, ' ');
      description += `\`${num}\` ${player.username}`;
      if (player.gameNick) description += ` *(${player.gameNick})*`;
      description += '\n';
    });
  } else {
    group.teams.forEach((team, i) => {
      const num = String(i + 1).padStart(2, ' ');
      description += `\`${num}\` **${team.name}**`;
      if (team.qualifiedFrom) description += ` *(${team.qualifiedFrom})*`;
      description += '\n';
    });
  }

  description += '\n💡 Admins report results with the **🎮 Game** buttons on the ';
  description += 'standings board — tap teams in finish order, at least the places ';
  description += 'that score points. Unplaced teams score 0 (kills still count).';

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

/**
 * Raw channel cleanup. Modes:
 *   'delete'   — delete channels (frees capacity, loses history)
 *   'category' — legacy move to an "Archived Matches" category. NOTE: moved
 *                channels still count toward Discord's 500-channel cap.
 * Transcript-archiving (save history + delete) lives in transcriptService —
 * it needs tournament context for match labels.
 */
async function bulkCleanupChannels(guild, channelIds, mode) {
  let success = 0;
  let archiveCategory = null;

  if (mode === 'category') {
    archiveCategory = await findOrCreateArchiveCategory(guild);
  }

  for (const channelId of channelIds) {
    try {
      if (mode === 'category') {
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
      } else {
        const channel = await guild.channels.fetch(channelId);
        if (channel) {
          await channel.delete();
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
  // Capacity (docs/CHANNEL-CAPACITY-PLAN.md)
  getChannelCapacity,
  isCapacityError,
  GUILD_CHANNEL_CAP,
};
