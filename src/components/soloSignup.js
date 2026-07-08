const { getTournament, addParticipant } = require('../services/tournamentService');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');
const { getNickFields } = require('../config/gamePresets');
const { collectFields } = require('../utils/nickValidation');

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

    const nickFields = getNickFields(tournament.game);
    const collected = collectFields(nickFields, key => interaction.fields.getTextInputValue(key));
    if (!collected.ok) {
      return interaction.editReply({ content: `❌ ${collected.error}` });
    }

    const result = await addParticipant(tournamentId, {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName,
      gameNick: collected.gameNick,     // public display value
      gameFields: collected.gameFields, // full { key: value } map
    });

    if (!result.success) {
      return interaction.editReply({ content: `❌ ${result.error}`, ephemeral: true });
    }

    await updateTournamentMessages(interaction.client, result.tournament);
    const { signupNextSteps } = require('../utils/signupMessages');
    // Confirmation is ephemeral (only the signer sees it), so echo every field.
    const summary = nickFields.map(f => `${f.label}: **${collected.gameFields[f.key]}**`).join('\n');
    return interaction.editReply({
      content: `✅ You're signed up for **${tournament.title}**!\n${summary}${signupNextSteps(tournament)}`,
      ephemeral: true,
    });
  },
};
