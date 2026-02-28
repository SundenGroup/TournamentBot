const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getPresetKeys, getFeaturedPresetKeys, GAME_PRESETS } = require('../../config/gamePresets');
const { getTournament, getActiveTournaments, updateTournament } = require('../../services/tournamentService');
const { createBRGroupRoom, collectTournamentChannels, bulkCleanupChannels, clearBracketChannelIds } = require('../../services/channelService');
const { getServerSettings } = require('../../data/serverSettings');
const { canManageTournaments } = require('../../utils/permissions');
const { createTournamentEmbed, createTournamentButtons } = require('../../utils/embedBuilder');
const singleElim = require('../../services/singleEliminationService');
const doubleElim = require('../../services/doubleEliminationService');
const swiss = require('../../services/swissService');
const roundRobin = require('../../services/roundRobinService');
const battleRoyale = require('../../services/battleRoyaleService');
const webhooks = require('../../services/webhookService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tournament')
    .setDescription('Tournament management commands')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new tournament (Simple Mode)')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create-advanced')
        .setDescription('Create a new tournament with full customization (guided wizard)')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all tournaments in this server')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('info')
        .setDescription('Show tournament details')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament to show')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('cancel')
        .setDescription('Cancel a tournament')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament to cancel')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('start')
        .setDescription('Start a tournament and generate brackets')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament to start')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('report')
        .setDescription('Report match result')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption(option =>
          option.setName('match_number')
            .setDescription('Match number')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('winner')
            .setDescription('Winner (participant/team name)')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName('score')
            .setDescription('Score (e.g., "2-1", "16-14")')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('br-report')
        .setDescription('Report Battle Royale game result')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName('group')
            .setDescription('Group (or "finals")')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption(option =>
          option.setName('game_number')
            .setDescription('Game number (1, 2, 3...)')
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption(option =>
          option.setName('placements')
            .setDescription('Lobby numbers in finish order (e.g., 1,5,3,2,8...)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bracket')
        .setDescription('View bracket/standings')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('seed')
        .setDescription('Tournament seeding commands')
        .addSubcommand(subcommand =>
          subcommand
            .setName('set')
            .setDescription('Set seed for a participant/team')
            .addStringOption(option =>
              option.setName('tournament')
                .setDescription('Tournament')
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addStringOption(option =>
              option.setName('participant')
                .setDescription('Participant or team name')
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addIntegerOption(option =>
              option.setName('seed')
                .setDescription('Seed number (1 = highest)')
                .setRequired(true)
                .setMinValue(1)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('list')
            .setDescription('View current seeding')
            .addStringOption(option =>
              option.setName('tournament')
                .setDescription('Tournament')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('randomize')
            .setDescription('Randomize all unseeded participants')
            .addStringOption(option =>
              option.setName('tournament')
                .setDescription('Tournament')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('clear')
            .setDescription('Clear all seeds')
            .addStringOption(option =>
              option.setName('tournament')
                .setDescription('Tournament')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    // Admin subcommands require tournament management permissions
    const adminSubcommands = ['create', 'create-advanced', 'start', 'cancel', 'report', 'br-report'];
    const adminSeedSubcommands = ['set', 'randomize', 'clear'];

    const needsPermCheck = adminSubcommands.includes(subcommand) ||
      (group === 'seed' && adminSeedSubcommands.includes(subcommand));

    if (needsPermCheck && !canManageTournaments(interaction.member)) {
      return interaction.reply({
        content: '❌ You do not have permission to manage tournaments.',
        ephemeral: true,
      });
    }

    if (group === 'seed') {
      switch (subcommand) {
        case 'set':
          await handleSeedSet(interaction);
          break;
        case 'list':
          await handleSeedList(interaction);
          break;
        case 'randomize':
          await handleSeedRandomize(interaction);
          break;
        case 'clear':
          await handleSeedClear(interaction);
          break;
      }
      return;
    }

    switch (subcommand) {
      case 'create':
        await handleSimpleCreate(interaction);
        break;
      case 'create-advanced':
        await handleAdvancedCreate(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
      case 'info':
        await handleInfo(interaction);
        break;
      case 'cancel':
        await handleCancel(interaction);
        break;
      case 'start':
        await handleStart(interaction);
        break;
      case 'report':
        await handleReport(interaction);
        break;
      case 'br-report':
        await handleBRReport(interaction);
        break;
      case 'bracket':
        await handleBracket(interaction);
        break;
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'game') {
      const presetKeys = getPresetKeys();
      const choices = presetKeys.map(key => ({
        name: `${GAME_PRESETS[key].icon} ${GAME_PRESETS[key].displayName}`,
        value: key,
      }));
      choices.push({ name: '🎮 Other Game...', value: 'custom' });

      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focused.value.toLowerCase())
      );
      await interaction.respond(filtered.slice(0, 25));
    }

    if (focused.name === 'tournament') {
      const tournaments = getActiveTournaments(interaction.guildId);
      const choices = tournaments.map(t => ({
        name: `${t.game.icon} ${t.title}`,
        value: t.id,
      }));

      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focused.value.toLowerCase())
      );
      await interaction.respond(filtered.slice(0, 25));
    }

    if (focused.name === 'winner') {
      const tournamentId = interaction.options.getString('tournament');
      const tournament = getTournament(tournamentId);

      if (!tournament || !tournament.bracket) {
        return interaction.respond([]);
      }

      const isSolo = tournament.settings.teamSize === 1;
      const list = isSolo ? tournament.participants : tournament.teams;

      const choices = list.map(p => ({
        name: isSolo ? p.username : p.name,
        value: p.id,
      }));

      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focused.value.toLowerCase())
      );
      await interaction.respond(filtered.slice(0, 25));
    }

    if (focused.name === 'group') {
      const tournamentId = interaction.options.getString('tournament');
      const tournament = getTournament(tournamentId);

      if (!tournament || !tournament.bracket || tournament.bracket.type !== 'battle_royale') {
        return interaction.respond([]);
      }

      const bracket = tournament.bracket;
      const choices = [];

      if (bracket.currentStage === 'groups') {
        for (const g of bracket.groups) {
          choices.push({
            name: g.name,
            value: g.id,
          });
        }
      } else if (bracket.currentStage === 'finals' && bracket.finals) {
        choices.push({
          name: 'Grand Finals',
          value: 'finals',
        });
      }

      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focused.value.toLowerCase())
      );
      await interaction.respond(filtered.slice(0, 25));
    }

    if (focused.name === 'participant') {
      const tournamentId = interaction.options.getString('tournament');
      const tournament = getTournament(tournamentId);

      if (!tournament) {
        return interaction.respond([]);
      }

      const isSolo = tournament.settings.teamSize === 1;
      const list = isSolo ? tournament.participants : tournament.teams;

      const choices = list.map(p => ({
        name: isSolo ? p.username : p.name,
        value: p.id,
      }));

      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focused.value.toLowerCase())
      );
      await interaction.respond(filtered.slice(0, 25));
    }
  },
};

// ─── Tournament Create ──────────────────────────────────────────────────────

async function handleSimpleCreate(interaction) {
  const featuredKeys = getFeaturedPresetKeys();
  const allKeys = getPresetKeys();
  const hasMoreGames = allKeys.length > featuredKeys.length;

  const options = featuredKeys.map(key => ({
    label: GAME_PRESETS[key].displayName,
    value: key,
    emoji: GAME_PRESETS[key].icon,
    description: `${GAME_PRESETS[key].defaultTeamSize}v${GAME_PRESETS[key].defaultTeamSize} ${GAME_PRESETS[key].defaultFormat.replace('_', ' ')}`,
  }));

  if (hasMoreGames) {
    options.push({
      label: 'More Games...',
      value: '__more_games__',
      emoji: '📋',
      description: `Browse all ${allKeys.length} supported games`,
    });
  }

  options.push({
    label: 'Other Game...',
    value: 'custom',
    emoji: '🎮',
    description: 'Create a tournament for any game',
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('gameSelect')
    .setPlaceholder('Select a game')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: '🎮 **Create Tournament — Simple Mode**\n\nSelect a game to get started:\n\n*Or use `/tournament create-advanced` for full customization.*',
    components: [row],
    ephemeral: true,
  });
}

async function handleAdvancedCreate(interaction) {
  const { createSession } = require('../../data/wizardSessions');
  const { getPresetKeys, getFeaturedPresetKeys } = require('../../config/gamePresets');

  const session = createSession(interaction.user.id, interaction.guildId);

  const featuredKeys = getFeaturedPresetKeys();
  const allKeys = getPresetKeys();
  const hasMoreGames = allKeys.length > featuredKeys.length;

  const options = featuredKeys.map(key => ({
    label: GAME_PRESETS[key].displayName,
    value: key,
    emoji: GAME_PRESETS[key].icon,
    description: `${GAME_PRESETS[key].defaultTeamSize}v${GAME_PRESETS[key].defaultTeamSize} ${GAME_PRESETS[key].defaultFormat.replace('_', ' ')}`,
  }));

  if (hasMoreGames) {
    options.push({
      label: 'More Games...',
      value: '__more_games__',
      emoji: '📋',
      description: `Browse all ${allKeys.length} supported games`,
    });
  }

  options.push({
    label: 'Other Game...',
    value: 'custom',
    emoji: '🎮',
    description: 'Create a tournament for any game',
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`wizardGame:${session.id}`)
    .setPlaceholder('Select a game')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: '🎮 **Create Tournament — Advanced Mode**\n\nSelect a game to get started:',
    components: [row],
    ephemeral: true,
  });
}

// ─── Tournament List / Info / Cancel / Start ────────────────────────────────

async function handleList(interaction) {
  const { getTournamentsByGuild } = require('../../services/tournamentService');

  const tournaments = getTournamentsByGuild(interaction.guildId);

  if (tournaments.length === 0) {
    return interaction.reply({
      content: 'No tournaments found in this server.',
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 Tournaments')
    .setColor(0x3498db);

  const lines = tournaments.map(t => {
    const statusEmoji = {
      registration: '📝',
      checkin: '✅',
      active: '🎮',
      completed: '🏆',
      cancelled: '❌',
    }[t.status];
    return `${statusEmoji} **${t.title}** (${t.game.shortName}) — ${t.status}`;
  });

  embed.setDescription(lines.join('\n'));

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleInfo(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  const embed = createTournamentEmbed(tournament);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleCancel(interaction) {
  const { canEditTournament } = require('../../utils/permissions');

  const tournamentId = interaction.options.getString('tournament');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!canEditTournament(interaction.member, tournament)) {
    return interaction.reply({ content: '❌ You do not have permission to cancel this tournament.', ephemeral: true });
  }

  updateTournament(tournamentId, { status: 'cancelled' });

  // Trigger webhook
  webhooks.onTournamentCancelled(tournament);

  const { cancelReminders } = require('../../services/reminderService');
  cancelReminders(tournamentId);

  await interaction.reply({ content: `✅ Tournament **${tournament.title}** has been cancelled.` });
}

async function handleStart(interaction) {
  const { canEditTournament } = require('../../utils/permissions');
  const { createMatchRoom } = require('../../services/channelService');

  const tournamentId = interaction.options.getString('tournament');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!canEditTournament(interaction.member, tournament)) {
    return interaction.reply({ content: '❌ You do not have permission to start this tournament.', ephemeral: true });
  }

  if (tournament.status !== 'registration' && tournament.status !== 'checkin') {
    return interaction.reply({ content: '❌ Tournament is not in registration/checkin phase.', ephemeral: true });
  }

  const isSolo = tournament.settings.teamSize === 1;
  const participants = isSolo ? tournament.participants : tournament.teams;
  const participantCount = participants.length;

  if (participantCount < 2) {
    return interaction.reply({ content: '❌ Need at least 2 participants to start.', ephemeral: true });
  }

  // Immediately mark as active to prevent concurrent starts
  updateTournament(tournamentId, { status: 'active' });

  await interaction.deferReply();

  try {
    // Resolve pending team members (captain mode)
    if (!isSolo && tournament.settings.captainMode) {
      const { resolveTeamMembers } = require('../../services/tournamentService');
      const { resolved, failed } = await resolveTeamMembers(interaction.guild, tournament);
      if (resolved > 0 || failed > 0) {
        console.log(`Captain mode resolution for "${tournament.title}": ${resolved} resolved, ${failed} failed`);
      }
      updateTournament(tournamentId, { teams: tournament.teams });
    }

    const format = tournament.settings.format;
    let service;
    let bracket;

    switch (format) {
      case 'double_elimination':
        service = doubleElim;
        bracket = doubleElim.generateBracket(participants, tournament.settings);
        break;
      case 'swiss':
        service = swiss;
        bracket = swiss.generateBracket(participants, tournament.settings);
        break;
      case 'round_robin':
        service = roundRobin;
        bracket = roundRobin.generateBracket(participants, tournament.settings);
        break;
      case 'battle_royale':
        service = battleRoyale;
        bracket = battleRoyale.generateBracket(participants, tournament.settings);
        break;
      case 'single_elimination':
      default:
        service = singleElim;
        bracket = singleElim.generateBracket(participants, tournament.settings);
        break;
    }

    tournament.bracket = bracket;
    tournament.status = 'active';

    let roomsCreated = 0;
    if (format === 'battle_royale') {
      for (const g of bracket.groups) {
        try {
          const channel = await createBRGroupRoom(interaction.guild, g, tournament);
          g.channelId = channel.id;
          roomsCreated++;
        } catch (error) {
          console.error('Error creating BR group room:', error);
        }
      }
    } else {
      const activeMatches = service.getActiveMatches(bracket);
      const { createMatchRoom } = require('../../services/channelService');

      for (const match of activeMatches) {
        if (match.participant1 && match.participant2) {
          try {
            const channel = await createMatchRoom(interaction.guild, match, tournament);
            match.channelId = channel.id;
            roomsCreated++;
          } catch (error) {
            console.error('Error creating match room:', error);
          }
        }
      }
    }

    updateTournament(tournamentId, { bracket, status: 'active' });

    // Trigger webhook
    webhooks.onTournamentStarted(tournament);

    const embed = new EmbedBuilder()
      .setTitle(`🚀 ${tournament.title} — Tournament Started!`)
      .setColor(0x2ecc71);

    if (tournament.game.logo) {
      embed.setThumbnail(tournament.game.logo);
    }

    const formatNames = {
      single_elimination: 'Single Elimination',
      double_elimination: 'Double Elimination',
      swiss: 'Swiss',
      round_robin: 'Round Robin',
      battle_royale: 'Battle Royale',
    };

    let desc = `**${participantCount}** ${isSolo ? 'players' : 'teams'} competing\n`;
    desc += `**Format:** ${formatNames[format] || format}\n`;
    if (format !== 'battle_royale') {
      desc += `**Best of:** ${tournament.settings.bestOf}\n`;
    }

    if (format === 'swiss') {
      desc += `**Rounds:** ${bracket.totalRounds}\n`;
    } else if (format === 'round_robin') {
      desc += `**Rounds:** ${bracket.totalRounds}\n`;
      desc += `**Total Matches:** ${bracket.totalMatches}\n`;
    } else if (format === 'battle_royale') {
      desc += `**Groups:** ${bracket.groups.length}\n`;
      desc += `**Games per Stage:** ${bracket.gamesPerStage}\n`;
      desc += `**Teams to Finals:** ${bracket.totalAdvancing}\n`;
    }

    desc += `\n**${roomsCreated}** match rooms created.\n\n`;
    desc += `Use \`/match list\` to see active matches.`;

    if (format === 'swiss' || format === 'round_robin' || format === 'battle_royale') {
      desc += `\nUse \`/match bracket\` to view standings.`;
    }

    embed.setDescription(desc);

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Error starting tournament:', error);
    await interaction.editReply({ content: `❌ Error starting tournament: ${error.message}` });
  }
}

// ─── Match Reporting (moved from /match) ────────────────────────────────────

function getServiceForBracket(bracket) {
  switch (bracket.type) {
    case 'double_elimination':
      return doubleElim;
    case 'swiss':
      return swiss;
    case 'round_robin':
      return roundRobin;
    case 'battle_royale':
      return battleRoyale;
    case 'single_elimination':
    default:
      return singleElim;
  }
}

async function handleReport(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const matchNumber = interaction.options.getInteger('match_number');
  const winnerId = interaction.options.getString('winner');
  const score = interaction.options.getString('score');

  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!tournament.bracket) {
    return interaction.reply({ content: '❌ Tournament has not started yet.', ephemeral: true });
  }

  const bracket = tournament.bracket;
  const service = getServiceForBracket(bracket);

  let match = null;

  if (bracket.type === 'double_elimination') {
    for (const round of [...bracket.winnersRounds, ...bracket.losersRounds, ...bracket.grandFinalsRounds]) {
      match = round.matches.find(m => m.matchNumber === matchNumber);
      if (match) break;
    }
  } else {
    for (const round of bracket.rounds) {
      match = round.matches.find(m => m.matchNumber === matchNumber);
      if (match) break;
    }
  }

  if (!match) {
    return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
  }

  if (match.winner) {
    return interaction.reply({ content: '❌ This match has already been reported.', ephemeral: true });
  }

  const p1Id = match.participant1?.id;
  const p2Id = match.participant2?.id;

  if (winnerId !== p1Id && winnerId !== p2Id) {
    return interaction.reply({ content: '❌ Selected winner is not in this match.', ephemeral: true });
  }

  const isSolo = tournament.settings.teamSize === 1;

  // Validate score format if provided (e.g., "2-1", "16-14", "3-0")
  if (score && !/^\d{1,3}-\d{1,3}$/.test(score.trim())) {
    return interaction.reply({ content: '❌ Invalid score format. Use format like `2-1` or `16-14`.', ephemeral: true });
  }

  try {
    service.advanceWinner(bracket, match.id, winnerId, score);

    const winner = winnerId === p1Id ? match.participant1 : match.participant2;
    const loser = winnerId === p1Id ? match.participant2 : match.participant1;
    const winnerName = isSolo ? winner?.username : winner?.name;
    const loserName = isSolo ? loser?.username : loser?.name;

    // Trigger webhook for match completion
    webhooks.onMatchCompleted(tournament, {
      ...match,
      winner,
      loser,
      score: score || null,
    });

    let response = `✅ **Match #${matchNumber}** reported: **${winnerName}** defeats **${loserName}**`;
    if (score) response += ` (${score})`;

    if (bracket.type === 'swiss' && service.isRoundComplete(bracket)) {
      if (bracket.currentRound < bracket.totalRounds) {
        service.generateNextRound(bracket);
        response += `\n\n📋 **Round ${bracket.currentRound} started!** Use \`/match list\` to see new matches.`;
      }
    }

    updateTournament(tournamentId, { bracket });

    if (service.isComplete(bracket)) {
      const results = service.getResults(bracket);
      const champName = isSolo ? results.winner?.username : results.winner?.name;
      response += `\n\n🏆 **Tournament Complete!** Champion: **${champName}**`;
      updateTournament(tournamentId, { status: 'completed' });

      // Trigger tournament completed webhook
      webhooks.onTournamentCompleted(tournament, results.standings || [results.winner, results.runnerUp, results.thirdPlace].filter(Boolean));

      await updateTournamentAnnouncement(interaction.client, tournament);
      triggerAutoCleanup(interaction.guild, tournament);
    }

    return interaction.reply({ content: response });

  } catch (error) {
    console.error('Error reporting match:', error);
    return interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
  }
}

async function updateTournamentAnnouncement(client, tournament) {
  try {
    const channel = await client.channels.fetch(tournament.channelId);
    if (!channel) return;

    const message = await channel.messages.fetch(tournament.messageId);
    if (!message) return;

    tournament.status = 'completed';

    const embed = createTournamentEmbed(tournament);
    const buttons = createTournamentButtons(tournament);

    await message.edit({ embeds: [embed], components: buttons });
  } catch (error) {
    console.error('Error updating tournament announcement:', error);
  }
}

async function handleBRReport(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const groupId = interaction.options.getString('group');
  const gameNumber = interaction.options.getInteger('game_number');
  const placementsStr = interaction.options.getString('placements');

  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!tournament.bracket) {
    return interaction.reply({ content: '❌ Tournament has not started yet.', ephemeral: true });
  }

  if (tournament.bracket.type !== 'battle_royale') {
    return interaction.reply({ content: '❌ This command is only for Battle Royale tournaments.', ephemeral: true });
  }

  const bracket = tournament.bracket;
  const isSolo = tournament.settings.teamSize === 1;

  const stage = battleRoyale.getGroup(bracket, groupId);
  if (!stage) {
    return interaction.reply({ content: '❌ Group not found.', ephemeral: true });
  }

  const placementInputs = placementsStr.split(',').map(s => s.trim()).filter(s => s.length > 0);

  if (placementInputs.length === 0) {
    return interaction.reply({ content: '❌ No placements provided. Use comma-separated lobby numbers (e.g., 1,5,3,2).', ephemeral: true });
  }

  const placements = [];
  const usedNumbers = new Set();
  const getName = (t) => isSolo ? t.username : t.name;

  for (let i = 0; i < placementInputs.length; i++) {
    const input = placementInputs[i];
    const lobbyNum = parseInt(input, 10);

    if (!isNaN(lobbyNum)) {
      if (lobbyNum < 1 || lobbyNum > stage.teams.length) {
        return interaction.reply({
          content: `❌ Invalid lobby number: ${lobbyNum}. Valid range: 1-${stage.teams.length}`,
          ephemeral: true,
        });
      }

      if (usedNumbers.has(lobbyNum)) {
        return interaction.reply({
          content: `❌ Duplicate lobby number: ${lobbyNum}`,
          ephemeral: true,
        });
      }

      usedNumbers.add(lobbyNum);
      placements.push(stage.teams[lobbyNum - 1].id);
    } else {
      const name = input.toLowerCase();
      const team = stage.teams.find(t => {
        const teamName = getName(t)?.toLowerCase();
        return teamName === name || teamName?.includes(name);
      });

      if (!team) {
        return interaction.reply({
          content: `❌ "${input}" not found. Use lobby numbers (1-${stage.teams.length}) shown in the game room.`,
          ephemeral: true,
        });
      }

      const teamIndex = stage.teams.indexOf(team) + 1;
      if (usedNumbers.has(teamIndex)) {
        return interaction.reply({
          content: `❌ Duplicate: "${input}" (lobby #${teamIndex})`,
          ephemeral: true,
        });
      }

      usedNumbers.add(teamIndex);
      placements.push(team.id);
    }
  }

  if (placements.length < stage.teams.length) {
    const reportedIds = new Set(placements);
    const unreportedTeams = stage.teams.filter(t => !reportedIds.has(t.id));
    for (const team of unreportedTeams) {
      placements.push(team.id);
    }
  }

  try {
    battleRoyale.reportGameResults(bracket, groupId, gameNumber, placements);

    const getTeamName = (id) => {
      const team = stage.teams.find(t => t.id === id);
      return team ? getName(team) : '?';
    };

    const reportedCount = placementInputs.length;
    const totalTeams = stage.teams.length;

    let response = `✅ **${stage.name} - Game ${gameNumber}** results recorded!\n\n`;
    response += `🥇 **1st:** ${getTeamName(placements[0])}\n`;
    response += `🥈 **2nd:** ${getTeamName(placements[1])}\n`;
    response += `🥉 **3rd:** ${getTeamName(placements[2])}\n`;

    if (reportedCount < totalTeams) {
      response += `\n*${reportedCount} placements reported, ${totalTeams - reportedCount} teams auto-filled to last place*\n`;
    }

    if (bracket.currentStage === 'finals' && battleRoyale.isComplete(bracket)) {
      const results = battleRoyale.getResults(bracket);
      const champName = isSolo ? results.winner?.username : results.winner?.name;
      response += `\n🏆 **Tournament Complete!** Champion: **${champName}**`;
      updateTournament(tournamentId, { status: 'completed' });

      await updateTournamentAnnouncement(interaction.client, tournament);
    } else if (bracket.currentStage === 'finals') {
      const standings = battleRoyale.getStandings(bracket);
      response += `\n📊 Finals: ${standings.finals.gamesComplete}/${standings.finals.totalGames} games complete`;
    } else if (bracket.currentStage === 'groups') {
      const standings = battleRoyale.getStandings(bracket);
      const groupInfo = standings.groups.find(g => g.id === groupId);
      if (groupInfo) {
        response += `\n📊 ${groupInfo.name}: ${groupInfo.gamesComplete}/${groupInfo.totalGames} games complete`;
      }
    }

    await announceBRGameResult(interaction.client, tournament, stage, gameNumber, placements, isSolo);

    if (bracket.currentStage === 'finals' && bracket.finals && !bracket.finals.channelId) {
      try {
        const channel = await createBRGroupRoom(interaction.guild, bracket.finals, tournament);
        bracket.finals.channelId = channel.id;
        response += `\n\n🚀 **Finals lobby created!** ${bracket.finals.teams.length} teams advancing.`;

        await announceBRFinalsStart(interaction.client, tournament, bracket);
      } catch (error) {
        console.error('Error creating finals room:', error);
      }
    }

    if (bracket.currentStage === 'complete' || (bracket.currentStage === 'finals' && battleRoyale.isComplete(bracket))) {
      await announceBRTournamentComplete(interaction.client, tournament, bracket);
      triggerAutoCleanup(interaction.guild, tournament);
    }

    updateTournament(tournamentId, { bracket });

    return interaction.reply({ content: response });

  } catch (error) {
    console.error('Error reporting BR game:', error);
    return interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
  }
}

async function announceBRGameResult(client, tournament, stage, gameNumber, placements, isSolo) {
  try {
    const channel = await client.channels.fetch(tournament.channelId);
    if (!channel) return;

    const getName = (team) => isSolo ? team?.username : team?.name;

    const top5 = placements.slice(0, 5).map(id => stage.teams.find(t => t.id === id));

    const embed = new EmbedBuilder()
      .setTitle(`🎮 ${stage.name} — Game ${gameNumber} Results`)
      .setColor(0xff6b35);

    if (tournament.game.logo) {
      embed.setThumbnail(tournament.game.logo);
    }

    let description = `**${tournament.title}**\n\n`;
    description += `🥇 **1st:** ${getName(top5[0])} (+${stage.teams.length} pts)\n`;
    description += `🥈 **2nd:** ${getName(top5[1])} (+${stage.teams.length - 1} pts)\n`;
    description += `🥉 **3rd:** ${getName(top5[2])} (+${stage.teams.length - 2} pts)\n`;
    if (top5[3]) description += `4th: ${getName(top5[3])}\n`;
    if (top5[4]) description += `5th: ${getName(top5[4])}\n`;

    const sortedStandings = [...stage.standings].sort((a, b) => b.points - a.points);
    description += `\n**Current Standings:**\n`;
    sortedStandings.slice(0, 5).forEach((s, i) => {
      description += `${i + 1}. ${getName(s.team)} — ${s.points} pts\n`;
    });

    const gamesComplete = stage.games.filter(g => g.status === 'complete').length;
    description += `\n📊 *${gamesComplete}/${stage.games.length} games complete*`;

    embed.setDescription(description);

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error announcing BR game result:', error);
  }
}

async function announceBRFinalsStart(client, tournament, bracket) {
  try {
    const channel = await client.channels.fetch(tournament.channelId);
    if (!channel) return;

    const isSolo = tournament.settings.teamSize === 1;
    const getName = (team) => isSolo ? team?.username : team?.name;

    const embed = new EmbedBuilder()
      .setTitle(`🚀 GRAND FINALS — ${tournament.title}`)
      .setColor(0xffd700);

    if (tournament.game.logo) {
      embed.setThumbnail(tournament.game.logo);
    }

    let description = `**${bracket.finals.teams.length} teams have qualified!**\n\n`;

    const byGroup = {};
    for (const team of bracket.finals.teams) {
      const from = team.qualifiedFrom || 'Unknown';
      if (!byGroup[from]) byGroup[from] = [];
      byGroup[from].push(team);
    }

    for (const [groupName, teams] of Object.entries(byGroup)) {
      description += `**From ${groupName}:**\n`;
      teams.forEach(t => {
        description += `• ${getName(t)} (${t.groupPoints} pts)\n`;
      });
      description += '\n';
    }

    description += `🎮 **${bracket.gamesPerStage} games** to determine the champion!`;

    embed.setDescription(description);

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error announcing BR finals start:', error);
  }
}

async function announceBRTournamentComplete(client, tournament, bracket) {
  try {
    const channel = await client.channels.fetch(tournament.channelId);
    if (!channel) return;

    const results = battleRoyale.getResults(bracket);
    if (!results) return;

    const isSolo = tournament.settings.teamSize === 1;
    const getName = (team) => isSolo ? team?.username : team?.name;

    const embed = new EmbedBuilder()
      .setTitle('🏆 TOURNAMENT COMPLETE 🏆')
      .setColor(0xffd700)
      .setDescription(tournament.title);

    if (tournament.game.logo) {
      embed.setThumbnail(tournament.game.logo);
    }

    const fields = [
      { name: '🥇 Champion', value: getName(results.winner) || 'Unknown', inline: true },
      { name: '🥈 Runner-up', value: getName(results.runnerUp) || 'Unknown', inline: true },
    ];

    if (results.thirdPlace) {
      fields.push({ name: '🥉 3rd Place', value: getName(results.thirdPlace) || 'Unknown', inline: true });
    }

    fields.push(
      { name: '🎮 Game', value: `${tournament.game.icon} ${tournament.game.displayName}`, inline: true },
      { name: '🔄 Format', value: 'Battle Royale', inline: true }
    );

    embed.addFields(fields);
    embed.setFooter({ text: 'Congratulations to all participants!' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`viewResults:${tournament.id}`)
        .setLabel('Show Complete Results')
        .setEmoji('🏆')
        .setStyle(ButtonStyle.Success)
    );

    await channel.send({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error('Error announcing BR tournament complete:', error);
  }
}

function triggerAutoCleanup(guild, tournament) {
  const settings = getServerSettings(guild.id);
  if (!settings.autoCleanup) return;

  const channelIds = collectTournamentChannels(tournament.bracket);
  if (channelIds.length === 0) return;

  const mode = settings.autoCleanupMode || 'delete';
  const action = mode === 'delete' ? 'Deleting' : 'Archiving';
  console.log(`Auto-cleanup: ${action} ${channelIds.length} channels for "${tournament.title}" in 30s`);

  setTimeout(async () => {
    try {
      const count = await bulkCleanupChannels(guild, channelIds, mode);
      if (mode === 'delete') {
        clearBracketChannelIds(tournament.bracket);
      }
      updateTournament(tournament.id, { bracket: tournament.bracket });
      console.log(`Auto-cleanup complete: ${count}/${channelIds.length} channels processed for "${tournament.title}"`);
    } catch (error) {
      console.error('Auto-cleanup error:', error);
    }
  }, 30000);
}

// ─── Bracket Display (moved from /bracket) ──────────────────────────────────

async function handleBracket(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!tournament.bracket) {
    return interaction.reply({ content: '❌ Tournament has not started yet.', ephemeral: true });
  }

  const embeds = buildBracketEmbeds(tournament);
  return interaction.reply({ embeds, ephemeral: true });
}

/**
 * Build bracket display embeds for a tournament.
 * Shared by both /tournament bracket and /match bracket.
 */
function buildBracketEmbeds(tournament) {
  const bracket = tournament.bracket;
  const isSolo = tournament.settings.teamSize === 1;
  const getName = (p) => isSolo ? p?.username : p?.name;

  const embeds = [];

  if (bracket.type === 'swiss') {
    const standings = swiss.getStandings(bracket);

    const standingsEmbed = new EmbedBuilder()
      .setTitle(`📊 ${tournament.title} — Swiss Standings`)
      .setColor(0xe67e22);

    let standingsText = `**Round ${bracket.currentRound} of ${bracket.totalRounds}**\n\n`;
    standingsText += '```\n';
    standingsText += 'Rank  Player              W-L   Pts  Buch\n';
    standingsText += '─'.repeat(48) + '\n';

    const displayStandings = standings.slice(0, 25);
    displayStandings.forEach((s, i) => {
      const name = getName(s.participant) || 'Unknown';
      const displayName = name.length > 18 ? name.substring(0, 15) + '...' : name.padEnd(18);
      const record = `${s.wins}-${s.losses}`.padEnd(5);
      const points = String(s.points).padEnd(4);
      const buchholz = String(s.buchholz);
      standingsText += `${String(i + 1).padStart(2)}    ${displayName} ${record} ${points} ${buchholz}\n`;
    });
    standingsText += '```';

    if (standings.length > 25) {
      standingsText += `\n*...and ${standings.length - 25} more participants*`;
    }

    standingsEmbed.setDescription(standingsText);
    embeds.push(standingsEmbed);

    const currentRound = bracket.rounds[bracket.currentRound - 1];
    if (currentRound) {
      const matchesEmbed = new EmbedBuilder()
        .setTitle(`Round ${bracket.currentRound} Matches`)
        .setColor(0xe67e22);

      let matchesText = '';
      for (const match of currentRound.matches) {
        const p1 = getName(match.participant1) || 'BYE';
        const p2 = getName(match.participant2) || 'BYE';
        const status = match.winner ? `✓ ${getName(match.winner)}` : (match.isBye ? '(bye)' : '');
        matchesText += `**#${match.matchNumber}:** ${p1} vs ${p2} ${status}\n`;
      }

      matchesEmbed.setDescription(matchesText || 'No matches');
      embeds.push(matchesEmbed);
    }

  } else if (bracket.type === 'round_robin') {
    const standings = roundRobin.getStandings(bracket);

    const standingsEmbed = new EmbedBuilder()
      .setTitle(`📊 ${tournament.title} — Round Robin Standings`)
      .setColor(0x1abc9c);

    let standingsText = `**Round ${bracket.currentRound} of ${bracket.totalRounds}**\n\n`;
    standingsText += '```\n';
    standingsText += 'Rank  Player              W-L   Played\n';
    standingsText += '─'.repeat(44) + '\n';

    const displayStandings = standings.slice(0, 25);
    displayStandings.forEach((s, i) => {
      const name = getName(s.participant) || 'Unknown';
      const displayName = name.length > 18 ? name.substring(0, 15) + '...' : name.padEnd(18);
      const record = `${s.wins}-${s.losses}`.padEnd(5);
      const played = String(s.matchesPlayed);
      standingsText += `${String(i + 1).padStart(2)}    ${displayName} ${record} ${played}\n`;
    });
    standingsText += '```';

    if (standings.length > 25) {
      standingsText += `\n*...and ${standings.length - 25} more participants*`;
    }

    standingsEmbed.setDescription(standingsText);
    embeds.push(standingsEmbed);

    const currentRound = bracket.rounds.find(r => r.status === 'active');
    if (currentRound) {
      const matchesEmbed = new EmbedBuilder()
        .setTitle(`Round ${currentRound.roundNumber} Matches`)
        .setColor(0x1abc9c);

      let matchesText = '';
      for (const match of currentRound.matches) {
        const p1 = getName(match.participant1) || 'TBD';
        const p2 = getName(match.participant2) || 'TBD';
        const status = match.winner ? `✓ ${getName(match.winner)}` : '';
        matchesText += `**#${match.matchNumber}:** ${p1} vs ${p2} ${status}\n`;
      }

      matchesEmbed.setDescription(matchesText || 'No matches');
      embeds.push(matchesEmbed);
    }

  } else if (bracket.type === 'battle_royale') {
    const standings = battleRoyale.getStandings(bracket);
    const stageTitle = bracket.currentStage === 'finals' ? 'Grand Finals' : 'Group Stage';

    const mainEmbed = new EmbedBuilder()
      .setTitle(`📊 ${tournament.title} — ${stageTitle}`)
      .setColor(0xff6b35);

    if (bracket.currentStage === 'groups') {
      let mainDesc = '';
      for (const group of standings.groups) {
        mainDesc += `**${group.name}** (${group.gamesComplete}/${group.totalGames} games)\n`;
        mainDesc += '```\n';
        mainDesc += 'Rank Team             Pts  Games\n';
        mainDesc += '─'.repeat(34) + '\n';

        const displayStandings = group.standings.slice(0, 10);
        displayStandings.forEach((s, i) => {
          const name = getName(s.team) || 'Unknown';
          const displayName = name.length > 15 ? name.substring(0, 12) + '...' : name.padEnd(15);
          const pts = String(s.points).padEnd(4);
          const games = String(s.gamesPlayed);
          const advancing = i < standings.advancingPerGroup ? '→' : ' ';
          mainDesc += `${String(i + 1).padStart(2)}${advancing} ${displayName} ${pts} ${games}\n`;
        });
        mainDesc += '```\n';
      }

      if (mainDesc.length > 4000) {
        mainDesc = mainDesc.substring(0, 3900) + '\n...truncated';
      }
      mainEmbed.setDescription(mainDesc);
      mainEmbed.setFooter({ text: `→ = advancing to finals (top ${standings.advancingPerGroup} per group)` });

    } else if (bracket.currentStage === 'finals' && standings.finals) {
      let finalsDesc = `**Finals** (${standings.finals.gamesComplete}/${standings.finals.totalGames} games)\n\n`;
      finalsDesc += '```\n';
      finalsDesc += 'Rank Team             Pts  Games  From\n';
      finalsDesc += '─'.repeat(44) + '\n';

      const displayStandings = standings.finals.standings.slice(0, 20);
      displayStandings.forEach((s, i) => {
        const name = getName(s.team) || 'Unknown';
        const displayName = name.length > 15 ? name.substring(0, 12) + '...' : name.padEnd(15);
        const pts = String(s.points).padEnd(4);
        const games = String(s.gamesPlayed).padEnd(5);
        const from = (s.team.qualifiedFrom || '').substring(0, 5);
        finalsDesc += `${String(i + 1).padStart(2)}   ${displayName} ${pts} ${games}  ${from}\n`;
      });
      finalsDesc += '```';

      mainEmbed.setDescription(finalsDesc);

    } else if (bracket.currentStage === 'complete') {
      const results = battleRoyale.getResults(bracket);
      let completeDesc = '🏆 **Tournament Complete!**\n\n';

      if (results) {
        const winnerName = getName(results.winner);
        const runnerUpName = getName(results.runnerUp);
        const thirdName = getName(results.thirdPlace);

        completeDesc += `🥇 **Champion:** ${winnerName}\n`;
        completeDesc += `🥈 **Runner-up:** ${runnerUpName}\n`;
        if (thirdName) completeDesc += `🥉 **3rd Place:** ${thirdName}\n`;
      }

      mainEmbed.setDescription(completeDesc);
    }

    embeds.push(mainEmbed);

    const activeGames = battleRoyale.getActiveMatches(bracket);
    if (activeGames.length > 0) {
      const gamesEmbed = new EmbedBuilder()
        .setTitle('Pending Games')
        .setColor(0xff6b35);

      let gamesDesc = '';
      for (const game of activeGames.slice(0, 10)) {
        gamesDesc += `**${game.groupName}** - Game ${game.gameNumber} (${game.teamCount} teams)\n`;
      }
      if (activeGames.length > 10) {
        gamesDesc += `\n*...and ${activeGames.length - 10} more games*`;
      }

      gamesEmbed.setDescription(gamesDesc);
      embeds.push(gamesEmbed);
    }

  } else if (bracket.type === 'single_elimination') {
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${tournament.title} — Bracket`)
      .setColor(0x3498db);

    let description = '';
    for (const round of bracket.rounds) {
      description += `**${round.name}**\n`;
      for (const match of round.matches) {
        const p1 = getName(match.participant1) || 'TBD';
        const p2 = getName(match.participant2) || 'TBD';
        const winner = match.winner ? `✓ ${getName(match.winner)}` : '';

        if (match.isBye) {
          description += `#${match.matchNumber}: ${p1} (bye)\n`;
        } else {
          description += `#${match.matchNumber}: ${p1} vs ${p2} ${winner}\n`;
        }
      }
      description += '\n';
    }

    embed.setDescription(description.substring(0, 4000));
    embeds.push(embed);

  } else if (bracket.type === 'double_elimination') {
    const wbEmbed = new EmbedBuilder()
      .setTitle(`📊 ${tournament.title} — Winners Bracket`)
      .setColor(0x2ecc71);

    let wbDesc = '';
    for (const round of bracket.winnersRounds) {
      wbDesc += `**${round.name}**\n`;
      for (const match of round.matches) {
        const p1 = getName(match.participant1) || 'TBD';
        const p2 = getName(match.participant2) || 'TBD';
        const winner = match.winner ? `✓ ${getName(match.winner)}` : '';

        if (match.isBye) {
          wbDesc += `#${match.matchNumber}: ${p1} (bye)\n`;
        } else {
          wbDesc += `#${match.matchNumber}: ${p1} vs ${p2} ${winner}\n`;
        }
      }
      wbDesc += '\n';
    }
    wbEmbed.setDescription(wbDesc.substring(0, 4000));
    embeds.push(wbEmbed);

    const lbEmbed = new EmbedBuilder()
      .setTitle(`📊 ${tournament.title} — Losers Bracket`)
      .setColor(0xe74c3c);

    let lbDesc = '';
    for (const round of bracket.losersRounds) {
      lbDesc += `**${round.name}**\n`;
      for (const match of round.matches) {
        const p1 = getName(match.participant1) || 'TBD';
        const p2 = getName(match.participant2) || 'TBD';
        const winner = match.winner ? `✓ ${getName(match.winner)}` : '';
        lbDesc += `#${match.matchNumber}: ${p1} vs ${p2} ${winner}\n`;
      }
      lbDesc += '\n';
    }
    lbEmbed.setDescription(lbDesc.substring(0, 4000) || 'No matches yet');
    embeds.push(lbEmbed);

    const gfEmbed = new EmbedBuilder()
      .setTitle(`📊 ${tournament.title} — Grand Finals`)
      .setColor(0xf1c40f);

    let gfDesc = '';
    for (const round of bracket.grandFinalsRounds) {
      const match = round.matches[0];
      if (match.isReset && !bracket.needsReset) continue;

      const p1 = getName(match.participant1) || 'TBD';
      const p2 = getName(match.participant2) || 'TBD';
      const winner = match.winner ? `✓ ${getName(match.winner)}` : '';
      gfDesc += `**${round.name}**\n`;
      gfDesc += `#${match.matchNumber}: ${p1} vs ${p2} ${winner}\n\n`;
    }
    gfEmbed.setDescription(gfDesc || 'Waiting for finalists');
    embeds.push(gfEmbed);
  }

  return embeds;
}

// Export buildBracketEmbeds for use by /match bracket
module.exports.buildBracketEmbeds = buildBracketEmbeds;

// ─── Seeding (moved from /seeding) ──────────────────────────────────────────

async function handleSeedSet(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const participantId = interaction.options.getString('participant');
  const seed = interaction.options.getInteger('seed');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!tournament.settings.seedingEnabled) {
    return interaction.reply({ content: '❌ Seeding is not enabled for this tournament.', ephemeral: true });
  }

  const isSolo = tournament.settings.teamSize === 1;
  const list = isSolo ? tournament.participants : tournament.teams;
  const maxSeed = list.length;

  if (seed > maxSeed) {
    return interaction.reply({ content: `❌ Seed must be between 1 and ${maxSeed}.`, ephemeral: true });
  }

  const seedTaken = list.find(p => p.seed === seed && p.id !== participantId);
  if (seedTaken) {
    const takenName = isSolo ? seedTaken.username : seedTaken.name;
    return interaction.reply({ content: `❌ Seed ${seed} is already assigned to **${takenName}**.`, ephemeral: true });
  }

  const participant = list.find(p => p.id === participantId);
  if (!participant) {
    return interaction.reply({ content: '❌ Participant not found.', ephemeral: true });
  }

  participant.seed = seed;

  if (isSolo) {
    updateTournament(tournamentId, { participants: tournament.participants });
  } else {
    updateTournament(tournamentId, { teams: tournament.teams });
  }

  const name = isSolo ? participant.username : participant.name;
  return interaction.reply({
    content: `✅ Set **${name}** to seed **#${seed}**.`,
    ephemeral: true,
  });
}

async function handleSeedList(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  const isSolo = tournament.settings.teamSize === 1;
  const list = isSolo ? tournament.participants : tournament.teams;

  if (list.length === 0) {
    return interaction.reply({ content: '❌ No participants registered.', ephemeral: true });
  }

  const seeded = list.filter(p => p.seed !== null).sort((a, b) => a.seed - b.seed);
  const unseeded = list.filter(p => p.seed === null);

  const embed = new EmbedBuilder()
    .setTitle(`🌱 Seeding for ${tournament.title}`)
    .setColor(0x3498db);

  let description = '';

  for (const p of seeded) {
    const name = isSolo ? p.username : p.name;
    description += `**${p.seed}.** ${name} ⭐\n`;
  }

  if (unseeded.length > 0) {
    const start = seeded.length + 1;
    const end = list.length;
    description += `\n**${start}-${end}.** (Unseeded - will be randomized)\n`;
    for (const p of unseeded) {
      const name = isSolo ? p.username : p.name;
      description += `  • ${name}\n`;
    }
  }

  description += '\n⭐ = Manually seeded';

  embed.setDescription(description);

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleSeedRandomize(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  const isSolo = tournament.settings.teamSize === 1;
  const list = isSolo ? tournament.participants : tournament.teams;

  const seeded = list.filter(p => p.seed !== null);
  const unseeded = list.filter(p => p.seed === null);

  if (unseeded.length === 0) {
    return interaction.reply({ content: '❌ All participants are already seeded.', ephemeral: true });
  }

  const takenSeeds = new Set(seeded.map(p => p.seed));

  const availableSeeds = [];
  for (let i = 1; i <= list.length; i++) {
    if (!takenSeeds.has(i)) {
      availableSeeds.push(i);
    }
  }

  for (let i = availableSeeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [availableSeeds[i], availableSeeds[j]] = [availableSeeds[j], availableSeeds[i]];
  }

  for (let i = 0; i < unseeded.length; i++) {
    unseeded[i].seed = availableSeeds[i];
  }

  if (isSolo) {
    updateTournament(tournamentId, { participants: tournament.participants });
  } else {
    updateTournament(tournamentId, { teams: tournament.teams });
  }

  return interaction.reply({
    content: `✅ Randomized seeds for ${unseeded.length} participants.`,
    ephemeral: true,
  });
}

async function handleSeedClear(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  const isSolo = tournament.settings.teamSize === 1;
  const list = isSolo ? tournament.participants : tournament.teams;

  for (const p of list) {
    p.seed = null;
  }

  if (isSolo) {
    updateTournament(tournamentId, { participants: tournament.participants });
  } else {
    updateTournament(tournamentId, { teams: tournament.teams });
  }

  return interaction.reply({
    content: `✅ Cleared all seeds for **${tournament.title}**.`,
    ephemeral: true,
  });
}
