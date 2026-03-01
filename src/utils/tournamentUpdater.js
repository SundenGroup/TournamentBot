const { createTournamentEmbed, createTournamentButtons, createParticipantListEmbed } = require('./embedBuilder');

async function updateTournamentMessages(client, tournament) {
  try {
    const channel = await client.channels.fetch(tournament.channelId);

    if (tournament.messageId) {
      const mainMessage = await channel.messages.fetch(tournament.messageId);
      const embed = await createTournamentEmbed(tournament);
      const buttons = createTournamentButtons(tournament);
      await mainMessage.edit({ embeds: [embed], components: buttons });
    }

    if (tournament.participantListMessageId) {
      const listMessage = await channel.messages.fetch(tournament.participantListMessageId);
      const participantEmbed = await createParticipantListEmbed(tournament);
      await listMessage.edit({ embeds: [participantEmbed] });
    }
  } catch (error) {
    console.error('Error updating tournament messages:', error);
  }
}

module.exports = {
  updateTournamentMessages,
};
