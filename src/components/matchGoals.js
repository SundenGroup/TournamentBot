// Modal submit for the goal-totals popup shown by the match-room tap-report
// (matchReport.finalizeMatchReport when settings.trackGoals is on).
// customId: matchGoals:<tournamentId>:<matchId>:<winnerSlot>:<score|ns>
const { getTournament } = require('../services/tournamentService');
const { canManageTournaments } = require('../utils/permissions');
const { finalizeMatchReport, findBracketMatch } = require('./matchReport');

module.exports = {
  customId: 'matchGoals',
  async execute(interaction, args) {
    const [tournamentId, matchId, winnerSlot, scoreEnc] = args;

    const tournament = await getTournament(tournamentId);
    if (!tournament || !tournament.bracket) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }
    if (!(await canManageTournaments(interaction.member))) {
      return interaction.reply({ content: '❌ Only tournament admins can report match results.', ephemeral: true });
    }
    const match = findBracketMatch(tournament.bracket, matchId);
    if (!match) return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
    if (match.winner) return interaction.reply({ content: '❌ This match has already been reported.', ephemeral: true });

    const winner = winnerSlot === '1' ? match.participant1 : match.participant2;
    if (!winner) return interaction.reply({ content: '❌ Invalid winner selection.', ephemeral: true });

    const goalsRaw = (interaction.fields.getTextInputValue('goals') || '').trim();
    if (goalsRaw && !/^\d{1,3}-\d{1,3}$/.test(goalsRaw)) {
      return interaction.reply({
        content: `❌ \`${goalsRaw}\` isn't a valid goal line — use winner-first totals like \`7-4\` (or leave it empty to skip). Tap the winner again to retry.`,
        ephemeral: true,
      });
    }

    const score = scoreEnc === 'ns' ? null : scoreEnc;
    try {
      // goals: string reports them; null = admin skipped on purpose
      await finalizeMatchReport(interaction, tournament, match, winner, score, goalsRaw || null);
    } catch (error) {
      console.error('Error reporting match with goals:', error);
      return interaction.followUp({ content: `❌ Error: ${error.message}`, ephemeral: true }).catch(() => {});
    }
  },
};
