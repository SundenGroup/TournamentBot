const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { getServerSettings, updateServerSettings, setAnnouncementChannel } = require('../../data/serverSettings');
const { getTournament, getTournamentsByGuild, getActiveTournaments, updateTournament } = require('../../services/tournamentService');
const { collectTournamentChannels, bulkCleanupChannels, clearBracketChannelIds } = require('../../services/channelService');
const { createTournamentEmbed, createParticipantListEmbed } = require('../../utils/embedBuilder');
const { v4: uuidv4 } = require('uuid');
const { checkFeature, getEffectiveTier, getUpgradeEmbed } = require('../../services/subscriptionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin settings and tools')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('settings')
        .setDescription('View current server settings')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-announcement-channel')
        .setDescription('Set the tournament announcement channel (optionally per game)')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel for tournament announcements')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption(option =>
          option.setName('game')
            .setDescription('Only use this channel for one game (leave empty for the server default)')
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-match-category')
        .setDescription('Set the category for match rooms')
        .addChannelOption(option =>
          option.setName('category')
            .setDescription('Category for match room channels')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildCategory)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('cleanup')
        .setDescription('Clean up match rooms from a tournament')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament to clean up')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName('mode')
            .setDescription('Cleanup mode')
            .setRequired(true)
            .addChoices(
              { name: 'Delete channels', value: 'delete' },
              { name: 'Archive channels', value: 'archive' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-auto-cleanup')
        .setDescription('Enable/disable automatic match room cleanup on tournament completion')
        .addBooleanOption(option =>
          option.setName('enabled')
            .setDescription('Enable auto-cleanup')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('mode')
            .setDescription('Cleanup mode (default: delete)')
            .addChoices(
              { name: 'Delete channels', value: 'delete' },
              { name: 'Archive channels', value: 'archive' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add-players')
        .setDescription('Debug: Add fake players to a tournament for testing')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament to add players to')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption(option =>
          option.setName('count')
            .setDescription('Number of fake players to add')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(64)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add-teams')
        .setDescription('Debug: Add fake teams to a tournament for testing')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament to add teams to')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption(option =>
          option.setName('count')
            .setDescription('Number of fake teams to add')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(32)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear-participants')
        .setDescription('Debug: Remove all participants from a tournament')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament to clear')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-role')
        .setDescription('Add/remove tournament admin roles')
        .addStringOption(option =>
          option.setName('action')
            .setDescription('Action to perform')
            .setRequired(true)
            .addChoices(
              { name: 'Add role', value: 'add' },
              { name: 'Remove role', value: 'remove' },
              { name: 'Clear all roles', value: 'clear' }
            )
        )
        .addRoleOption(option =>
          option.setName('role')
            .setDescription('Role to add or remove (required for add/remove)')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-captain-mode')
        .setDescription('When enabled, only the team captain needs to be in the server at signup')
        .addBooleanOption(option =>
          option.setName('enabled')
            .setDescription('Enable captain mode (members resolved at tournament start)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('help')
        .setDescription('Show help overview with all commands')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'settings':
        await handleViewSettings(interaction);
        break;
      case 'set-announcement-channel':
        await handleSetAnnouncementChannel(interaction);
        break;
      case 'set-match-category':
        await handleSetMatchCategory(interaction);
        break;
      case 'cleanup':
        await handleCleanup(interaction);
        break;
      case 'set-auto-cleanup': {
        // Premium feature gate
        const autoCleanupCheck = await checkFeature(interaction.guildId, 'auto_cleanup');
        if (!autoCleanupCheck.allowed) {
          return interaction.reply(getUpgradeEmbed('auto_cleanup', await getEffectiveTier(interaction.guildId)));
        }
        await handleSetAutoCleanup(interaction);
        break;
      }
      case 'add-players':
        await handleAddPlayers(interaction);
        break;
      case 'add-teams':
        await handleAddTeams(interaction);
        break;
      case 'clear-participants':
        await handleClearParticipants(interaction);
        break;
      case 'set-role':
        await handleSetRole(interaction);
        break;
      case 'set-captain-mode': {
        // Premium feature gate
        const captainModeCheck = await checkFeature(interaction.guildId, 'captain_mode');
        if (!captainModeCheck.allowed) {
          return interaction.reply(getUpgradeEmbed('captain_mode', await getEffectiveTier(interaction.guildId)));
        }
        await handleSetCaptainMode(interaction);
        break;
      }
      case 'help':
        await handleHelp(interaction);
        break;
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'game') {
      const { getPresetKeys, GAME_PRESETS } = require('../../config/gamePresets');
      const choices = getPresetKeys().map(key => ({
        name: `${GAME_PRESETS[key].icon} ${GAME_PRESETS[key].displayName}`,
        value: key,
      }));
      const filtered = choices.filter(c => c.name.toLowerCase().includes(focused.value.toLowerCase()));
      return interaction.respond(filtered.slice(0, 25));
    }

    if (focused.name === 'tournament') {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'cleanup') {
        // Show tournaments with channels to clean up
        const tournaments = await getTournamentsByGuild(interaction.guildId);
        const withChannels = tournaments.filter(t =>
          t.bracket && collectTournamentChannels(t.bracket).length > 0
        );
        const choices = withChannels.map(t => ({
          name: `${t.game.icon} ${t.title} (${t.status})`,
          value: t.id,
        }));
        const filtered = choices.filter(choice =>
          choice.name.toLowerCase().includes(focused.value.toLowerCase())
        );
        await interaction.respond(filtered.slice(0, 25));
      } else {
        // Debug subcommands — show active tournaments
        const tournaments = await getActiveTournaments(interaction.guildId);
        const choices = tournaments.map(t => ({
          name: `${t.game.icon} ${t.title}`,
          value: t.id,
        }));
        const filtered = choices.filter(choice =>
          choice.name.toLowerCase().includes(focused.value.toLowerCase())
        );
        await interaction.respond(filtered.slice(0, 25));
      }
    }
  },
};

// ─── Settings ────────────────────────────────────────────────────────────────

async function handleViewSettings(interaction) {
  const settings = await getServerSettings(interaction.guildId);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Server Settings')
    .setColor(0x3498db);

  let announcementChannel = 'Not set (will use #tournament-announcements)';
  if (settings.announcementChannelId) {
    announcementChannel = `<#${settings.announcementChannelId}>`;
  }

  // Per-game announcement overrides
  const gameChannels = settings.gameAnnouncementChannels || {};
  const gameOverrides = Object.entries(gameChannels);
  if (gameOverrides.length > 0) {
    const { GAME_PRESETS } = require('../../config/gamePresets');
    const lines = gameOverrides.map(([key, chId]) => {
      const preset = GAME_PRESETS[key];
      return `${preset?.icon || '🎮'} ${preset?.displayName || key} → <#${chId}>`;
    });
    announcementChannel += `\n**Per game:**\n${lines.join('\n')}`;
  }

  let matchCategory = 'Not set (will create automatically)';
  if (settings.matchRoomCategory) {
    matchCategory = `<#${settings.matchRoomCategory}>`;
  }

  const autoCleanupValue = settings.autoCleanup
    ? `Enabled (${settings.autoCleanupMode})`
    : 'Disabled';

  let adminRolesValue = 'None configured';
  if (settings.tournamentAdminRoles && settings.tournamentAdminRoles.length > 0) {
    adminRolesValue = settings.tournamentAdminRoles.map(id => `<@&${id}>`).join(', ');
  }

  const captainModeValue = settings.captainMode ? 'Enabled' : 'Disabled';

  embed.addFields(
    { name: '📢 Announcement Channel', value: announcementChannel, inline: false },
    { name: '🎮 Match Room Category', value: matchCategory, inline: false },
    { name: '🛡️ Tournament Admin Roles', value: adminRolesValue, inline: false },
    { name: '🔄 Default Format', value: settings.defaultFormat.replace('_', ' '), inline: true },
    { name: '✅ Default Check-in', value: settings.defaultCheckin ? 'Enabled' : 'Disabled', inline: true },
    { name: '⏰ Check-in Window', value: `${settings.defaultCheckinWindow} minutes`, inline: true },
    { name: '🧹 Auto-Cleanup', value: autoCleanupValue, inline: true },
    { name: '👑 Captain Mode', value: captainModeValue, inline: true }
  );

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSetAnnouncementChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  const gameKey = interaction.options.getString('game');

  // Per-game override: announcements for this game go to their own channel
  if (gameKey) {
    const { getPreset } = require('../../config/gamePresets');
    const preset = getPreset(gameKey);
    if (!preset) {
      return interaction.reply({ content: `❌ Unknown game: \`${gameKey}\``, ephemeral: true });
    }

    const { setGameAnnouncementChannel } = require('../../data/serverSettings');
    await setGameAnnouncementChannel(interaction.guildId, gameKey, channel.id);

    return interaction.reply({
      content: `✅ **${preset.icon} ${preset.displayName}** tournaments will now be announced in ${channel}.\nOther games keep using the server default channel.`,
      ephemeral: true,
    });
  }

  await setAnnouncementChannel(interaction.guildId, channel.id, channel.name);

  return interaction.reply({
    content: `✅ Tournament announcements will now be posted in ${channel}.`,
    ephemeral: true,
  });
}

async function handleSetMatchCategory(interaction) {
  const category = interaction.options.getChannel('category');

  await updateServerSettings(interaction.guildId, {
    matchRoomCategory: category.id,
  });

  return interaction.reply({
    content: `✅ Match rooms will now be created in the **${category.name}** category.`,
    ephemeral: true,
  });
}

async function handleCleanup(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const mode = interaction.options.getString('mode');

  const tournament = await getTournament(tournamentId);
  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!tournament.bracket) {
    return interaction.reply({ content: '❌ Tournament has no match rooms (bracket not generated).', ephemeral: true });
  }

  const channelIds = collectTournamentChannels(tournament.bracket);
  if (channelIds.length === 0) {
    return interaction.reply({ content: '❌ No match room channels found for this tournament.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const success = await bulkCleanupChannels(interaction.guild, channelIds, mode);
  const action = mode === 'delete' ? 'deleted' : 'archived';

  if (mode === 'delete') {
    clearBracketChannelIds(tournament.bracket);
  }
  await updateTournament(tournamentId, { bracket: tournament.bracket });

  let reply = `✅ Cleanup complete: ${success}/${channelIds.length} channels ${action}.`;
  if (mode === 'archive') {
    reply += `\nUse \`/admin cleanup\` with **Delete channels** to remove them later.`;
  }

  await interaction.editReply({ content: reply });
}

async function handleSetAutoCleanup(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  const mode = interaction.options.getString('mode');

  const updates = { autoCleanup: enabled };
  if (mode) {
    updates.autoCleanupMode = mode;
  }

  await updateServerSettings(interaction.guildId, updates);

  if (enabled) {
    const settings = await getServerSettings(interaction.guildId);
    return interaction.reply({
      content: `✅ Auto-cleanup **enabled**. Match rooms will be **${settings.autoCleanupMode === 'delete' ? 'deleted' : 'archived'}** 30 seconds after tournament completion.`,
      ephemeral: true,
    });
  }

  return interaction.reply({
    content: '✅ Auto-cleanup **disabled**.',
    ephemeral: true,
  });
}

async function handleSetRole(interaction) {
  const action = interaction.options.getString('action');
  const role = interaction.options.getRole('role');
  const settings = await getServerSettings(interaction.guildId);
  const adminRoles = settings.tournamentAdminRoles || [];

  if (action === 'clear') {
    await updateServerSettings(interaction.guildId, { tournamentAdminRoles: [] });
    return interaction.reply({
      content: '✅ Cleared all tournament admin roles.',
      ephemeral: true,
    });
  }

  if (!role) {
    return interaction.reply({
      content: '❌ You must specify a role for add/remove actions.',
      ephemeral: true,
    });
  }

  if (action === 'add') {
    if (adminRoles.includes(role.id)) {
      return interaction.reply({
        content: `❌ ${role} is already a tournament admin role.`,
        ephemeral: true,
      });
    }

    if (adminRoles.length >= 3) {
      return interaction.reply({
        content: '❌ Maximum of 3 tournament admin roles allowed. Remove one first.',
        ephemeral: true,
      });
    }

    adminRoles.push(role.id);
    await updateServerSettings(interaction.guildId, { tournamentAdminRoles: adminRoles });
    return interaction.reply({
      content: `✅ Added ${role} as a tournament admin role.`,
      ephemeral: true,
    });
  }

  if (action === 'remove') {
    const index = adminRoles.indexOf(role.id);
    if (index === -1) {
      return interaction.reply({
        content: `❌ ${role} is not a tournament admin role.`,
        ephemeral: true,
      });
    }

    adminRoles.splice(index, 1);
    await updateServerSettings(interaction.guildId, { tournamentAdminRoles: adminRoles });
    return interaction.reply({
      content: `✅ Removed ${role} from tournament admin roles.`,
      ephemeral: true,
    });
  }
}

async function handleSetCaptainMode(interaction) {
  const enabled = interaction.options.getBoolean('enabled');

  await updateServerSettings(interaction.guildId, { captainMode: enabled });

  if (enabled) {
    return interaction.reply({
      content: '✅ Captain Mode **enabled**. Only the team captain needs to be in the server at signup. Other members are resolved at tournament start.',
      ephemeral: true,
    });
  }

  return interaction.reply({
    content: '✅ Captain Mode **disabled**. All team members must be in the server at signup.',
    ephemeral: true,
  });
}

// ─── Debug (moved from /debug) ──────────────────────────────────────────────

const FAKE_NAMES = [
  'ShadowStrike', 'NeonBlade', 'PhantomAce', 'CyberWolf', 'BlazeFury',
  'IronClad', 'StormRider', 'NightHawk', 'ThunderBolt', 'FrostBite',
  'VenomFang', 'SilentDeath', 'RapidFire', 'GhostRecon', 'DarkMatter',
  'PixelKing', 'LaserShark', 'TurboNinja', 'MegaNoob', 'ProGamer99',
  'xXSlayerXx', 'HeadshotHero', 'ClutchMaster', 'FragHunter', 'SpawnCamper',
  'RushB_Cyka', 'AWP_God', 'FlickMachine', 'SmokeMid', 'DefaultDancer',
  'SoccerMom42', 'BobBuilder', 'CoolKid2000', 'EpicWinner', 'LootGoblin',
  'BushWookie', 'SniperElite', 'NoobSlayer', 'TryHardTom', 'CasualCarl',
  'RageQuitter', 'LagKing', 'PingSpike', 'BufferFace', 'DCWarrior',
  'AFK_Andy', 'TeamKiller', 'FriendlyFire', 'OopsMyBad', 'WrongButton',
  'ZergRush', 'CampLord', 'SpamKing', 'MacroMaster', 'ScriptKiddo',
  'WallHacker', 'AimbotAndy', 'VACation', 'BanEvader', 'SmurfAccount',
  'AltF4Pro', 'CtrlAltElite', 'EscapeKey', 'TabMaster', 'EnterNinja'
];

const TEAM_NAMES = [
  'Shadow Dragons', 'Neon Knights', 'Phantom Squad', 'Cyber Wolves', 'Blaze Brigade',
  'Iron Legion', 'Storm Chasers', 'Night Owls', 'Thunder Force', 'Frost Giants',
  'Venom Vipers', 'Silent Assassins', 'Rapid Response', 'Ghost Protocol', 'Dark Matter',
  'Pixel Pirates', 'Laser Sharks', 'Turbo Ninjas', 'Mega Noobs', 'Pro Gamers United',
  'The Slayers', 'Headshot Heroes', 'Clutch Kings', 'Frag Hunters', 'Spawn Campers Inc',
  'Rush B Squad', 'AWP Gods', 'Flick Masters', 'Smoke Mid Crew', 'Default Dancers',
  'Chaos Theory', 'Eternal Flames', 'Rising Phoenix', 'Arctic Wolves', 'Solar Flare'
];

async function handleAddPlayers(interaction) {
  // Bulk insert + 2 message edits can exceed the 3s ack window.
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getString('tournament');
  const count = interaction.options.getInteger('count');
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    return interaction.editReply({ content: '❌ Tournament not found.' });
  }

  if (tournament.settings.teamSize > 1) {
    return interaction.editReply({ content: '❌ This is a team tournament. Use `/admin add-teams` instead.' });
  }

  const available = tournament.settings.maxParticipants - tournament.participants.length;
  const toAdd = Math.min(count, available);

  if (toAdd === 0) {
    return interaction.editReply({ content: '❌ Tournament is already full.' });
  }

  const usedNames = new Set(tournament.participants.map(p => p.username));
  let added = 0;

  for (let i = 0; i < toAdd; i++) {
    let name = FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)];
    let attempts = 0;
    while (usedNames.has(name) && attempts < 100) {
      name = FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)] + Math.floor(Math.random() * 1000);
      attempts++;
    }

    tournament.participants.push({
      id: `fake_${uuidv4()}`,
      username: name,
      displayName: name,
      seed: null,
      checkedIn: false,
      joinedAt: new Date(),
      isFake: true,
    });

    usedNames.add(name);
    added++;
  }

  await updateTournament(tournamentId, { participants: tournament.participants });
  await updateTournamentMessages(interaction, tournament);

  return interaction.editReply({
    content: `✅ Added ${added} fake players to **${tournament.title}**. (${tournament.participants.length}/${tournament.settings.maxParticipants})`,
  });
}

async function handleAddTeams(interaction) {
  // Bulk insert + 2 message edits can exceed the 3s ack window.
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getString('tournament');
  const count = interaction.options.getInteger('count');
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    return interaction.editReply({ content: '❌ Tournament not found.' });
  }

  if (tournament.settings.teamSize === 1) {
    return interaction.editReply({ content: '❌ This is a solo tournament. Use `/admin add-players` instead.' });
  }

  const available = tournament.settings.maxParticipants - tournament.teams.length;
  const toAdd = Math.min(count, available);

  if (toAdd === 0) {
    return interaction.editReply({ content: '❌ Tournament is already full.' });
  }

  const usedTeamNames = new Set(tournament.teams.map(t => t.name));
  let added = 0;

  for (let i = 0; i < toAdd; i++) {
    let teamName = TEAM_NAMES[Math.floor(Math.random() * TEAM_NAMES.length)];
    let attempts = 0;
    while (usedTeamNames.has(teamName) && attempts < 100) {
      teamName = TEAM_NAMES[Math.floor(Math.random() * TEAM_NAMES.length)] + ' ' + Math.floor(Math.random() * 100);
      attempts++;
    }

    const members = [];
    for (let j = 0; j < tournament.settings.teamSize; j++) {
      const playerName = FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)] + Math.floor(Math.random() * 1000);
      members.push({
        id: `fake_${uuidv4()}`,
        username: playerName,
        displayName: playerName,
      });
    }

    tournament.teams.push({
      id: uuidv4(),
      name: teamName,
      captain: members[0],
      members: members,
      seed: null,
      checkedIn: false,
      memberCheckins: {},
      joinedAt: new Date(),
      isFake: true,
    });

    usedTeamNames.add(teamName);
    added++;
  }

  await updateTournament(tournamentId, { teams: tournament.teams });
  await updateTournamentMessages(interaction, tournament);

  return interaction.editReply({
    content: `✅ Added ${added} fake teams to **${tournament.title}**. (${tournament.teams.length}/${tournament.settings.maxParticipants})`,
  });
}

async function handleClearParticipants(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  await updateTournament(tournamentId, { participants: [], teams: [] });
  tournament.participants = [];
  tournament.teams = [];
  await updateTournamentMessages(interaction, tournament);

  return interaction.reply({
    content: `✅ Cleared all participants from **${tournament.title}**.`,
    ephemeral: true,
  });
}

async function updateTournamentMessages(interaction, tournament) {
  try {
    const channel = await interaction.client.channels.fetch(tournament.channelId);

    if (tournament.messageId) {
      const mainMessage = await channel.messages.fetch(tournament.messageId);
      const embed = await createTournamentEmbed(tournament);
      await mainMessage.edit({ embeds: [embed] });
    }

    if (tournament.participantListMessageId) {
      const listMessage = await channel.messages.fetch(tournament.participantListMessageId);
      const participantEmbed = await createParticipantListEmbed(tournament);
      await listMessage.edit({ embeds: [participantEmbed] });
    }
  } catch (error) {
    console.error('Error updating tournament messages:', error);
  }
}

// ─── Help (moved from /help) ────────────────────────────────────────────────

const FORMAT_INFO = {
  single_elimination: {
    name: 'Single Elimination',
    description: 'Classic knockout format. Lose once and you\'re out.',
  },
  double_elimination: {
    name: 'Double Elimination',
    description: 'Two-bracket system. You must lose twice to be eliminated.',
  },
  swiss: {
    name: 'Swiss System',
    description: 'Fixed rounds, pairings based on similar records. No elimination.',
  },
  round_robin: {
    name: 'Round Robin',
    description: 'Everyone plays everyone once.',
  },
};

async function handleHelp(interaction) {
  const tier = await getEffectiveTier(interaction.guildId);
  const tierDisplay = tier === 'free' ? 'Free' : tier.charAt(0).toUpperCase() + tier.slice(1);

  const embed = new EmbedBuilder()
    .setTitle('Tournament Bot — Admin Help')
    .setColor(0x3498db)
    .setDescription(`Complete command reference for tournament management.\n**Server Tier:** ${tierDisplay}`);

  embed.addFields(
    {
      name: '/tournament (Admin)',
      value: [
        '`create` — Simple mode wizard',
        '`create-advanced` — Full customization wizard',
        '`list` — List all tournaments',
        '`info` — Show tournament details',
        '`start` — Start tournament & generate brackets',
        '`cancel` — Cancel a tournament',
        '`edit` — Edit title/date/size/best-of before start',
        '`report` — Report match result',
        '`bracket` — View bracket/standings',
        '`seed set|list|randomize|clear` — Manage seeding',
      ].join('\n'),
      inline: false,
    },
    {
      name: '/admin (Administrator)',
      value: [
        '`settings` — View server settings',
        '`set-announcement-channel` — Set announcement channel (add `game:` for per-game)',
        '`set-match-category` — Set match room category',
        '`set-role` — Add/remove tournament admin roles',
        '`cleanup` — Clean up match rooms',
        '`set-auto-cleanup` — Auto-cleanup on completion *(Premium)*',
        '`set-captain-mode` — Deferred member resolution *(Premium)*',
        '`add-players/add-teams` — Debug: add test participants',
        '`clear-participants` — Debug: clear all participants',
      ].join('\n'),
      inline: false,
    },
    {
      name: '/subscribe (Subscription)',
      value: [
        '`status` — View subscription status & usage',
        '`plans` — Compare subscription tiers',
        '`upgrade` — Upgrade your tier',
        '`manage` — Manage billing & payment',
        '`trial` — Start 7-day Premium trial',
        '`api-key` — Manage REST API key *(Business)*',
        '`webhook` — Configure webhooks *(Business)*',
        '`branding` — White-label branding *(Business)*',
      ].join('\n'),
      inline: false,
    }
    // NOTE: the /tokens add-on command is parked (see docs/PARKED-FEATURES.md).
  );

  // Pro tier features
  if (tier === 'pro' || tier === 'business') {
    embed.addFields({
      name: '/templates (Pro)',
      value: [
        '`list` — View saved templates',
        '`view` — View template details',
        '`save` — Save tournament as template',
        '`delete` — Delete a template',
      ].join('\n'),
      inline: true,
    });
    embed.addFields({
      name: '/analytics (Pro)',
      value: [
        '`overview` — Server statistics',
        '`tournament` — Tournament stats',
        '`leaderboard` — Top participants',
      ].join('\n'),
      inline: true,
    });
  } else {
    embed.addFields({
      name: 'Pro Features',
      value: '`/templates` and `/analytics` require Pro tier. Use `/subscribe plans` to learn more.',
      inline: false,
    });
  }

  embed.addFields(
    {
      name: 'Player Commands',
      value: '`/help` — Player help\n`/match list|bracket` — View matches\n`/team add|remove|transfer` — Team management',
      inline: false,
    },
    {
      name: 'Tournament Admin Roles',
      value: 'Designate up to 3 roles as tournament admins with `/admin set-role`. These users can manage tournaments without Administrator permission.',
      inline: false,
    },
    {
      name: 'Tournament Formats',
      value: Object.values(FORMAT_INFO).map(f => `**${f.name}** — ${f.description}`).join('\n'),
      inline: false,
    },
    {
      name: 'Quick Start',
      value: '1. `/tournament create` — Create a tournament\n2. Players sign up via buttons\n3. `/tournament start` — Start when ready\n4. `/tournament report` — Report results\n5. `/match bracket` — View standings',
      inline: false,
    }
  );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
