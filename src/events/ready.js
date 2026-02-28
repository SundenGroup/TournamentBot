const { Events } = require('discord.js');
const cron = require('node-cron');
const { rescheduleAllReminders } = require('../services/reminderService');
const { getSubscriptionsNeedingReset, resetMonthlyUsage, cleanupExpiredTokens } = require('../data/subscriptions');

function runSubscriptionMaintenance() {
  // Reset monthly usage for any guilds past their reset date
  const subscriptionsToReset = getSubscriptionsNeedingReset();
  if (subscriptionsToReset.length > 0) {
    for (const sub of subscriptionsToReset) {
      resetMonthlyUsage(sub.guildId);
    }
    console.log(`[Maintenance] Reset monthly usage for ${subscriptionsToReset.length} subscription(s)`);
  }

  // Clean up expired tokens
  const expiredTokensCleaned = cleanupExpiredTokens();
  if (expiredTokensCleaned > 0) {
    console.log(`[Maintenance] Cleaned up expired tokens for ${expiredTokensCleaned} subscription(s)`);
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Serving ${client.guilds.cache.size} guild(s)`);

    rescheduleAllReminders(client);

    // Run maintenance on startup
    runSubscriptionMaintenance();

    // Schedule maintenance every hour
    cron.schedule('0 * * * *', () => {
      console.log('[Maintenance] Running hourly subscription maintenance...');
      runSubscriptionMaintenance();
    });

    console.log('Scheduled hourly subscription maintenance');
  },
};
