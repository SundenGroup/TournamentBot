const { getTournament, removeParticipant, removeTeam } = require('../services/tournamentService');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');

// Second step of the withdraw confirm (see withdraw.js). All real validation
// lives in removeParticipant/removeTeam, so state changes between the prompt
// and the click are handled safely.
module.exports = {
  customId: 'withdrawConfirm',
  async execute(interaction, args) {
    await interaction.deferUpdate();

    const tournamentId = args[0];
    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      return interaction.editReply({ content: '❌ Tournament not found.', components: [] });
    }

    const isSolo = tournament.settings.teamSize === 1;

    if (isSolo) {
      const result = await removeParticipant(tournamentId, interaction.user.id);
      if (!result.success) {
        return interaction.editReply({ content: `❌ ${result.error}`, components: [] });
      }

      await updateTournamentMessages(interaction.client, result.tournament);
      return interaction.editReply({
        content: `✅ You have withdrawn from **${tournament.title}**.`,
        components: [],
      });
    }

    const result = await removeTeam(tournamentId, interaction.user.id);
    if (!result.success) {
      return interaction.editReply({ content: `❌ ${result.error}`, components: [] });
    }

    await updateTournamentMessages(interaction.client, result.tournament);

    // DM team members about withdrawal
    for (const member of result.team.members) {
      if (member.id === interaction.user.id) continue;
      if (!member.id) continue;
      try {
        const user = await interaction.client.users.fetch(member.id);
        await user.send(
          `Team **${result.team.name}** has been withdrawn from **${tournament.title}** by the captain.`
        );
      } catch {
        // Can't DM user, ignore
      }
    }

    return interaction.editReply({
      content: `✅ Team **${result.team.name}** has been withdrawn from **${tournament.title}**.`,
      components: [],
    });
  },
};
