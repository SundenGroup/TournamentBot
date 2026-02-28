const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { getTournament, addParticipant } = require('../services/tournamentService');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');

module.exports = {
  customId: 'signup',
  async execute(interaction, args) {
    const tournamentId = args[0];
    const tournament = getTournament(tournamentId);

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

    if (isSolo) {
      // Check if game nick is required
      if (tournament.settings.requireGameNick) {
        // Show modal to collect game nick
        const modal = new ModalBuilder()
          .setCustomId(`soloSignup:${tournamentId}`)
          .setTitle(`Sign Up - ${tournament.title}`);

        const gameNickInput = new TextInputBuilder()
          .setCustomId('gameNick')
          .setLabel('In-Game Nickname')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter your in-game name')
          .setRequired(true)
          .setMaxLength(50);

        modal.addComponents(
          new ActionRowBuilder().addComponents(gameNickInput)
        );

        await interaction.showModal(modal);
      } else {
        // Direct signup for solo tournaments without game nick requirement
        const result = addParticipant(tournamentId, {
          id: interaction.user.id,
          username: interaction.user.username,
          displayName: interaction.user.displayName,
        });

        if (!result.success) {
          return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
        }

        await updateTournamentMessages(interaction.client, result.tournament);
        return interaction.reply({
          content: `✅ You're signed up for **${tournament.title}**!`,
          ephemeral: true,
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

      // Add game nick field(s) if required
      if (tournament.settings.requireGameNick) {
        if (tournament.settings.captainMode) {
          // Captain mode: captain provides all game nicks
          const gameNicksInput = new TextInputBuilder()
            .setCustomId('teamGameNicks')
            .setLabel(`All Game Nicks (${tournament.settings.teamSize} nicks, one per line)`)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Your nick first, then each member (same order as above)')
            .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder().addComponents(gameNicksInput)
          );
        } else {
          const gameNickInput = new TextInputBuilder()
            .setCustomId('captainGameNick')
            .setLabel('Your In-Game Nickname')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter your in-game name')
            .setRequired(true)
            .setMaxLength(50);

          modal.addComponents(
            new ActionRowBuilder().addComponents(gameNickInput)
          );
        }
      }

      await interaction.showModal(modal);
    }
  },
};
