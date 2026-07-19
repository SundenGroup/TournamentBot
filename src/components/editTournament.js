// Modal submit handler for /tournament edit.
// Editable pre-start: title, date/time, max participants, best-of, and the
// check-in window (0 = off). Description is editable from the web dashboard.
// Validation + persistence live in the shared editTournamentFlow so the
// Discord and web edit paths behave identically. Never editable: game,
// format, team size (changing them after signups would invalidate signups).

const { getTournament } = require('../services/tournamentService');
const { canManageTournaments } = require('../utils/permissions');
const { editTournamentFlow } = require('../services/lifecycleService');

module.exports = {
  customId: 'editTournament',
  async execute(interaction, args) {
    // DB write + announcement edits + reminder rescheduling can exceed the
    // 3s ack window, so defer immediately.
    await interaction.deferReply({ ephemeral: true });

    const tournamentId = args[0];
    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      return interaction.editReply({ content: '❌ Tournament not found.' });
    }

    if (!(await canManageTournaments(interaction.member))) {
      return interaction.editReply({ content: '❌ Only tournament admins can edit tournaments.' });
    }

    const get = (id) => {
      try { return interaction.fields.getTextInputValue(id); } catch { return undefined; }
    };

    try {
      const { updated, changes } = await editTournamentFlow({
        client: interaction.client,
        tournament,
        fields: {
          title: get('title'),
          startTime: get('datetime'),
          maxParticipants: get('maxParticipants'),
          bestOf: get('bestOf'),
          checkinWindow: get('checkinWindow'),
        },
      });

      if (changes.length === 0) {
        return interaction.editReply({ content: 'No changes made — everything matches the current values.' });
      }

      return interaction.editReply({
        content: `✅ **${updated.title}** updated: ${changes.join(', ')}.`,
      });
    } catch (err) {
      return interaction.editReply({ content: `❌ ${err.message}` });
    }
  },
};
