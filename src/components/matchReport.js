const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTournament, updateTournament } = require('../services/tournamentService');
const { canManageTournaments } = require('../utils/permissions');
const singleElim = require('../services/singleEliminationService');
const doubleElim = require('../services/doubleEliminationService');
const swiss = require('../services/swissService');
const roundRobin = require('../services/roundRobinService');
const battleRoyale = require('../services/battleRoyaleService');
const { createMatchRoom } = require('../services/channelService');
const { createTournamentEmbed, createTournamentButtons } = require('../utils/embedBuilder');
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

module.exports = {
  customId: 'matchWin',
  async execute(interaction, args) {
    const [tournamentId, matchId, winnerSlot] = args;
    const tournament = getTournament(tournamentId);

    if (!tournament) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }

    // Check permissions - admin only
    if (!canManageTournaments(interaction.member)) {
      return interaction.reply({ content: '❌ Only tournament admins can report match results.', ephemeral: true });
    }

    const bracket = tournament.bracket;
    if (!bracket) {
      return interaction.reply({ content: '❌ Bracket not found.', ephemeral: true });
    }

    // Find the match
    let match;
    const service = getServiceForBracket(bracket);

    if (bracket.type === 'double_elimination') {
      match = doubleElim.findMatch(bracket, matchId);
    } else if (bracket.type === 'swiss') {
      match = swiss.findMatch(bracket, matchId);
    } else if (bracket.type === 'round_robin') {
      match = roundRobin.findMatch(bracket, matchId);
    } else {
      for (const round of bracket.rounds) {
        match = round.matches.find(m => m.id === matchId);
        if (match) break;
      }
    }

    if (!match) {
      return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
    }

    if (match.winner) {
      return interaction.reply({ content: '❌ This match has already been reported.', ephemeral: true });
    }

    // Determine winner
    const winner = winnerSlot === '1' ? match.participant1 : match.participant2;
    if (!winner) {
      return interaction.reply({ content: '❌ Invalid winner selection.', ephemeral: true });
    }

    try {
      // Advance winner
      service.advanceWinner(bracket, matchId, winner.id);
      updateTournament(tournamentId, { bracket });

      const isSolo = tournament.settings.teamSize === 1;
      const winnerName = isSolo ? winner.username : winner.name;
      const loser = winnerSlot === '1' ? match.participant2 : match.participant1;
      const loserName = isSolo ? loser?.username : loser?.name;

      // Trigger match completed webhook
      webhooks.onMatchCompleted(tournament, {
        id: matchId,
        round: match.round,
        winner: winner,
        loser: loser,
        score: match.score,
      });

      // Update the match room message
      await interaction.update({
        content: `✅ **Match Complete!**\n\n🏆 **${winnerName}** defeats **${loserName}**`,
        components: [],
      });

      // For Swiss: check if round complete and generate next round
      if (bracket.type === 'swiss' && service.isRoundComplete(bracket)) {
        if (bracket.currentRound < bracket.totalRounds) {
          service.generateNextRound(bracket);
        }
      }

      // Check if tournament is complete
      if (service.isComplete(bracket)) {
        const results = service.getResults(bracket);
        await announceTournamentComplete(interaction, tournament, results);
        updateTournament(tournamentId, { status: 'completed', standings: results.standings || [] });

        // Trigger tournament completed webhook
        webhooks.onTournamentCompleted(tournament, results.standings || [results.winner, results.runnerUp, results.thirdPlace].filter(Boolean));

        // Update the tournament announcement with results button
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

      updateTournament(tournamentId, { bracket });

    } catch (error) {
      console.error('Error reporting match:', error);
      return interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
    }
  },
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
    { name: '🎮 Game', value: `${tournament.game.icon} ${tournament.game.displayName}`, inline: true },
    { name: '🔄 Format', value: tournament.settings.format.replace('_', ' '), inline: true }
  );

  embed.addFields(fields);
  embed.setFooter({ text: 'Congratulations to all participants!' });

  // Create results button
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`viewResults:${tournament.id}`)
      .setLabel('Show Complete Results')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Success)
  );

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

    const embed = createTournamentEmbed(tournament);
    const buttons = createTournamentButtons(tournament);

    await message.edit({ embeds: [embed], components: buttons });
  } catch (error) {
    console.error('Error updating tournament announcement:', error);
  }
}
