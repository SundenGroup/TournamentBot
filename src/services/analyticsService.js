// Analytics service
// Provides tournament statistics for Pro+ users

const { EmbedBuilder } = require('discord.js');
const { getTournamentsByGuild } = require('./tournamentService');

/**
 * Get analytics data for a guild
 */
function getGuildAnalytics(guildId) {
  const tournaments = getTournamentsByGuild(guildId);

  if (tournaments.length === 0) {
    return null;
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Basic counts
  const total = tournaments.length;
  const completed = tournaments.filter(t => t.status === 'completed').length;
  const cancelled = tournaments.filter(t => t.status === 'cancelled').length;
  const active = tournaments.filter(t => t.status === 'active').length;
  const registration = tournaments.filter(t => t.status === 'registration' || t.status === 'checkin').length;

  // Time-based counts
  const last30Days = tournaments.filter(t => new Date(t.createdAt) >= thirtyDaysAgo).length;
  const last7Days = tournaments.filter(t => new Date(t.createdAt) >= sevenDaysAgo).length;

  // Completion rate
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Participant stats
  let totalParticipants = 0;
  let maxParticipants = 0;
  let participantCounts = [];

  for (const t of tournaments) {
    const isSolo = t.settings.teamSize === 1;
    const count = isSolo ? (t.participants?.length || 0) : (t.teams?.length || 0);
    totalParticipants += count;
    participantCounts.push(count);
    if (count > maxParticipants) maxParticipants = count;
  }

  const avgParticipants = participantCounts.length > 0
    ? Math.round(totalParticipants / participantCounts.length)
    : 0;

  // Format breakdown
  const formatCounts = {};
  for (const t of tournaments) {
    const format = t.settings.format || 'single_elimination';
    formatCounts[format] = (formatCounts[format] || 0) + 1;
  }

  // Game breakdown
  const gameCounts = {};
  for (const t of tournaments) {
    const game = t.game?.displayName || 'Custom';
    gameCounts[game] = (gameCounts[game] || 0) + 1;
  }

  // Team size breakdown
  const teamSizeCounts = {};
  for (const t of tournaments) {
    const size = t.settings.teamSize || 1;
    const label = size === 1 ? 'Solo' : `${size}v${size}`;
    teamSizeCounts[label] = (teamSizeCounts[label] || 0) + 1;
  }

  // Peak activity (day of week)
  const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
  for (const t of tournaments) {
    const day = new Date(t.createdAt).getDay();
    dayOfWeekCounts[day]++;
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const peakDayIndex = dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts));
  const peakDay = dayNames[peakDayIndex];

  return {
    total,
    completed,
    cancelled,
    active,
    registration,
    last30Days,
    last7Days,
    completionRate,
    totalParticipants,
    avgParticipants,
    maxParticipants,
    formatCounts,
    gameCounts,
    teamSizeCounts,
    peakDay,
  };
}

/**
 * Get analytics embed
 */
function getAnalyticsEmbed(guildId, guildName) {
  const analytics = getGuildAnalytics(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📊 Tournament Analytics')
    .setDescription(`Statistics for **${guildName}**`);

  if (!analytics) {
    embed.addFields({
      name: 'No Data',
      value: 'No tournaments have been created yet. Create some tournaments to see analytics!',
    });
    return embed;
  }

  // Overview
  embed.addFields(
    {
      name: '📈 Overview',
      value: [
        `**Total Tournaments:** ${analytics.total}`,
        `**Completed:** ${analytics.completed} (${analytics.completionRate}%)`,
        `**Cancelled:** ${analytics.cancelled}`,
        `**Active:** ${analytics.active}`,
        `**Registering:** ${analytics.registration}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '👥 Participants',
      value: [
        `**Total:** ${analytics.totalParticipants}`,
        `**Average:** ${analytics.avgParticipants}/tournament`,
        `**Largest:** ${analytics.maxParticipants}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '📅 Activity',
      value: [
        `**Last 7 days:** ${analytics.last7Days}`,
        `**Last 30 days:** ${analytics.last30Days}`,
        `**Peak day:** ${analytics.peakDay}`,
      ].join('\n'),
      inline: true,
    }
  );

  // Format breakdown
  const formatNames = {
    single_elimination: 'Single Elim',
    double_elimination: 'Double Elim',
    swiss: 'Swiss',
    round_robin: 'Round Robin',
    battle_royale: 'Battle Royale',
  };

  const formatLines = Object.entries(analytics.formatCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([format, count]) => {
      const percent = Math.round((count / analytics.total) * 100);
      return `${formatNames[format] || format}: ${count} (${percent}%)`;
    });

  if (formatLines.length > 0) {
    embed.addFields({
      name: '🎮 Formats',
      value: formatLines.join('\n'),
      inline: true,
    });
  }

  // Game breakdown (top 5)
  const gameLines = Object.entries(analytics.gameCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([game, count]) => {
      const percent = Math.round((count / analytics.total) * 100);
      return `${game}: ${count} (${percent}%)`;
    });

  if (gameLines.length > 0) {
    embed.addFields({
      name: '🎯 Games',
      value: gameLines.join('\n'),
      inline: true,
    });
  }

  // Team size breakdown
  const teamSizeLines = Object.entries(analytics.teamSizeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([size, count]) => {
      const percent = Math.round((count / analytics.total) * 100);
      return `${size}: ${count} (${percent}%)`;
    });

  if (teamSizeLines.length > 0) {
    embed.addFields({
      name: '👤 Team Sizes',
      value: teamSizeLines.join('\n'),
      inline: true,
    });
  }

  embed.setFooter({ text: 'Pro feature • Data since first tournament' });
  embed.setTimestamp();

  return embed;
}

module.exports = {
  getGuildAnalytics,
  getAnalyticsEmbed,
};
