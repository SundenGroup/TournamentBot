const { Events } = require('discord.js');

/**
 * Safely reply to an interaction, catching any errors
 * (interaction token may have expired)
 */
async function safeErrorReply(interaction, message) {
  try {
    const reply = { content: message, ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  } catch (replyError) {
    // Interaction token expired or other issue - just log it
    console.error('Could not send error reply:', replyError.message);
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        await safeErrorReply(interaction, 'There was an error executing this command.');
      }
      return;
    }

    // Handle button interactions
    if (interaction.isButton()) {
      const [action, ...args] = interaction.customId.split(':');
      const button = interaction.client.buttons.get(action);

      if (!button) {
        console.error(`No button handler for ${action}`);
        return;
      }

      try {
        await button.execute(interaction, args);
      } catch (error) {
        console.error(`Error handling button ${action}:`, error);
        await safeErrorReply(interaction, 'There was an error processing this action.');
      }
      return;
    }

    // Handle select menu interactions
    if (interaction.isStringSelectMenu()) {
      const [action, ...args] = interaction.customId.split(':');
      const selectMenu = interaction.client.selectMenus.get(action);

      if (!selectMenu) {
        console.error(`No select menu handler for ${action}`);
        return;
      }

      try {
        await selectMenu.execute(interaction, args);
      } catch (error) {
        console.error(`Error handling select menu ${action}:`, error);
        await safeErrorReply(interaction, 'There was an error processing this selection.');
      }
      return;
    }

    // Handle role select menu interactions
    if (interaction.isRoleSelectMenu()) {
      const [action, ...args] = interaction.customId.split(':');
      const selectMenu = interaction.client.selectMenus.get(action);

      if (!selectMenu) {
        console.error(`No select menu handler for ${action}`);
        return;
      }

      try {
        await selectMenu.execute(interaction, args);
      } catch (error) {
        console.error(`Error handling role select menu ${action}:`, error);
        await safeErrorReply(interaction, 'There was an error processing this selection.');
      }
      return;
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
      const [action, ...args] = interaction.customId.split(':');
      const modal = interaction.client.modals.get(action);

      if (!modal) {
        console.error(`No modal handler for ${action}`);
        return;
      }

      try {
        await modal.execute(interaction, args);
      } catch (error) {
        console.error(`Error handling modal ${action}:`, error);
        await safeErrorReply(interaction, 'There was an error processing this form.');
      }
      return;
    }

    // Handle autocomplete
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command || !command.autocomplete) {
        return;
      }

      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(`Error handling autocomplete for ${interaction.commandName}:`, error);
      }
      return;
    }
  },
};
