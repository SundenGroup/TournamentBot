// "Start Tournament" button on the announcement. The full start flow (bracket
// generation, match rooms, bye DMs, announcement refresh, rollback on failure)
// lives in lifecycleService.startTournamentFlow — shared with /tournament
// start and the web-admin dashboard.

const { getTournament } = require('../services/tournamentService');
const { canManageTournaments } = require('../utils/permissions');
const { startTournamentFlow, buildStartEmbed } = require('../services/lifecycleService');

module.exports = {
  customId: 'startTournament',
  async execute(interaction, args) {
    const tournamentId = args[0];
    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }

    // Check permissions - admin only
    if (!(await canManageTournaments(interaction.member))) {
      return interaction.reply({ content: '❌ Only tournament admins can start tournaments.', ephemeral: true });
    }

    // Fast-fail the common cases before deferring (the flow re-checks them)
    if (tournament.status !== 'registration' && tournament.status !== 'checkin') {
      return interaction.reply({ content: '❌ Tournament is not in registration/checkin phase.', ephemeral: true });
    }
    const isSolo = tournament.settings.teamSize === 1;
    if ((isSolo ? tournament.participants : tournament.teams).length < 2) {
      return interaction.reply({ content: '❌ Need at least 2 participants to start.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

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
  },
};
