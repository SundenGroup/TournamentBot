const { getTournament, updateTournament } = require('../services/tournamentService');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');
const webhooks = require('../services/webhookService');

module.exports = {
  customId: 'checkin',
  async execute(interaction, args) {
    const tournamentId = args[0];
    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }

    if (!tournament.checkinOpen && tournament.status !== 'checkin') {
      return interaction.reply({ content: '❌ Check-in is not open yet.', ephemeral: true });
    }

    const isSolo = tournament.settings.teamSize === 1;

    if (isSolo) {
      const participant = tournament.participants.find(p => p.id === interaction.user.id);
      if (!participant) {
        return interaction.reply({ content: '❌ You are not registered for this tournament.', ephemeral: true });
      }

      if (participant.checkedIn) {
        return interaction.reply({ content: '✅ You are already checked in!', ephemeral: true });
      }

      participant.checkedIn = true;
      await updateTournament(tournamentId, { participants: tournament.participants });

      // Trigger webhook
      webhooks.onParticipantCheckedIn(tournament, participant);

      await updateTournamentMessages(interaction.client, tournament);

      return interaction.reply({
        content: `✅ You are now checked in for **${tournament.title}**!`,
        ephemeral: true,
      });
    } else {
      // Team check-in - find player's team
      let playerTeam = null;
      for (const team of tournament.teams) {
        if (team.members.some(m => m.id === interaction.user.id)) {
          playerTeam = team;
          break;
        }
      }

      if (!playerTeam) {
        return interaction.reply({ content: '❌ You are not on a team in this tournament.', ephemeral: true });
      }

      if (!playerTeam.memberCheckins) {
        playerTeam.memberCheckins = {};
      }

      if (playerTeam.memberCheckins[interaction.user.id]) {
        return interaction.reply({ content: '✅ You are already checked in!', ephemeral: true });
      }

      playerTeam.memberCheckins[interaction.user.id] = true;

      // Check if all resolved members are checked in
      const checkedInCount = Object.keys(playerTeam.memberCheckins).length;
      const resolvedCount = playerTeam.members.filter(m => m.id && !m.id.startsWith('fake_')).length;
      if (checkedInCount >= resolvedCount) {
        playerTeam.checkedIn = true;

        // Trigger webhook when team is fully checked in
        webhooks.onParticipantCheckedIn(tournament, playerTeam);
      }

      await updateTournament(tournamentId, { teams: tournament.teams });
      await updateTournamentMessages(interaction.client, tournament);

      return interaction.reply({
        content: `✅ You are checked in for team **${playerTeam.name}**! (${checkedInCount}/${tournament.settings.teamSize} members)`,
        ephemeral: true,
      });
    }
  },
};
