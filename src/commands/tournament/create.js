const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { getPresetKeys, getFeaturedPresetKeys, getMenuEmoji, GAME_PRESETS } = require('../../config/gamePresets');
const { getTournament, getActiveTournaments, updateTournament } = require('../../services/tournamentService');
const { canManageTournaments } = require('../../utils/permissions');
const { createTournamentEmbed } = require('../../utils/embedBuilder');
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
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Announce this tournament in a specific channel (e.g. a region channel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create-advanced')
        .setDescription('Create a new tournament with full customization (guided wizard)')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Announce this tournament in a specific channel (e.g. a region channel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
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
        .setName('edit')
        .setDescription('Edit a tournament (title, date, size, best-of, description)')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament to edit')
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
        .setName('bracket')
        .setDescription('View bracket/standings')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create-rooms')
        .setDescription('(Re)create any missing match rooms for the current round')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disqualify')
        .setDescription('Disqualify a player/team — remaining matches are forfeited')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName('participant')
            .setDescription('Player or team to disqualify')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason (shown to admins)')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('correct')
        .setDescription('Correct a wrongly reported match result')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption(option =>
          option.setName('match_number')
            .setDescription('Match number to correct')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('winner')
            .setDescription('The actual winner')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName('score')
            .setDescription('Corrected score (e.g., "2-1")')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove-player')
        .setDescription('Remove a player from a tournament (before it starts)')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName('participant')
            .setDescription('Player to remove')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove-team')
        .setDescription('Remove a team from a tournament (before it starts)')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName('team')
            .setDescription('Team to remove')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add-player')
        .setDescription('Manually register a real player (solo tournaments)')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The Discord user to register')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('game_nick')
            .setDescription('In-game nickname (if the tournament requires one)')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add-team')
        .setDescription('Manually register a real team')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Team name')
            .setRequired(true)
        )
        .addUserOption(option =>
          option.setName('captain')
            .setDescription('Team captain')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('members')
            .setDescription('Other members: @mentions or usernames, separated by spaces/commas')
            .setRequired(true)
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
    const adminSubcommands = ['create', 'create-advanced', 'start', 'cancel', 'edit', 'report', 'disqualify', 'correct', 'add-player', 'add-team', 'remove-player', 'remove-team', 'create-rooms'];
    const adminSeedSubcommands = ['set', 'randomize', 'clear'];

    const needsPermCheck = adminSubcommands.includes(subcommand) ||
      (group === 'seed' && adminSeedSubcommands.includes(subcommand));

    if (needsPermCheck && !(await canManageTournaments(interaction.member))) {
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
      case 'edit':
        await handleEdit(interaction);
        break;
      case 'start':
        await handleStart(interaction);
        break;
      case 'report':
        await handleReport(interaction);
        break;
      case 'bracket':
        await handleBracket(interaction);
        break;
      case 'disqualify':
        await handleDisqualify(interaction);
        break;
      case 'correct':
        await handleCorrect(interaction);
        break;
      case 'add-player':
        await handleAddPlayer(interaction);
        break;
      case 'add-team':
        await handleAddTeam(interaction);
        break;
      case 'remove-player':
      case 'remove-team':
        await handleRemoveEntrant(interaction);
        break;
      case 'create-rooms':
        await handleCreateRooms(interaction);
        break;
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const q = String(focused.value || '').toLowerCase();
    // Discord choice names must be 1–100 chars; any overflow (or an unhandled
    // throw) makes the client show "Loading options failed". Clip everything.
    const clip = (s) => String(s ?? '').slice(0, 100) || '—';
    const respondFiltered = (choices) =>
      interaction.respond(choices.filter(c => c.name.toLowerCase().includes(q)).slice(0, 25));

    try {
      if (focused.name === 'game') {
        const choices = getPresetKeys().map(key => ({
          name: clip(`${GAME_PRESETS[key].icon} ${GAME_PRESETS[key].displayName}`),
          value: key,
        }));
        choices.push({ name: '🎮 Other Game...', value: 'custom' });
        return respondFiltered(choices);
      }

      if (focused.name === 'tournament') {
        const tournaments = await getActiveTournaments(interaction.guildId);
        return respondFiltered(tournaments.map(t => ({
          name: clip(`${t.game?.icon || '🎮'} ${t.title || 'Untitled'}`),
          value: t.id,
        })));
      }

      if (focused.name === 'winner' || focused.name === 'participant') {
        const tournament = await getTournament(interaction.options.getString('tournament'));
        if (!tournament) return interaction.respond([]);
        if (focused.name === 'winner' && !tournament.bracket) return interaction.respond([]);
        const isSolo = tournament.settings.teamSize === 1;
        const list = isSolo ? tournament.participants : tournament.teams;
        return respondFiltered((list || []).map(p => ({
          name: clip(isSolo ? p.username : p.name),
          value: p.id,
        })));
      }

      if (focused.name === 'team') {
        const tournament = await getTournament(interaction.options.getString('tournament'));
        if (!tournament) return interaction.respond([]);
        return respondFiltered((tournament.teams || []).map(t => ({ name: clip(t.name), value: t.id })));
      }

      return interaction.respond([]);
    } catch (error) {
      console.error('[tournament autocomplete] failed:', error);
      try { await interaction.respond([]); } catch { /* expired */ }
    }
  },
};

// ─── Tournament Create ──────────────────────────────────────────────────────

/**
 * Optional per-tournament announcement channel (the `channel:` option on both
 * create commands). Validated up front so the admin hears about a permission
 * problem immediately, not after filling in the whole form.
 */
function validateAnnounceChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  if (!channel) return { channel: null };
  const me = interaction.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has('ViewChannel') || !perms?.has('SendMessages') || !perms?.has('EmbedLinks')) {
    return { error: `I can't post in ${channel} — I need **View Channel**, **Send Messages** and **Embed Links** there.` };
  }
  return { channel };
}

async function handleSimpleCreate(interaction) {
  const { channel: overrideChannel, error: channelError } = validateAnnounceChannel(interaction);
  if (channelError) {
    return interaction.reply({ content: `❌ ${channelError}`, ephemeral: true });
  }

  const featuredKeys = getFeaturedPresetKeys();
  const allKeys = getPresetKeys();
  const hasMoreGames = allKeys.length > featuredKeys.length;

  const options = featuredKeys.map(key => ({
    label: GAME_PRESETS[key].displayName,
    value: key,
    emoji: getMenuEmoji(GAME_PRESETS[key]),
    description: `${GAME_PRESETS[key].category ? GAME_PRESETS[key].category + ' • ' : ''}${GAME_PRESETS[key].defaultTeamSize > 1 ? `${GAME_PRESETS[key].defaultTeamSize}v${GAME_PRESETS[key].defaultTeamSize}` : 'Solo'}`,
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
    .setCustomId(overrideChannel ? `gameSelect:${overrideChannel.id}` : 'gameSelect')
    .setPlaceholder('Select a game')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: `🎮 **Create Tournament — Simple Mode**\n${overrideChannel ? `📣 Will be announced in ${overrideChannel}\n` : ''}\nSelect a game to get started:\n\n*Or use \`/tournament create-advanced\` for full customization.*`,
    components: [row],
    ephemeral: true,
  });
}

async function handleAdvancedCreate(interaction) {
  const { createSession, updateSession } = require('../../data/wizardSessions');
  const { getPresetKeys, getFeaturedPresetKeys } = require('../../config/gamePresets');
  const { checkFeature } = require('../../services/subscriptionService');

  const { channel: overrideChannel, error: channelError } = validateAnnounceChannel(interaction);
  if (channelError) {
    return interaction.reply({ content: `❌ ${channelError}`, ephemeral: true });
  }

  const session = await createSession(interaction.user.id, interaction.guildId);

  // Per-tournament announcement channel riding along in the wizard session
  if (overrideChannel) {
    await updateSession(session.id, { announcementChannelId: overrideChannel.id });
  }

  // Live web bracket (Pro/Business) defaults to ON when the tier allows it;
  // the settings screen exposes a toggle either way.
  const bracketEligible = (await checkFeature(interaction.guildId, 'public_bracket')).allowed;
  if (bracketEligible) {
    await updateSession(session.id, { publicBracket: true });
  }

  const featuredKeys = getFeaturedPresetKeys();
  const allKeys = getPresetKeys();
  const hasMoreGames = allKeys.length > featuredKeys.length;

  const options = featuredKeys.map(key => ({
    label: GAME_PRESETS[key].displayName,
    value: key,
    emoji: getMenuEmoji(GAME_PRESETS[key]),
    description: `${GAME_PRESETS[key].category ? GAME_PRESETS[key].category + ' • ' : ''}${GAME_PRESETS[key].defaultTeamSize > 1 ? `${GAME_PRESETS[key].defaultTeamSize}v${GAME_PRESETS[key].defaultTeamSize}` : 'Solo'}`,
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
    content: `🎮 **Create Tournament — Advanced Mode**\n${overrideChannel ? `📣 Will be announced in ${overrideChannel}\n` : ''}\nSelect a game to get started:`,
    components: [row],
    ephemeral: true,
  });
}

// ─── Tournament List / Info / Cancel / Start ────────────────────────────────

async function handleList(interaction) {
  const { getTournamentsByGuild } = require('../../services/tournamentService');

  const tournaments = await getTournamentsByGuild(interaction.guildId);

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
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  const embed = await createTournamentEmbed(tournament);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleCancel(interaction) {
  const { canEditTournament } = require('../../utils/permissions');
  const { cancelFlow } = require('../../services/lifecycleService');

  const tournamentId = interaction.options.getString('tournament');
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!(await canEditTournament(interaction.member, tournament))) {
    return interaction.reply({ content: '❌ You do not have permission to cancel this tournament.', ephemeral: true });
  }

  await interaction.deferReply();
  await cancelFlow({ client: interaction.client, tournament });
  await interaction.editReply({ content: `✅ Tournament **${tournament.title}** has been cancelled.` });
}

async function handleStart(interaction) {
  const { canEditTournament } = require('../../utils/permissions');
  const { startTournamentFlow, buildStartEmbed } = require('../../services/lifecycleService');

  const tournamentId = interaction.options.getString('tournament');
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!(await canEditTournament(interaction.member, tournament))) {
    return interaction.reply({ content: '❌ You do not have permission to start this tournament.', ephemeral: true });
  }

  // Fast-fail the common cases before deferring (the flow re-checks them)
  if (tournament.status !== 'registration' && tournament.status !== 'checkin') {
    return interaction.reply({ content: '❌ Tournament is not in registration/checkin phase.', ephemeral: true });
  }
  const isSolo = tournament.settings.teamSize === 1;
  if ((isSolo ? tournament.participants : tournament.teams).length < 2) {
    return interaction.reply({ content: '❌ Need at least 2 participants to start.', ephemeral: true });
  }

  await interaction.deferReply();

  try {
    const { tournament: started, summary } = await startTournamentFlow({
      client: interaction.client,
      guild: interaction.guild,
      tournamentId,
    });
    await interaction.editReply({ embeds: [buildStartEmbed(started, summary)] });
  } catch (error) {
    // startTournamentFlow already rolled the tournament back to its previous
    // status — just tell the admin.
    await interaction.editReply({ content: `❌ Error starting tournament: ${error.message}\n\nThe tournament has been returned to its previous state — you can try again.` });
  }
}

// ─── Tournament Edit ─────────────────────────────────────────────────────────

/** Render a Date as a string the edit modal can round-trip through parseDateTime. */
function toEditableUtc(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

async function handleEdit(interaction) {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

  const tournamentId = interaction.options.getString('tournament');
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (tournament.status !== 'registration' && tournament.status !== 'checkin') {
    return interaction.reply({
      content: '❌ Only tournaments in registration/check-in can be edited. Game and format are never editable.',
      ephemeral: true,
    });
  }

  const isSolo = tournament.settings.teamSize === 1;

  const modal = new ModalBuilder()
    .setCustomId(`editTournament:${tournamentId}`)
    .setTitle(`Edit: ${tournament.title.substring(0, 35)}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Tournament Title')
        .setStyle(TextInputStyle.Short)
        .setValue(tournament.title)
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('datetime')
        .setLabel('Date & Time (UTC)')
        .setStyle(TextInputStyle.Short)
        .setValue(toEditableUtc(tournament.startTime))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('maxParticipants')
        .setLabel(`Max ${isSolo ? 'Players' : 'Teams'}`)
        .setStyle(TextInputStyle.Short)
        .setValue(String(tournament.settings.maxParticipants))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('bestOf')
        .setLabel('Best Of (odd number, e.g. 1, 3, 5, 7)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(tournament.settings.bestOf))
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(tournament.description || '')
        .setRequired(false)
        .setMaxLength(1000)
    ),
  );

  return interaction.showModal(modal);
}

// ─── Disqualification / Correction / Manual registration ────────────────────

async function handleDisqualify(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getString('tournament');
  const participantId = interaction.options.getString('participant');
  const reason = interaction.options.getString('reason');

  const tournament = await getTournament(tournamentId);
  if (!tournament) return interaction.editReply({ content: '❌ Tournament not found.' });

  const { disqualifyFlow } = require('../../services/lifecycleService');
  let result;
  try {
    result = await disqualifyFlow({ client: interaction.client, tournament, participantId, reason });
  } catch (error) {
    return interaction.editReply({ content: `❌ ${error.message}` });
  }

  let response = `🚫 **${result.name}** has been disqualified from **${tournament.title}**` + (reason ? ` — ${reason}` : '') + '.';
  if (result.forfeited > 0) response += `\n${result.forfeited} match${result.forfeited > 1 ? 'es' : ''} forfeited (opponent wins ${result.bestOf > 1 ? `${Math.ceil(result.bestOf / 2)}-0` : 'by walkover'}).`;
  if (result.pending > 0) response += `\n${result.pending} upcoming match will forfeit automatically when the opponent is decided.`;

  return interaction.editReply({ content: response });
}

async function handleCorrect(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getString('tournament');
  const matchNumber = interaction.options.getInteger('match_number');
  const winnerId = interaction.options.getString('winner');
  const score = interaction.options.getString('score');

  const tournament = await getTournament(tournamentId);
  if (!tournament) return interaction.editReply({ content: '❌ Tournament not found.' });

  const { correctMatchFlow } = require('../../services/lifecycleService');
  let result;
  try {
    result = await correctMatchFlow({ client: interaction.client, tournament, matchNumber, winnerId, score });
  } catch (error) {
    return interaction.editReply({ content: `❌ ${error.message}` });
  }

  let response = `✏️ **Match #${matchNumber}** corrected: **${result.newWinnerName}** wins`;
  if (result.normalizedScore) response += ` (${result.normalizedScore})`;
  if (result.oldWinnerName !== result.newWinnerName) {
    response += `\nPrevious result: ${result.oldWinnerName}${result.oldScore ? ` (${result.oldScore})` : ''}`;
  }
  if (result.wasCompleted) {
    response += '\n⚠️ The tournament was already completed — the original completion announcement is not reposted.';
  }
  return interaction.editReply({ content: response });
}

async function handleAddPlayer(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getString('tournament');
  const user = interaction.options.getUser('user');
  const gameNick = interaction.options.getString('game_nick');

  const tournament = await getTournament(tournamentId);
  if (!tournament) return interaction.editReply({ content: '❌ Tournament not found.' });
  if (tournament.settings.teamSize > 1) {
    return interaction.editReply({ content: '❌ This is a team tournament — use `/tournament add-team`.' });
  }
  if (tournament.settings.requireGameNick && !gameNick) {
    return interaction.editReply({ content: '❌ This tournament requires an in-game nickname — pass `game_nick:`.' });
  }

  const { addParticipant } = require('../../services/tournamentService');
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const result = await addParticipant(tournamentId, {
    id: user.id,
    username: user.username,
    displayName: member?.displayName || user.username,
    gameNick: gameNick || null,
  });
  if (!result.success) return interaction.editReply({ content: `❌ ${result.error}` });

  const { updateTournamentMessages } = require('../../utils/tournamentUpdater');
  await updateTournamentMessages(interaction.client, result.tournament);

  try {
    await user.send(`✅ You've been registered for **${tournament.title}** by a tournament admin.`);
  } catch {}

  return interaction.editReply({ content: `✅ Registered **${user.username}** for **${tournament.title}**. (${result.tournament.participants.length}/${tournament.settings.maxParticipants})` });
}

async function handleAddTeam(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getString('tournament');
  const teamName = interaction.options.getString('name');
  const captainUser = interaction.options.getUser('captain');
  const membersInput = interaction.options.getString('members');

  const tournament = await getTournament(tournamentId);
  if (!tournament) return interaction.editReply({ content: '❌ Tournament not found.' });
  if (tournament.settings.teamSize === 1) {
    return interaction.editReply({ content: '❌ This is a solo tournament — use `/tournament add-player`.' });
  }

  // Resolve every member to a REAL server member (mentions or usernames)
  const tokens = membersInput.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  const resolved = [];
  const notFound = [];
  for (const token of tokens) {
    const mention = token.match(/^<@!?(\d+)>$/);
    let member = null;
    if (mention) {
      member = await interaction.guild.members.fetch(mention[1]).catch(() => null);
    } else {
      const clean = token.replace(/^@/, '');
      member = interaction.guild.members.cache.find(m =>
        m.user.username.toLowerCase() === clean.toLowerCase() ||
        m.displayName.toLowerCase() === clean.toLowerCase()
      );
      if (!member) {
        try {
          const fetched = await interaction.guild.members.fetch({ query: clean, limit: 5 });
          member = fetched.find(m =>
            m.user.username.toLowerCase() === clean.toLowerCase() ||
            m.displayName.toLowerCase() === clean.toLowerCase()
          );
        } catch {}
      }
    }
    if (member) resolved.push({ id: member.id, username: member.user.username, displayName: member.displayName });
    else notFound.push(token);
  }

  if (notFound.length > 0) {
    return interaction.editReply({ content: `❌ Could not find these members in the server: **${notFound.join(', ')}**. Manual adds require real server members — use @mentions to be safe.` });
  }

  const captainMember = await interaction.guild.members.fetch(captainUser.id).catch(() => null);
  const captain = {
    id: captainUser.id,
    username: captainUser.username,
    displayName: captainMember?.displayName || captainUser.username,
    gameNick: null,
  };

  const allMembers = [captain, ...resolved.filter(m => m.id !== captain.id)];
  if (allMembers.length !== tournament.settings.teamSize) {
    return interaction.editReply({ content: `❌ Teams need exactly ${tournament.settings.teamSize} players — you provided ${allMembers.length} (captain + members).` });
  }

  const { addTeam } = require('../../services/tournamentService');
  const result = await addTeam(tournamentId, { name: teamName, captain, members: allMembers });
  if (!result.success) return interaction.editReply({ content: `❌ ${result.error}` });

  const { updateTournamentMessages } = require('../../utils/tournamentUpdater');
  await updateTournamentMessages(interaction.client, result.tournament);

  for (const m of allMembers) {
    try {
      const u = await interaction.client.users.fetch(m.id);
      await u.send(`✅ You've been registered on team **${teamName}** for **${tournament.title}** by a tournament admin.`);
    } catch {}
  }

  return interaction.editReply({ content: `✅ Team **${teamName}** registered for **${tournament.title}**. (${result.tournament.teams.length}/${tournament.settings.maxParticipants})` });
}

async function handleRemoveEntrant(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getString('tournament');
  const subcommand = interaction.options.getSubcommand();
  const entrantId = interaction.options.getString(subcommand === 'remove-team' ? 'team' : 'participant');

  const tournament = await getTournament(tournamentId);
  if (!tournament) return interaction.editReply({ content: '❌ Tournament not found.' });

  const isSolo = tournament.settings.teamSize === 1;
  if (subcommand === 'remove-team' && isSolo) {
    return interaction.editReply({ content: '❌ This is a solo tournament — use `/tournament remove-player`.' });
  }
  if (subcommand === 'remove-player' && !isSolo) {
    return interaction.editReply({ content: '❌ This is a team tournament — use `/tournament remove-team`.' });
  }

  const { removeEntrantFlow } = require('../../services/lifecycleService');
  let result;
  try {
    result = await removeEntrantFlow({ client: interaction.client, tournament, entrantId });
  } catch (error) {
    return interaction.editReply({ content: `❌ ${error.message}` });
  }

  return interaction.editReply({
    content: `✅ Removed ${isSolo ? '**' + result.name + '**' : 'team **' + result.name + '**'} from **${tournament.title}**. (${result.count}/${tournament.settings.maxParticipants})`,
  });
}

async function handleCreateRooms(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const tournamentId = interaction.options.getString('tournament');
  const tournament = await getTournament(tournamentId);
  if (!tournament) return interaction.editReply({ content: '❌ Tournament not found.' });

  const { createRoomsFlow } = require('../../services/lifecycleService');
  let result;
  try {
    result = await createRoomsFlow({ guild: interaction.guild, tournament });
  } catch (error) {
    return interaction.editReply({ content: `❌ ${error.message}` });
  }

  const { created, failed, existing } = result;
  let response = `🔧 **${tournament.title}** — match rooms:\n`;
  response += `• ${created} created\n`;
  if (existing > 0) response += `• ${existing} already existed\n`;
  if (failed > 0) {
    response += `• ⚠️ ${failed} still failed — confirm the bot has **Manage Channels** + **Manage Roles**, that its role sits above the others, and that the match-room category (if set) isn't full.`;
  } else if (created === 0 && existing > 0) {
    response += `\nAll current matches already have rooms. ✅`;
  } else if (created === 0 && existing === 0) {
    response += `\nNo active matches need rooms right now.`;
  }

  return interaction.editReply({ content: response });
}

// ─── Match Reporting (moved from /match) ────────────────────────────────────
// (getServiceForBracket lives in utils/matchUtils.js — shared everywhere.)

async function handleReport(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const tournamentId = interaction.options.getString('tournament');
  const matchNumber = interaction.options.getInteger('match_number');
  const winnerId = interaction.options.getString('winner');
  const score = interaction.options.getString('score');

  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    return interaction.editReply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!tournament.bracket) {
    return interaction.editReply({ content: '❌ Tournament has not started yet.', ephemeral: true });
  }

  const bracket = tournament.bracket;

  const { findMatchByNumber, normalizeSeriesScore } = require('../../utils/matchUtils');
  const match = findMatchByNumber(bracket, matchNumber);

  if (!match) {
    return interaction.editReply({ content: '❌ Match not found.', ephemeral: true });
  }

  if (match.winner) {
    return interaction.editReply({ content: '❌ This match has already been reported.', ephemeral: true });
  }

  const p1Id = match.participant1?.id;
  const p2Id = match.participant2?.id;

  if (winnerId !== p1Id && winnerId !== p2Id) {
    return interaction.editReply({ content: '❌ Selected winner is not in this match.', ephemeral: true });
  }

  const isSolo = tournament.settings.teamSize === 1;

  // Bo3+ requires a valid series score (winner-first); Bo1 keeps the free-form
  // optional score (useful for map scores like 16-14).
  const scoreResult = normalizeSeriesScore(score, tournament.settings.bestOf || 1);
  if (!scoreResult.ok) {
    return interaction.editReply({ content: `❌ ${scoreResult.error}`, ephemeral: true });
  }

  try {
    const { applyMatchReport } = require('../../services/lifecycleService');
    const result = await applyMatchReport({
      client: interaction.client,
      guild: interaction.guild,
      tournament,
      match,
      winnerId,
      score: scoreResult.score,
    });

    const winnerName = isSolo ? result.winner?.username : result.winner?.name;
    const loserName = isSolo ? result.loser?.username : result.loser?.name;

    let response = `✅ **Match #${matchNumber}** reported: **${winnerName}** defeats **${loserName}**`;
    if (scoreResult.score) response += ` (${scoreResult.score})`;

    if (result.swissRoundStarted) {
      response += `\n\n📋 **Round ${result.swissRoundStarted} started!** Use \`/match list\` to see new matches.`;
    }
    if (result.newRooms > 0) {
      response += `\n🚪 ${result.newRooms} new match room${result.newRooms > 1 ? 's' : ''} created.`;
    }

    if (result.completed) {
      const champName = isSolo ? result.results.winner?.username : result.results.winner?.name;
      response += `\n\n🏆 **Tournament Complete!** Champion: **${champName}**`;
      const { getBracketUrl } = require('../../utils/embedBuilder');
      const finalBracketUrl = getBracketUrl(tournament);
      if (finalBracketUrl) {
        response += `\n🌐 Full bracket: ${finalBracketUrl}`;
      }
    }

    return interaction.editReply({ content: response });

  } catch (error) {
    console.error('Error reporting match:', error);
    return interaction.editReply({ content: `❌ Error: ${error.message}`, ephemeral: true });
  }
}

async function handleBracket(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = await getTournament(tournamentId);

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
        const status = match.winner ? `✓ ${getName(match.winner)}${match.score ? ` (${match.score})` : ''}${match.isDQ ? ' · DQ' : ''}` : (match.isBye ? '(bye)' : '');
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
        const status = match.winner ? `✓ ${getName(match.winner)}${match.score ? ` (${match.score})` : ''}${match.isDQ ? ' · DQ' : ''}` : '';
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
        const winner = match.winner ? `✓ ${getName(match.winner)}${match.score ? ` (${match.score})` : ''}${match.isDQ ? ' · DQ' : ''}` : '';

        if (match.isBye) {
          description += `#${match.matchNumber}: ${p1} (bye)\n`;
        } else {
          description += `#${match.matchNumber}: ${p1} vs ${p2} ${winner}\n`;
        }
      }
      description += '\n';
    }

    const tp = bracket.thirdPlaceMatch;
      if (tp) {
        const p1 = getName(tp.participant1) || 'TBD';
        const p2 = getName(tp.participant2) || 'TBD';
        const winner = tp.winner ? `✓ ${getName(tp.winner)}${tp.score ? ` (${tp.score})` : ''}${tp.isDQ ? ' · DQ' : ''}` : '';
        description += `**Third Place Match**\n#${tp.matchNumber}: ${p1} vs ${p2} ${winner}\n\n`;
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
        const winner = match.winner ? `✓ ${getName(match.winner)}${match.score ? ` (${match.score})` : ''}${match.isDQ ? ' · DQ' : ''}` : '';

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
        const winner = match.winner ? `✓ ${getName(match.winner)}${match.score ? ` (${match.score})` : ''}${match.isDQ ? ' · DQ' : ''}` : '';
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
      const winner = match.winner ? `✓ ${getName(match.winner)}${match.score ? ` (${match.score})` : ''}${match.isDQ ? ' · DQ' : ''}` : '';
      gfDesc += `**${round.name}**\n`;
      gfDesc += `#${match.matchNumber}: ${p1} vs ${p2} ${winner}\n\n`;
    }
    gfEmbed.setDescription(gfDesc || 'Waiting for finalists');
    embeds.push(gfEmbed);
  }

  // Append the live web bracket link (Pro/Business, when enabled)
  const { getBracketUrl } = require('../../utils/embedBuilder');
  const bracketUrl = getBracketUrl(tournament);
  if (bracketUrl) {
    embeds.push(new EmbedBuilder()
      .setColor(0xff154d)
      .setDescription(`🌐 **Live web bracket:** ${bracketUrl}`));
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
  const tournament = await getTournament(tournamentId);

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
    await updateTournament(tournamentId, { participants: tournament.participants });
  } else {
    await updateTournament(tournamentId, { teams: tournament.teams });
  }

  const name = isSolo ? participant.username : participant.name;
  return interaction.reply({
    content: `✅ Set **${name}** to seed **#${seed}**.`,
    ephemeral: true,
  });
}

async function handleSeedList(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = await getTournament(tournamentId);

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
  const tournament = await getTournament(tournamentId);

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
    await updateTournament(tournamentId, { participants: tournament.participants });
  } else {
    await updateTournament(tournamentId, { teams: tournament.teams });
  }

  return interaction.reply({
    content: `✅ Randomized seeds for ${unseeded.length} participants.`,
    ephemeral: true,
  });
}

async function handleSeedClear(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  const isSolo = tournament.settings.teamSize === 1;
  const list = isSolo ? tournament.participants : tournament.teams;

  for (const p of list) {
    p.seed = null;
  }

  if (isSolo) {
    await updateTournament(tournamentId, { participants: tournament.participants });
  } else {
    await updateTournament(tournamentId, { teams: tournament.teams });
  }

  return interaction.reply({
    content: `✅ Cleared all seeds for **${tournament.title}**.`,
    ephemeral: true,
  });
}
