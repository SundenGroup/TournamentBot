// "Keep my spot" on the withdraw confirm — nothing happens, on purpose.
module.exports = {
  customId: 'withdrawCancel',
  async execute(interaction) {
    return interaction.update({ content: "👍 You're still in — nothing changed.", components: [] });
  },
};
