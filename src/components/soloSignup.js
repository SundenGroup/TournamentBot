const { getTournament, addParticipant } = require('../services/tournamentService');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');

module.exports = {
  customId: 'soloSignup',
  async execute(interaction, args) {
    await interaction.deferReply({ ephemeral: true });

    const tournamentId = args[0];
    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      return interaction.editReply({ content: '❌ Tournament not found.' });
    }

    // Check required roles
    const requiredRoles = tournament.settings.requiredRoles;
    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.some(roleId => interaction.member.roles.cache.has(roleId));
      if (!hasRole) {
        const roleList = requiredRoles.map(id => `<@&${id}>`).join(', ');
        return interaction.editReply({
          content: `❌ You need one of these roles to sign up: ${roleList}`,
          ephemeral: true,
        });
      }
    }

    const gameNick = interaction.fields.getTextInputValue('gameNick');

    const result = await addParticipant(tournamentId, {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName,
      gameNick: gameNick,
    });

    if (!result.success) {
      return interaction.editReply({ content: `❌ ${result.error}`, ephemeral: true });
    }

    await updateTournamentMessages(interaction.client, result.tournament);
    return interaction.editReply({
      content: `✅ You're signed up for **${tournament.title}**!\nIn-game nick: **${gameNick}**`,
      ephemeral: true,
    });
  },
};
