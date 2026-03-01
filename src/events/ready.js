const { Events } = require('discord.js');
const cron = require('node-cron');
const { rescheduleAllReminders } = require('../services/reminderService');
const { getSubscriptionsNeedingReset, resetMonthlyUsage, cleanupExpiredTokens } = require('../data/subscriptions');
const { cleanupExpiredSessions } = require('../data/wizardSessions');

async function runSubscriptionMaintenance() {
  // Reset monthly usage for any guilds past their reset date
  const subscriptionsToReset = await getSubscriptionsNeedingReset();
  if (subscriptionsToReset.length > 0) {
    for (const sub of subscriptionsToReset) {
      await resetMonthlyUsage(sub.guildId);
    }
    console.log(`[Maintenance] Reset monthly usage for ${subscriptionsToReset.length} subscription(s)`);
  }

  // Clean up expired tokens
  const expiredTokensCleaned = await cleanupExpiredTokens();
  if (expiredTokensCleaned > 0) {
    console.log(`[Maintenance] Cleaned up expired tokens for ${expiredTokensCleaned} subscription(s)`);
  }

  // Clean up expired wizard sessions
  const expiredSessionsCleaned = await cleanupExpiredSessions();
  if (expiredSessionsCleaned > 0) {
    console.log(`[Maintenance] Cleaned up ${expiredSessionsCleaned} expired wizard session(s)`);
  }
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Serving ${client.guilds.cache.size} guild(s)`);

    rescheduleAllReminders(client);

    // Run maintenance on startup
    await runSubscriptionMaintenance();

    // Schedule maintenance every hour
    cron.schedule('0 * * * *', async () => {
      console.log('[Maintenance] Running hourly subscription maintenance...');
      await runSubscriptionMaintenance();
    });

    console.log('Scheduled hourly subscription maintenance');
  },
};
