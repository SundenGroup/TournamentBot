const { setCheckedIn } = require('../services/tournamentService');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');
const webhooks = require('../services/webhookService');

module.exports = {
  customId: 'checkin',
  async execute(interaction, args) {
    await interaction.deferReply({ ephemeral: true });

    const tournamentId = args[0];

    // All validation + the write happen inside one row-locked transaction so
    // simultaneous taps from the field can't clobber each other's check-ins.
    const result = await setCheckedIn(tournamentId, interaction.user.id);

    if (!result.success) {
      if (result.already) {
        return interaction.editReply({ content: '✅ You are already checked in!' });
      }
      return interaction.editReply({ content: `❌ ${result.error}` });
    }

    const { tournament } = result;

    if (result.isSolo) {
      webhooks.onParticipantCheckedIn(tournament, result.participant);
    } else if (result.teamNowFull) {
      webhooks.onParticipantCheckedIn(tournament, result.team);
    }

    await updateTournamentMessages(interaction.client, tournament);

    if (result.isSolo) {
      return interaction.editReply({
        content: `✅ You are now checked in for **${tournament.title}**!`,
      });
    }
    return interaction.editReply({
      content: `✅ You are checked in for team **${result.team.name}**! (${result.checkedInCount}/${tournament.settings.teamSize} members)`,
    });
  },
};
