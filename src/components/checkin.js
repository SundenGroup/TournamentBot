const { toggleCheckedIn } = require('../services/tournamentService');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');
const webhooks = require('../services/webhookService');

module.exports = {
  customId: 'checkin',
  async execute(interaction, args) {
    await interaction.deferReply({ ephemeral: true });

    const tournamentId = args[0];

    // All validation + the write happen inside one row-locked transaction so
    // simultaneous taps from the field can't clobber each other's check-ins.
    // Tapping the button again cancels a check-in.
    const result = await toggleCheckedIn(tournamentId, interaction.user.id);

    if (!result.success) {
      return interaction.editReply({ content: `❌ ${result.error}` });
    }

    const { tournament } = result;

    // Webhook only fires on a fresh solo check-in / a team reaching full.
    if (result.checkedIn) {
      if (result.isSolo) webhooks.onParticipantCheckedIn(tournament, result.participant);
      else if (result.teamNowFull) webhooks.onParticipantCheckedIn(tournament, result.team);
    }

    await updateTournamentMessages(interaction.client, tournament);

    if (result.isSolo) {
      return interaction.editReply({
        content: result.checkedIn
          ? `✅ You're checked in for **${tournament.title}**! Tap **Check In** again if you need to cancel.`
          : `↩️ Check-in cancelled for **${tournament.title}**. Tap **Check In** again to check back in.`,
      });
    }

    const size = tournament.settings.teamSize;
    return interaction.editReply({
      content: result.checkedIn
        ? `✅ You're checked in for team **${result.team.name}**! (${result.checkedInCount}/${size} members)`
        : `↩️ Check-in cancelled for team **${result.team.name}**. (${result.checkedInCount}/${size} members checked in)`,
    });
  },
};
