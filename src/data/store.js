// In-memory data store
// Will be replaced with database in future

const tournaments = new Map();
const serverSettings = new Map();

module.exports = {
  tournaments,
  serverSettings,
};
