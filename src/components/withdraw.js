const { getTournament, removeParticipant, removeTeam } = require('../services/tournamentService');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');

module.exports = {
  customId: 'withdraw',
  async execute(interaction, args) {
    const tournamentId = args[0];
    const tournament = getTournament(tournamentId);

    if (!tournament) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }

    const isSolo = tournament.settings.teamSize === 1;

    if (isSolo) {
      const result = removeParticipant(tournamentId, interaction.user.id);

      if (!result.success) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }

      await updateTournamentMessages(interaction.client, result.tournament);
      return interaction.reply({
        content: `✅ You have withdrawn from **${tournament.title}**.`,
        ephemeral: true,
      });
    } else {
      const result = removeTeam(tournamentId, interaction.user.id);

      if (!result.success) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
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

      return interaction.reply({
        content: `✅ Team **${result.team.name}** has been withdrawn from **${tournament.title}**.`,
        ephemeral: true,
      });
    }
  },
};
