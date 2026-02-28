const { EmbedBuilder } = require('discord.js');
const { getTournament, updateTournament } = require('../services/tournamentService');
const { canManageTournaments } = require('../utils/permissions');
const { createTournamentEmbed, createTournamentButtons, createParticipantListEmbed } = require('../utils/embedBuilder');
const singleElim = require('../services/singleEliminationService');
const doubleElim = require('../services/doubleEliminationService');
const swiss = require('../services/swissService');
const roundRobin = require('../services/roundRobinService');
const battleRoyale = require('../services/battleRoyaleService');
const { createMatchRoom, createBRGroupRoom } = require('../services/channelService');
const webhooks = require('../services/webhookService');

module.exports = {
  customId: 'startTournament',
  async execute(interaction, args) {
    const tournamentId = args[0];
    const tournament = getTournament(tournamentId);

    if (!tournament) {
      return interaction.reply({ content: '❌ Tournament not found.', ephemeral: true });
    }

    // Check permissions - admin only
    if (!canManageTournaments(interaction.member)) {
      return interaction.reply({ content: '❌ Only tournament admins can start tournaments.', ephemeral: true });
    }

    if (tournament.status !== 'registration' && tournament.status !== 'checkin') {
      return interaction.reply({ content: '❌ Tournament is not in registration/checkin phase.', ephemeral: true });
    }

    const isSolo = tournament.settings.teamSize === 1;
    const participants = isSolo ? tournament.participants : tournament.teams;
    const participantCount = participants.length;

    if (participantCount < 2) {
      return interaction.reply({ content: '❌ Need at least 2 participants to start.', ephemeral: true });
    }

    // Immediately mark as active to prevent concurrent starts
    updateTournament(tournamentId, { status: 'active' });

    await interaction.deferReply({ ephemeral: true });

    try {
      // Resolve pending team members (captain mode)
      if (!isSolo && tournament.settings.captainMode) {
        const { resolveTeamMembers } = require('../services/tournamentService');
        const { resolved, failed } = await resolveTeamMembers(interaction.guild, tournament);
        if (resolved > 0 || failed > 0) {
          console.log(`Captain mode resolution for "${tournament.title}": ${resolved} resolved, ${failed} failed`);
        }
        updateTournament(tournamentId, { teams: tournament.teams });
      }

      // Select service based on format
      const format = tournament.settings.format;
      let service;
      let bracket;

      switch (format) {
        case 'double_elimination':
          service = doubleElim;
          bracket = doubleElim.generateBracket(participants, tournament.settings);
          break;
        case 'swiss':
          service = swiss;
          bracket = swiss.generateBracket(participants, tournament.settings);
          break;
        case 'round_robin':
          service = roundRobin;
          bracket = roundRobin.generateBracket(participants, tournament.settings);
          break;
        case 'battle_royale':
          service = battleRoyale;
          bracket = battleRoyale.generateBracket(participants, tournament.settings);
          break;
        case 'single_elimination':
        default:
          service = singleElim;
          bracket = singleElim.generateBracket(participants, tournament.settings);
          break;
      }

      tournament.bracket = bracket;
      tournament.status = 'active';

      // Get active matches that need rooms
      let roomsCreated = 0;
      if (format === 'battle_royale') {
        // Create ONE lobby room per group (used for all games in that group)
        for (const group of bracket.groups) {
          try {
            const channel = await createBRGroupRoom(interaction.guild, group, tournament);
            group.channelId = channel.id;
            roomsCreated++;
          } catch (error) {
            console.error('Error creating BR group room:', error);
          }
        }
      } else {
        const activeMatches = service.getActiveMatches(bracket);

        // Create match rooms for first round
        for (const match of activeMatches) {
          if (match.participant1 && match.participant2) {
            try {
              const channel = await createMatchRoom(interaction.guild, match, tournament);
              match.channelId = channel.id;
              roomsCreated++;
            } catch (error) {
              console.error('Error creating match room:', error);
            }
          }
        }
      }

      updateTournament(tournamentId, { bracket, status: 'active' });

      // Trigger webhook
      webhooks.onTournamentStarted(tournament);

      // Update the tournament announcement message
      await updateTournamentMessages(interaction, tournament);

      // Send confirmation
      const formatNames = {
        single_elimination: 'Single Elimination',
        double_elimination: 'Double Elimination',
        swiss: 'Swiss',
        round_robin: 'Round Robin',
        battle_royale: 'Battle Royale',
      };

      let description = `**${tournament.title}** is now live!\n\n`;
      description += `• ${participantCount} ${isSolo ? 'players' : 'teams'} competing\n`;
      description += `• ${roomsCreated} ${format === 'battle_royale' ? 'lobby' : 'match'} rooms created\n`;
      description += `• Format: ${formatNames[format] || format}\n`;

      if (format === 'swiss') {
        description += `• Rounds: ${bracket.totalRounds}\n`;
      } else if (format === 'round_robin') {
        description += `• Rounds: ${bracket.totalRounds}\n`;
        description += `• Total Matches: ${bracket.totalMatches}\n`;
      } else if (format === 'battle_royale') {
        description += `• Groups: ${bracket.groups.length}\n`;
        description += `• Games per Stage: ${bracket.gamesPerStage}\n`;
        description += `• Teams to Finals: ${bracket.totalAdvancing}\n`;
      }

      if (format === 'battle_royale') {
        description += `\nUse \`/match bracket\` to view group standings.`;
        description += `\nUse \`/tournament br-report\` to report game results.`;
      } else {
        description += `\nUse \`/match list\` to see active matches.`;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🚀 Tournament Started!`)
        .setColor(0x2ecc71)
        .setDescription(description);

      if (tournament.game.logo) {
        embed.setThumbnail(tournament.game.logo);
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error starting tournament:', error);
      await interaction.editReply({ content: `❌ Error starting tournament: ${error.message}` });
    }
  },
};

async function updateTournamentMessages(interaction, tournament) {
  try {
    const channel = await interaction.client.channels.fetch(tournament.channelId);

    if (tournament.messageId) {
      const mainMessage = await channel.messages.fetch(tournament.messageId);
      const embed = createTournamentEmbed(tournament);
      const buttons = createTournamentButtons(tournament);
      await mainMessage.edit({ embeds: [embed], components: buttons });
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
