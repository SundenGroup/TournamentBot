const { SlashCommandBuilder } = require('discord.js');
const { getTournament, updateTournament } = require('../../services/tournamentService');
const { createTournamentEmbed, createParticipantListEmbed } = require('../../utils/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Team management commands')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a member to your team (Captain only)')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addUserOption(option =>
          option.setName('member')
            .setDescription('User to add')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a member from your team (Captain only)')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addUserOption(option =>
          option.setName('member')
            .setDescription('User to remove')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('transfer')
        .setDescription('Transfer captain role to another member (Captain only)')
        .addStringOption(option =>
          option.setName('tournament')
            .setDescription('Tournament')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addUserOption(option =>
          option.setName('member')
            .setDescription('New captain')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'add':
        await handleAdd(interaction);
        break;
      case 'remove':
        await handleRemove(interaction);
        break;
      case 'transfer':
        await handleTransfer(interaction);
        break;
    }
  },

  async autocomplete(interaction) {
    const { getActiveTournaments } = require('../../services/tournamentService');
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'tournament') {
      const tournaments = getActiveTournaments(interaction.guildId)
        .filter(t => t.settings.teamSize > 1);
      const choices = tournaments.map(t => ({
        name: `${t.game.icon} ${t.title}`,
        value: t.id,
      }));
      const filtered = choices.filter(choice =>
        choice.name.toLowerCase().includes(focused.value.toLowerCase())
      );
      await interaction.respond(filtered.slice(0, 25));
    }
  },
};

async function handleAdd(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const newMember = interaction.options.getUser('member');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (tournament.status !== 'registration') {
    return interaction.reply({ content: '❌ Cannot modify teams after registration closes.', ephemeral: true });
  }

  const team = tournament.teams.find(t => t.captain.id === interaction.user.id);
  if (!team) {
    return interaction.reply({ content: '❌ You are not a team captain in this tournament.', ephemeral: true });
  }

  if (team.members.length >= tournament.settings.teamSize) {
    return interaction.reply({ content: '❌ Team is already full.', ephemeral: true });
  }

  // Check if user is already on a team
  for (const t of tournament.teams) {
    if (t.members.some(m => m.id === newMember.id)) {
      return interaction.reply({ content: '❌ This user is already on a team.', ephemeral: true });
    }
  }

  team.members.push({
    id: newMember.id,
    username: newMember.username,
    displayName: newMember.displayName || newMember.username,
  });

  updateTournament(tournamentId, { teams: tournament.teams });
  await updateTournamentMessages(interaction, tournament);

  // DM the new member
  try {
    await newMember.send(`You've been added to team **${team.name}** for **${tournament.title}**!`);
  } catch {}

  return interaction.reply({
    content: `✅ Added **${newMember.username}** to team **${team.name}**.`,
    ephemeral: true,
  });
}

async function handleRemove(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const memberToRemove = interaction.options.getUser('member');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (tournament.status !== 'registration') {
    return interaction.reply({ content: '❌ Cannot modify teams after registration closes.', ephemeral: true });
  }

  const team = tournament.teams.find(t => t.captain.id === interaction.user.id);
  if (!team) {
    return interaction.reply({ content: '❌ You are not a team captain in this tournament.', ephemeral: true });
  }

  if (memberToRemove.id === interaction.user.id) {
    return interaction.reply({ content: '❌ You cannot remove yourself. Use withdraw or transfer captain first.', ephemeral: true });
  }

  const memberIndex = team.members.findIndex(m => m.id === memberToRemove.id);
  if (memberIndex === -1) {
    return interaction.reply({ content: '❌ This user is not on your team.', ephemeral: true });
  }

  team.members.splice(memberIndex, 1);
  updateTournament(tournamentId, { teams: tournament.teams });
  await updateTournamentMessages(interaction, tournament);

  // DM the removed member
  try {
    await memberToRemove.send(`You've been removed from team **${team.name}** in **${tournament.title}**.`);
  } catch {}

  return interaction.reply({
    content: `✅ Removed **${memberToRemove.username}** from team **${team.name}**.`,
    ephemeral: true,
  });
}

async function handleTransfer(interaction) {
  const tournamentId = interaction.options.getString('tournament');
  const newCaptain = interaction.options.getUser('member');
  const tournament = getTournament(tournamentId);

  if (!tournament) {
    return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
  }

  if (tournament.status !== 'registration') {
    return interaction.reply({ content: '❌ Cannot transfer captain after registration closes.', ephemeral: true });
  }

  const team = tournament.teams.find(t => t.captain.id === interaction.user.id);
  if (!team) {
    return interaction.reply({ content: '❌ You are not a team captain in this tournament.', ephemeral: true });
  }

  const isMember = team.members.some(m => m.id === newCaptain.id);
  if (!isMember) {
    return interaction.reply({ content: '❌ This user is not on your team.', ephemeral: true });
  }

  team.captain = {
    id: newCaptain.id,
    username: newCaptain.username,
    displayName: newCaptain.displayName || newCaptain.username,
  };

  updateTournament(tournamentId, { teams: tournament.teams });
  await updateTournamentMessages(interaction, tournament);

  // DM the new captain
  try {
    await newCaptain.send(`You are now the captain of team **${team.name}** in **${tournament.title}**!`);
  } catch {}

  return interaction.reply({
    content: `✅ Transferred captain role to **${newCaptain.username}**.`,
    ephemeral: true,
  });
}

async function updateTournamentMessages(interaction, tournament) {
  try {
    const channel = await interaction.client.channels.fetch(tournament.channelId);

    if (tournament.messageId) {
      const mainMessage = await channel.messages.fetch(tournament.messageId);
      const embed = createTournamentEmbed(tournament);
      await mainMessage.edit({ embeds: [embed] });
    }

    if (tournament.participantListMessageId) {
      const listMessage = await channel.messages.fetch(tournament.participantListMessageId);
      const participantEmbed = createParticipantListEmbed(tournament);
      await listMessage.edit({ embeds: [participantEmbed] });
    }
  } catch (error) {
    console.error('Error updating tournament messages:', error);
  }
}
