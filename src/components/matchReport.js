// Match-room win buttons. customId form: matchWin:<tournamentId>:<matchId>:<slot>
// Bo1 reports directly; Bo3+ hands off to the score picker (matchScore.js).
// The actual report side-effects live in lifecycleService.applyMatchReport —
// shared with /tournament report and the web-admin dashboard.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTournament } = require('../services/tournamentService');
const { canManageTournaments } = require('../utils/permissions');
const { getServiceForBracket, findMatchById, validSeriesScores } = require('../utils/matchUtils');
const { applyMatchReport } = require('../services/lifecycleService');

function findBracketMatch(bracket, matchId) {
  return findMatchById(bracket, matchId);
}

/**
 * Complete a match report: run the shared lifecycle flow (advance, DQ
 * forfeits, bye DMs, next-round rooms, completion announcements) and update
 * the match-room message. `interaction` must be a component interaction on the
 * match-room message. Shared by the Bo1 win buttons and the Bo>1 score picker.
 */
async function finalizeMatchReport(interaction, tournament, match, winner, score) {
  // Ack immediately — the flow (DMs, room creation, announcements) can exceed
  // Discord's 3s interaction window.
  await interaction.deferUpdate();

  const result = await applyMatchReport({
    client: interaction.client,
    guild: interaction.guild,
    tournament,
    match,
    winnerId: winner.id,
    score,
  });

  const winnerName = result.isSolo ? winner.username : winner.name;
  const loserName = result.isSolo ? result.loser?.username : result.loser?.name;

  await interaction.editReply({
    content: `✅ **Match Complete!**\n\n🏆 **${winnerName}** defeats **${loserName}**${score ? ` **(${score})**` : ''}`,
    components: [],
  });
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
      // followUp works whether or not the interaction was already acknowledged
      // by deferUpdate inside finalizeMatchReport.
      return interaction.followUp({ content: `❌ Error: ${error.message}`, ephemeral: true }).catch(() => {});
    }
  },

  // shared with matchScore.js (and re-exported for backwards compatibility)
  finalizeMatchReport,
  findBracketMatch,
  getServiceForBracket,
  validSeriesScores,
};
