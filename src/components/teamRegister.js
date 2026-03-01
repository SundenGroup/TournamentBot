const { getTournament, addTeam } = require('../services/tournamentService');
const { getServerSettings } = require('../data/serverSettings');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');

module.exports = {
  customId: 'teamRegister',
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

    const teamName = interaction.fields.getTextInputValue('teamName');
    const membersInput = interaction.fields.getTextInputValue('members');

    const memberLines = membersInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const expectedMembers = tournament.settings.teamSize - 1;

    if (memberLines.length !== expectedMembers) {
      return interaction.reply({
        content: `❌ Teams must have exactly ${tournament.settings.teamSize} players. You provided ${memberLines.length + 1} (including yourself). Please provide ${expectedMembers} other members.`,
        ephemeral: true,
      });
    }

    // Resolve members
    const members = [];
    const guild = interaction.guild;
    const captainModeEnabled = tournament.settings.captainMode ?? (await getServerSettings(tournament.guildId)).captainMode ?? false;

    for (const input of memberLines) {
      // Remove @ if present
      const cleanInput = input.replace(/^@/, '');

      if (captainModeEnabled) {
        // Captain mode: store as pending text, resolve later
        members.push({
          id: null,
          username: cleanInput,
          displayName: cleanInput,
          pending: true,
        });
      } else {
        // Default: resolve member immediately
        let member = null;

        // Try by username
        member = guild.members.cache.find(m =>
          m.user.username.toLowerCase() === cleanInput.toLowerCase() ||
          m.displayName.toLowerCase() === cleanInput.toLowerCase()
        );

        // Try by ID
        if (!member && /^\d+$/.test(cleanInput)) {
          try {
            member = await guild.members.fetch(cleanInput);
          } catch {
            // Not found
          }
        }

        if (!member) {
          return interaction.reply({
            content: `❌ Could not find user: **${input}**. Make sure they are in this server and you typed their username correctly.`,
            ephemeral: true,
          });
        }

        members.push({
          id: member.id,
          username: member.user.username,
          displayName: member.displayName,
        });
      }
    }

    // Parse game nicks if required
    let captainGameNick = null;
    const memberGameNicks = [];

    if (tournament.settings.requireGameNick) {
      if (captainModeEnabled) {
        // Captain mode: all game nicks provided in one field
        let teamGameNicks;
        try {
          teamGameNicks = interaction.fields.getTextInputValue('teamGameNicks');
        } catch {
          teamGameNicks = null;
        }

        if (teamGameNicks) {
          const nickLines = teamGameNicks.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          if (nickLines.length !== tournament.settings.teamSize) {
            return interaction.reply({
              content: `❌ Please provide exactly ${tournament.settings.teamSize} game nicks (one per line). You provided ${nickLines.length}. First line is your nick, then each member in order.`,
              ephemeral: true,
            });
          }
          captainGameNick = nickLines[0];
          for (let i = 1; i < nickLines.length; i++) {
            memberGameNicks.push(nickLines[i]);
          }
        }
      } else {
        // Non-captain mode: only captain's nick
        try {
          captainGameNick = interaction.fields.getTextInputValue('captainGameNick');
        } catch {
          captainGameNick = null;
        }
      }
    }

    // Assign game nicks to members
    for (let i = 0; i < members.length; i++) {
      members[i].gameNick = memberGameNicks[i] || null;
    }

    // Add captain to members list for display
    const allMembers = [
      {
        id: interaction.user.id,
        username: interaction.user.username,
        displayName: interaction.user.displayName || interaction.user.username,
        gameNick: captainGameNick || null,
      },
      ...members,
    ];

    const result = await addTeam(tournamentId, {
      name: teamName,
      captain: {
        id: interaction.user.id,
        username: interaction.user.username,
        displayName: interaction.user.displayName || interaction.user.username,
        gameNick: captainGameNick || null,
      },
      members: allMembers,
    });

    if (!result.success) {
      return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    }

    await updateTournamentMessages(interaction.client, result.tournament);

    // DM team members (skip pending members with no ID)
    for (const member of members) {
      if (!member.id) continue;
      try {
        const user = await interaction.client.users.fetch(member.id);
        await user.send(
          `You've been added to team **${teamName}** for **${tournament.title}**!\n` +
          `Captain: ${interaction.user.username}`
        );
      } catch {
        // Can't DM user, ignore
      }
    }

    return interaction.reply({
      content: `✅ Team **${teamName}** has been registered for **${tournament.title}**!`,
      ephemeral: true,
    });
  },
};
