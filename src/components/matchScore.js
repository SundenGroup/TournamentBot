// Handles the series-score buttons shown after an admin picks a winner in a
// Bo3+ match (matchReport.js). customId forms:
//   matchScore:<tournamentId>:<matchId>:<winnerSlot>:<W-L>   → report with score
//   matchScore:<tournamentId>:<matchId>:cancel               → back to winner buttons

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTournament } = require('../services/tournamentService');
const { canManageTournaments } = require('../utils/permissions');
const { finalizeMatchReport, findBracketMatch, validSeriesScores } = require('./matchReport');

module.exports = {
  customId: 'matchScore',
  async execute(interaction, args) {
    const [tournamentId, matchId, slotOrCancel, score] = args;

    const tournament = await getTournament(tournamentId);
    if (!tournament || !tournament.bracket) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }

    if (!(await canManageTournaments(interaction.member))) {
      return interaction.reply({ content: '❌ Only tournament admins can report match results.', ephemeral: true });
    }

    const match = findBracketMatch(tournament.bracket, matchId);
    if (!match) {
      return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
    }

    if (match.winner) {
      return interaction.reply({ content: '❌ This match has already been reported.', ephemeral: true });
    }

    const isSolo = tournament.settings.teamSize === 1;
    const getName = (p) => (isSolo ? p?.username : p?.name) || 'TBD';

    // "Back" — restore the original winner buttons on the match message
    if (slotOrCancel === 'cancel') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`matchWin:${tournamentId}:${matchId}:1`)
          .setLabel(`👑 ${getName(match.participant1).substring(0, 70)} Wins`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`matchWin:${tournamentId}:${matchId}:2`)
          .setLabel(`👑 ${getName(match.participant2).substring(0, 70)} Wins`)
          .setStyle(ButtonStyle.Primary)
      );
      return interaction.update({
        content: `⚔️ **Match #${match.matchNumber}** — report the result:`,
        components: [row],
      });
    }

    // Validate the score against the tournament's best-of (defense in depth —
    // the buttons only offer valid scores, but customIds can be forged).
    const bestOf = tournament.settings.bestOf || 1;
    if (!validSeriesScores(bestOf).includes(score)) {
      return interaction.reply({ content: `❌ Invalid score for a Best of ${bestOf}.`, ephemeral: true });
    }

    const winner = slotOrCancel === '1' ? match.participant1 : match.participant2;
    if (!winner) {
      return interaction.reply({ content: '❌ Invalid winner selection.', ephemeral: true });
    }

    try {
      await finalizeMatchReport(interaction, tournament, match, winner, score);
    } catch (error) {
      console.error('Error reporting match with score:', error);
      // followUp works whether or not finalizeMatchReport already acknowledged
      // the interaction via deferUpdate.
      return interaction.followUp({ content: `❌ Error: ${error.message}`, ephemeral: true }).catch(() => {});
    }
  },
};
