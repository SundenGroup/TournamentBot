const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { getTournament, addParticipant } = require('../services/tournamentService');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');
const { getNickFields } = require('../config/gamePresets');

/** One short modal input for a single signup field (own value). */
function fieldInput(field, customId, labelPrefix = '') {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(`${labelPrefix}${field.label}`.slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(field.placeholder)
    .setRequired(true)
    .setMaxLength(field.minLength >= 20 ? 100 : 50); // long identifiers (ids) get room
  if (field.minLength) input.setMinLength(field.minLength);
  return input;
}

module.exports = {
  customId: 'signup',
  async execute(interaction, args) {
    const tournamentId = args[0];
    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }

    // Check required roles
    const requiredRoles = tournament.settings.requiredRoles;
    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.some(roleId => interaction.member.roles.cache.has(roleId));
      if (!hasRole) {
        const roleList = requiredRoles.map(id => `<@&${id}>`).join(', ');
        return interaction.reply({
          content: `❌ You need one of these roles to sign up: ${roleList}`,
          ephemeral: true,
        });
      }
    }

    const isSolo = tournament.settings.teamSize === 1;
    const nickFields = getNickFields(tournament.game);

    if (isSolo) {
      // Check if game nick is required
      if (tournament.settings.requireGameNick) {
        // One modal input per signup field (GOALS = Username + User ID)
        const modal = new ModalBuilder()
          .setCustomId(`soloSignup:${tournamentId}`)
          .setTitle(`Sign Up - ${tournament.title}`.slice(0, 45));

        modal.addComponents(...nickFields.map(f =>
          new ActionRowBuilder().addComponents(fieldInput(f, f.key))
        ));

        await interaction.showModal(modal);
      } else {
        // Direct signup for solo tournaments without game nick requirement.
        // The DB write + message refresh can exceed the 3s ack window, so defer.
        await interaction.deferReply({ ephemeral: true });

        const result = await addParticipant(tournamentId, {
          id: interaction.user.id,
          username: interaction.user.username,
          displayName: interaction.user.displayName,
        });

        if (!result.success) {
          return interaction.editReply({ content: `❌ ${result.error}` });
        }

        await updateTournamentMessages(interaction.client, result.tournament);
        const { signupNextSteps } = require('../utils/signupMessages');
        return interaction.editReply({
          content: `✅ You're signed up for **${tournament.title}**!${signupNextSteps(tournament)}`,
        });
      }
    } else {
      // Show team registration modal for team tournaments
      const modal = new ModalBuilder()
        .setCustomId(`teamRegister:${tournamentId}`)
        .setTitle('Register Your Team');

      const teamNameInput = new TextInputBuilder()
        .setCustomId('teamName')
        .setLabel('Team Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter your team name')
        .setRequired(true)
        .setMaxLength(50);

      const membersInput = new TextInputBuilder()
        .setCustomId('members')
        .setLabel(`Team Members (${tournament.settings.teamSize - 1} members, one per line)`)
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Enter Discord usernames, one per line\n(excluding yourself)')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(teamNameInput),
        new ActionRowBuilder().addComponents(membersInput)
      );

      // Add game nick / game-ID field(s) if required. A modal allows max 5
      // inputs (2 used above), so we cap the collected fields at 3.
      if (tournament.settings.requireGameNick) {
        const teamFields = nickFields.slice(0, 3);
        if (tournament.settings.captainMode) {
          // Captain mode: one paragraph per field, one line per member (own first)
          modal.addComponents(...teamFields.map(f => {
            const listLabel = `All ${f.label}s (${tournament.settings.teamSize}, one per line)`.slice(0, 45);
            return new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId(`list_${f.key}`)
                .setLabel(listLabel)
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Yours first, then each member (same order as above)')
                .setRequired(true)
            );
          }));
        } else {
          // Non-captain mode: captain provides only their own value per field
          modal.addComponents(...teamFields.map(f =>
            new ActionRowBuilder().addComponents(fieldInput(f, `captain_${f.key}`, 'Your '))
          ));
        }
      }

      await interaction.showModal(modal);
    }
  },
};
