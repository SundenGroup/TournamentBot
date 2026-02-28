const { Events } = require('discord.js');
const { rescheduleAllReminders } = require('../services/reminderService');
const { getSubscriptionsNeedingReset, resetMonthlyUsage, cleanupExpiredTokens } = require('../data/subscriptions');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Serving ${client.guilds.cache.size} guild(s)`);

    rescheduleAllReminders(client);

    // Reset monthly usage for any guilds past their reset date
    const subscriptionsToReset = getSubscriptionsNeedingReset();
    if (subscriptionsToReset.length > 0) {
      for (const sub of subscriptionsToReset) {
        resetMonthlyUsage(sub.guildId);
      }
      console.log(`Reset monthly usage for ${subscriptionsToReset.length} subscription(s)`);
    }

    // Clean up expired tokens
    const expiredTokensCleaned = cleanupExpiredTokens();
    if (expiredTokensCleaned > 0) {
      console.log(`Cleaned up expired tokens for ${expiredTokensCleaned} subscription(s)`);
    }
  },
};
