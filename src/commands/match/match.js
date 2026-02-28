const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTournament, getActiveTournaments } = require('../../services/tournamentService');
const singleElim = require('../../services/singleEliminationService');
const doubleElim = require('../../services/doubleEliminationService');
const swiss = require('../../services/swissService');
const roundRobin = require('../../services/roundRobinService');
const battleRoyale = require('../../services/battleRoyaleService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('match')
    .setDescription('View matches and brackets')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List active matches in a tournament')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
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
        .setName('games')
        .setDescription('List pending Battle Royale games')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'list':
        await handleList(interaction);
        break;
      case 'bracket':
        await handleBracket(interaction);
        break;
      case 'games':
        await handleGames(interaction);
        break;
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

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
  },
};

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

async function handleList(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!tournament.bracket) {
    return interaction.reply({ content: '❌ Tournament has not started yet.', ephemeral: true });
  }

  const bracket = tournament.bracket;

  if (bracket.type === 'battle_royale') {
    return interaction.reply({
      content: 'Use `/match games` to see pending Battle Royale games.',
      ephemeral: true,
    });
  }

  const service = getServiceForBracket(bracket);
  const activeMatches = service.getActiveMatches(bracket);

  if (activeMatches.length === 0) {
    return interaction.reply({ content: 'No active matches at the moment.', ephemeral: true });
  }

  const isSolo = tournament.settings.teamSize === 1;

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Active Matches — ${tournament.title}`)
    .setColor(0x3498db);

  const lines = activeMatches.map(m => {
    const p1 = isSolo ? m.participant1?.username : m.participant1?.name;
    const p2 = isSolo ? m.participant2?.username : m.participant2?.name;
    const roundLabel = m.roundName || `Round ${m.roundNumber}`;
    return `**#${m.matchNumber}** ${roundLabel}\n${p1 || 'TBD'} vs ${p2 || 'TBD'}`;
  });

  embed.setDescription(lines.join('\n\n'));

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleBracket(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (!tournament.bracket) {
    return interaction.reply({ content: '❌ Tournament has not started yet.', ephemeral: true });
  }

  const { buildBracketEmbeds } = require('../tournament/create');
  const embeds = buildBracketEmbeds(tournament);
  return interaction.reply({ embeds, ephemeral: true });
}

async function handleGames(interaction) {
  const tournamentId = interaction.options.getString('tournament');
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
  const activeGames = battleRoyale.getActiveMatches(bracket);

  if (activeGames.length === 0) {
    const stageText = bracket.currentStage === 'complete' ? 'Tournament complete!' : 'No pending games.';
    return interaction.reply({ content: stageText, ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎮 Pending Games — ${tournament.title}`)
    .setColor(0xff6b35);

  let description = `**Stage:** ${bracket.currentStage === 'finals' ? 'Grand Finals' : 'Groups'}\n\n`;

  for (const game of activeGames) {
    description += `**${game.groupName}** - Game ${game.gameNumber} (${game.teamCount} teams)\n`;
  }

  description += `\n**To report results (admin):**\n`;
  description += `\`/tournament br-report placements:1,5,3,2,...\`\n\n`;
  description += `Use lobby numbers shown in each game room.\n`;
  description += `💡 Only need to report top placements - rest auto-fill.`;

  embed.setDescription(description);

  return interaction.reply({ embeds: [embed], ephemeral: true });
}
