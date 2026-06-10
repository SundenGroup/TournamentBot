const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTournament, updateTournament } = require('../services/tournamentService');
const { canManageTournaments } = require('../utils/permissions');
const singleElim = require('../services/singleEliminationService');
const doubleElim = require('../services/doubleEliminationService');
const swiss = require('../services/swissService');
const roundRobin = require('../services/roundRobinService');
const battleRoyale = require('../services/battleRoyaleService');
const { createMatchRoom } = require('../services/channelService');
const { createTournamentEmbed, createTournamentButtons, getBracketUrl } = require('../utils/embedBuilder');
const webhooks = require('../services/webhookService');

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

function findBracketMatch(bracket, matchId) {
  if (bracket.type === 'double_elimination') return doubleElim.findMatch(bracket, matchId);
  if (bracket.type === 'swiss') return swiss.findMatch(bracket, matchId);
  if (bracket.type === 'round_robin') return roundRobin.findMatch(bracket, matchId);
  return singleElim.findMatch(bracket, matchId);
}

/**
 * Valid series scores for a best-of: the winner takes ceil(bo/2) games,
 * the loser anywhere from 0 to floor(bo/2). Bo3 → 2-0, 2-1; Bo5 → 3-0..3-2.
 */
function validSeriesScores(bestOf) {
  const need = Math.ceil(bestOf / 2);
  const scores = [];
  for (let l = 0; l < need; l++) scores.push(`${need}-${l}`);
  return scores;
}

/**
 * Complete a match report: advance the bracket, notify walkovers/byes,
 * persist, fire webhooks, refresh rooms/announcements. `interaction` must be
 * a component interaction on the match-room message (it gets updated).
 * Shared by the direct Bo1 win buttons and the Bo>1 score picker.
 */
async function finalizeMatchReport(interaction, tournament, match, winner, score) {
  const bracket = tournament.bracket;
  const service = getServiceForBracket(bracket);
  const tournamentId = tournament.id;
  const isSolo = tournament.settings.teamSize === 1;

  service.advanceWinner(bracket, match.id, winner.id, score);

  // Forfeit any matches a disqualified player just arrived in
  const { resolvePendingDQs } = require('../services/disqualifyService');
  resolvePendingDQs(tournament);

  // A reported result can cascade walkovers (double-elim losers bracket) —
  // DM anyone who just advanced without playing, then persist the flags.
  const { notifyByesAndWalkovers } = require('../utils/byeNotifier');
  await notifyByesAndWalkovers(interaction.client, tournament);

  await updateTournament(tournamentId, { bracket });

  const winnerName = isSolo ? winner.username : winner.name;
  const loser = match.participant1?.id === winner.id ? match.participant2 : match.participant1;
  const loserName = isSolo ? loser?.username : loser?.name;

  webhooks.onMatchCompleted(tournament, {
    id: match.id,
    round: match.round,
    winner,
    loser,
    score: match.score,
  });

  // Update the match room message
  await interaction.update({
    content: `✅ **Match Complete!**\n\n🏆 **${winnerName}** defeats **${loserName}**${score ? ` **(${score})**` : ''}`,
    components: [],
  });

  // For Swiss: check if round complete and generate next round
  if (bracket.type === 'swiss' && service.isRoundComplete(bracket)) {
    if (bracket.currentRound < bracket.totalRounds) {
      service.generateNextRound(bracket);
      // A new Swiss round may hand someone a bye — DM them
      await notifyByesAndWalkovers(interaction.client, tournament);
    }
  }

  // Check if tournament is complete
  if (service.isComplete(bracket)) {
    const results = service.getResults(bracket);
    await announceTournamentComplete(interaction, tournament, results);
    await updateTournament(tournamentId, { status: 'completed', standings: results.standings || [] });

    webhooks.onTournamentCompleted(tournament, results.standings || [results.winner, results.runnerUp, results.thirdPlace].filter(Boolean));

    await updateTournamentAnnouncement(interaction.client, tournament);
    return;
  }

  // Create new match rooms for newly ready matches
  const activeMatches = service.getActiveMatches(bracket);
  for (const activeMatch of activeMatches) {
    if (!activeMatch.channelId && activeMatch.participant1 && activeMatch.participant2) {
      try {
        const channel = await createMatchRoom(interaction.guild, activeMatch, tournament);
        activeMatch.channelId = channel.id;
      } catch (error) {
        console.error('Error creating match room:', error);
      }
    }
  }

  await updateTournament(tournamentId, { bracket });
}

module.exports = {
  customId: 'matchWin',
  async execute(interaction, args) {
    const [tournamentId, matchId, winnerSlot] = args;
    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }

    // Check permissions - admin only
    if (!(await canManageTournaments(interaction.member))) {
      return interaction.reply({ content: '❌ Only tournament admins can report match results.', ephemeral: true });
    }

    const bracket = tournament.bracket;
    if (!bracket) {
      return interaction.reply({ content: '❌ Bracket not found.', ephemeral: true });
    }

    const match = findBracketMatch(bracket, matchId);

    if (!match) {
      return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
    }

    if (match.winner) {
      return interaction.reply({ content: '❌ This match has already been reported.', ephemeral: true });
    }

    const winner = winnerSlot === '1' ? match.participant1 : match.participant2;
    if (!winner) {
      return interaction.reply({ content: '❌ Invalid winner selection.', ephemeral: true });
    }

    const isSolo = tournament.settings.teamSize === 1;
    const winnerName = isSolo ? winner.username : winner.name;
    const bestOf = tournament.settings.bestOf || 1;

    try {
      // Bo1: report directly, no series score. Bo3+: ask for the series score.
      if (bestOf <= 1) {
        return await finalizeMatchReport(interaction, tournament, match, winner, null);
      }

      const rows = [];
      let row = new ActionRowBuilder();
      for (const s of validSeriesScores(bestOf)) {
        if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`matchScore:${tournamentId}:${matchId}:${winnerSlot}:${s}`)
            .setLabel(s)
            .setStyle(ButtonStyle.Primary)
        );
      }
      if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`matchScore:${tournamentId}:${matchId}:cancel`)
          .setLabel('Back')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
      );
      rows.push(row);

      return await interaction.update({
        content: `🏆 **${winnerName}** wins — what was the series score? *(Best of ${bestOf})*`,
        components: rows,
      });
    } catch (error) {
      console.error('Error reporting match:', error);
      return interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true }).catch(() => {});
    }
  },

  // shared with matchScore.js
  finalizeMatchReport,
  findBracketMatch,
  getServiceForBracket,
  validSeriesScores,
};

async function announceTournamentComplete(interaction, tournament, results) {
  const isSolo = tournament.settings.teamSize === 1;

  const embed = new EmbedBuilder()
    .setTitle('🏆 TOURNAMENT COMPLETE 🏆')
    .setColor(0xffd700)
    .setDescription(tournament.title);

  if (tournament.game.logo) {
    embed.setThumbnail(tournament.game.logo);
  }

  const winnerName = isSolo ? results.winner?.username : results.winner?.name;
  const runnerUpName = isSolo ? results.runnerUp?.username : results.runnerUp?.name;
  const thirdPlaceName = isSolo ? results.thirdPlace?.username : results.thirdPlace?.name;

  let fields = [
    { name: '🥇 Champion', value: winnerName || 'Unknown', inline: true },
    { name: '🥈 Runner-up', value: runnerUpName || 'Unknown', inline: true },
  ];

  if (thirdPlaceName) {
    fields.push({ name: '🥉 3rd Place', value: thirdPlaceName, inline: true });
  }

  fields.push(
    { name: '🎮 Game', value: `${require('../config/gamePresets').getGameEmojiText(tournament.game)} ${tournament.game.displayName}`, inline: true },
    { name: '🔄 Format', value: tournament.settings.format.replace('_', ' '), inline: true }
  );

  embed.addFields(fields);
  embed.setFooter({ text: 'Congratulations to all participants!' });

  // Create results button (+ live bracket link when enabled)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`viewResults:${tournament.id}`)
      .setLabel('Show Complete Results')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Success)
  );

  const bracketUrl = getBracketUrl(tournament);
  if (bracketUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('View Bracket')
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Link)
        .setURL(bracketUrl)
    );
  }

  // Post to tournament channel
  try {
    const channel = await interaction.client.channels.fetch(tournament.channelId);
    await channel.send({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error('Error posting tournament results:', error);
  }
}

async function updateTournamentAnnouncement(client, tournament) {
  try {
    const channel = await client.channels.fetch(tournament.channelId);
    if (!channel) return;

    const message = await channel.messages.fetch(tournament.messageId);
    if (!message) return;

    // Update tournament status for embed
    tournament.status = 'completed';

    const embed = await createTournamentEmbed(tournament);
    const buttons = createTournamentButtons(tournament);

    await message.edit({ embeds: [embed], components: buttons });
  } catch (error) {
    console.error('Error updating tournament announcement:', error);
  }
}
