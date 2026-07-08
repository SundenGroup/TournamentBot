const { getTournament, addTeam } = require('../services/tournamentService');
const { getServerSettings } = require('../data/serverSettings');
const { updateTournamentMessages } = require('../utils/tournamentUpdater');
const { getNickFields } = require('../config/gamePresets');
const { validateNick, collectFields } = require('../utils/nickValidation');

module.exports = {
  customId: 'teamRegister',
  async execute(interaction, args) {
    // Member resolution, the DB write, message edits and DM loop below can all
    // exceed Discord's 3s ack window, so acknowledge immediately and edit after.
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

    const teamName = interaction.fields.getTextInputValue('teamName');
    const membersInput = interaction.fields.getTextInputValue('members');

    const memberLines = membersInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const expectedMembers = tournament.settings.teamSize - 1;

    if (memberLines.length !== expectedMembers) {
      return interaction.editReply({
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
        // Captain mode: members don't HAVE to be in the server yet, but try to
        // resolve them right away — resolved members get the team DM and never
        // show as "(pending)". Only unmatched names stay pending (re-resolved
        // when the tournament starts).
        let member = guild.members.cache.find(m =>
          m.user.username.toLowerCase() === cleanInput.toLowerCase() ||
          m.displayName.toLowerCase() === cleanInput.toLowerCase()
        );
        if (!member) {
          try {
            const fetched = await guild.members.fetch({ query: cleanInput, limit: 5 });
            member = fetched.find(m =>
              m.user.username.toLowerCase() === cleanInput.toLowerCase() ||
              m.displayName.toLowerCase() === cleanInput.toLowerCase()
            );
          } catch {
            // Fetch failed — keep as pending
          }
        }

        if (member) {
          members.push({
            id: member.id,
            username: member.user.username,
            displayName: member.displayName,
          });
        } else {
          members.push({
            id: null,
            username: cleanInput,
            displayName: cleanInput,
            pending: true,
          });
        }
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
          return interaction.editReply({
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

    // Parse signup fields (nick / game IDs) if required. Each entrant gets a
    // gameFields map plus gameNick (the first public field value, for display).
    const nickFields = getNickFields(tournament.game).slice(0, 3);
    const teamSize = tournament.settings.teamSize;
    const publicVal = map => {
      for (const f of nickFields) if (!f.private && map?.[f.key]) return map[f.key];
      return null;
    };
    let captainGameFields = null;
    const memberGameFields = []; // aligned with `members`

    if (tournament.settings.requireGameNick) {
      if (captainModeEnabled) {
        // Captain mode: one paragraph per field, one line per member (own first)
        const perMember = Array.from({ length: teamSize }, () => ({}));
        for (const f of nickFields) {
          let raw;
          try { raw = interaction.fields.getTextInputValue(`list_${f.key}`); } catch { raw = ''; }
          const lines = String(raw || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
          if (lines.length !== teamSize) {
            return interaction.editReply({
              content: `❌ Please provide exactly ${teamSize} ${f.label}s (one per line). You provided ${lines.length}. First line is yours, then each member in order.`,
            });
          }
          for (let i = 0; i < lines.length; i++) {
            const check = validateNick(lines[i], f, i === 0 ? 'Your' : `Line ${i + 1}'s`);
            if (!check.ok) return interaction.editReply({ content: `❌ ${check.error}` });
            perMember[i][f.key] = check.value;
          }
        }
        captainGameFields = perMember[0];
        for (let i = 1; i < teamSize; i++) memberGameFields.push(perMember[i]);
      } else {
        // Non-captain mode: captain provides only their own value per field
        const collected = collectFields(nickFields, key => interaction.fields.getTextInputValue(`captain_${key}`));
        if (!collected.ok) return interaction.editReply({ content: `❌ ${collected.error}` });
        captainGameFields = collected.gameFields;
      }
    }

    // Assign fields to members (aligned; captain-mode fills these, else null)
    for (let i = 0; i < members.length; i++) {
      members[i].gameFields = memberGameFields[i] || null;
      members[i].gameNick = publicVal(memberGameFields[i]);
    }

    const captainGameNick = publicVal(captainGameFields);
    const captainEntry = {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName || interaction.user.username,
      gameNick: captainGameNick || null,
      gameFields: captainGameFields || null,
    };

    // Add captain to members list for display
    const allMembers = [captainEntry, ...members];

    const result = await addTeam(tournamentId, {
      name: teamName,
      captain: captainEntry,
      members: allMembers,
    });

    if (!result.success) {
      return interaction.editReply({ content: `❌ ${result.error}`, ephemeral: true });
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

    const { signupNextSteps } = require('../utils/signupMessages');
    return interaction.editReply({
      content: `✅ Team **${teamName}** has been registered for **${tournament.title}**!${signupNextSteps(tournament)}`,
      ephemeral: true,
    });
  },
};
