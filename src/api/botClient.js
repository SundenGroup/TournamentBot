// Holds a reference to the running discord.js client so web-admin handlers can
// reach Discord (guild/member lookups) — the API server shares the bot's process.
let client = null;

module.exports = {
  setClient(c) { client = c; },
  getClient() { return client; },
};
