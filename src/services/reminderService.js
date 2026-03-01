const cron = require('node-cron');
const { tournaments } = require('../data/store');

// Store scheduled jobs
const scheduledJobs = new Map();

function scheduleReminders(tournament, client) {
  const tournamentId = tournament.id;

  // Cancel any existing jobs for this tournament
  cancelReminders(tournamentId);

  const jobs = [];
  const startTime = new Date(tournament.startTime).getTime();
  const now = Date.now();

  // 24 hour reminder
  const reminder24h = startTime - (24 * 60 * 60 * 1000);
  if (reminder24h > now) {
    const job24h = scheduleAt(reminder24h, () => {
      sendReminder(tournament, client, '24 hours');
    });
    if (job24h) jobs.push(job24h);
  }

  // 1 hour reminder
  const reminder1h = startTime - (60 * 60 * 1000);
  if (reminder1h > now) {
    const job1h = scheduleAt(reminder1h, () => {
      sendReminder(tournament, client, '1 hour');
    });
    if (job1h) jobs.push(job1h);
  }

  // Check-in open reminder (if enabled)
  if (tournament.settings.checkinRequired) {
    const checkinTime = startTime - (tournament.settings.checkinWindow * 60 * 1000);
    if (checkinTime > now) {
      const jobCheckin = scheduleAt(checkinTime, () => {
        openCheckin(tournament, client);
      });
      if (jobCheckin) jobs.push(jobCheckin);
    }
  }

  // Tournament start
  if (startTime > now) {
    const jobStart = scheduleAt(startTime, () => {
      handleTournamentStart(tournament, client);
    });
    if (jobStart) jobs.push(jobStart);
  }

  if (jobs.length > 0) {
    scheduledJobs.set(tournamentId, jobs);
  }

  console.log(`Scheduled ${jobs.length} reminder(s) for tournament: ${tournament.title}`);
}

function scheduleAt(timestamp, callback) {
  const delay = timestamp - Date.now();
  if (delay <= 0) return null;

  // Use setTimeout for simplicity (cron is overkill for one-time events)
  const timeout = setTimeout(callback, delay);
  return { timeout, timestamp };
}

function cancelReminders(tournamentId) {
  const jobs = scheduledJobs.get(tournamentId);
  if (jobs) {
    for (const job of jobs) {
      if (job.timeout) {
        clearTimeout(job.timeout);
      }
    }
    scheduledJobs.delete(tournamentId);
  }
}

async function sendReminder(tournament, client, timeString) {
  // Refresh tournament data
  const current = tournaments.get(tournament.id);
  if (!current || current.status === 'cancelled' || current.status === 'completed') {
    return;
  }

  const isSolo = current.settings.teamSize === 1;
  const message = `⏰ Reminder: **${current.title}** starts in ${timeString}!`;

  // Post to tournament channel
  try {
    const channel = await client.channels.fetch(current.channelId);
    if (channel) {
      await channel.send(message);
    }
  } catch {}

  if (isSolo) {
    for (const participant of current.participants) {
      if (participant.id.startsWith('fake_')) continue; // Skip fake users
      try {
        const user = await client.users.fetch(participant.id);
        await user.send(message);
      } catch (error) {
        // Can't DM user
      }
    }
  } else {
    for (const team of current.teams) {
      if (team.isFake) continue; // Skip fake teams
      for (const member of team.members) {
        if (!member.id || member.id.startsWith('fake_')) continue;
        try {
          const user = await client.users.fetch(member.id);
          await user.send(message);
        } catch (error) {
          // Can't DM user
        }
      }
    }
  }

  console.log(`Sent ${timeString} reminders for: ${current.title}`);
}

async function openCheckin(tournament, client) {
  const current = tournaments.get(tournament.id);
  if (!current || current.status !== 'registration') {
    return;
  }

  current.status = 'checkin';
  current.checkinOpen = true;
  tournaments.set(tournament.id, current);

  // Persist to database
  const { updateTournament } = require('./tournamentService');
  await updateTournament(tournament.id, { status: 'checkin', checkinOpen: true });

  // Update tournament message with check-in button
  try {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const { createTournamentEmbed, createParticipantListEmbed } = require('../utils/embedBuilder');

    const channel = await client.channels.fetch(current.channelId);

    const isSolo = current.settings.teamSize === 1;
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`checkin:${current.id}`)
        .setLabel('Check In')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`signup:${current.id}`)
        .setLabel(isSolo ? 'Sign Up' : 'Register Team')
        .setEmoji(isSolo ? '✅' : '🎯')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`withdraw:${current.id}`)
        .setLabel(isSolo ? 'Withdraw' : 'Withdraw Team')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    if (current.messageId) {
      const mainMessage = await channel.messages.fetch(current.messageId);
      const embed = await createTournamentEmbed(current);
      await mainMessage.edit({ embeds: [embed], components: [buttons] });
    }

    // Notify channel
    await channel.send(`📢 **Check-in is now open for ${current.title}!** You have ${current.settings.checkinWindow} minutes to check in.`);

    // DM participants
    const dmMessage = `✅ Check-in is now open for **${current.title}**! Please check in within ${current.settings.checkinWindow} minutes.`;

    if (isSolo) {
      for (const participant of current.participants) {
        if (participant.id.startsWith('fake_')) continue;
        try {
          const user = await client.users.fetch(participant.id);
          await user.send(dmMessage);
        } catch {}
      }
    } else {
      for (const team of current.teams) {
        if (team.isFake) continue;
        for (const member of team.members) {
          if (!member.id || member.id.startsWith('fake_')) continue;
          try {
            const user = await client.users.fetch(member.id);
            await user.send(dmMessage);
          } catch {}
        }
      }
    }
  } catch (error) {
    console.error('Error opening check-in:', error);
  }

  console.log(`Opened check-in for: ${current.title}`);
}

async function handleTournamentStart(tournament, client) {
  const current = tournaments.get(tournament.id);
  if (!current || current.status === 'cancelled' || current.status === 'completed' || current.status === 'active') {
    return;
  }

  // Remove no-shows if check-in was required
  if (current.settings.checkinRequired) {
    const isSolo = current.settings.teamSize === 1;

    if (isSolo) {
      const before = current.participants.length;
      current.participants = current.participants.filter(p => p.checkedIn || p.isFake);
      const removed = before - current.participants.length;
      if (removed > 0) {
        console.log(`Removed ${removed} no-shows from ${current.title}`);
      }
    } else {
      const before = current.teams.length;
      current.teams = current.teams.filter(t => t.checkedIn || t.isFake);
      const removed = before - current.teams.length;
      if (removed > 0) {
        console.log(`Removed ${removed} team no-shows from ${current.title}`);
      }
    }
  }

  current.checkinOpen = false;
  tournaments.set(tournament.id, current);

  // Persist to database
  const { updateTournament } = require('./tournamentService');
  await updateTournament(tournament.id, {
    checkinOpen: false,
    participants: current.participants,
    teams: current.teams,
  });

  // Notify channel that tournament is ready to start
  try {
    const channel = await client.channels.fetch(current.channelId);
    const isSolo = current.settings.teamSize === 1;
    const count = isSolo ? current.participants.length : current.teams.length;

    await channel.send(
      `🎮 **${current.title}** is ready to begin!\n` +
      `${count} ${isSolo ? 'players' : 'teams'} are registered.\n` +
      `An admin can now use \`/tournament start\` to generate brackets.`
    );
  } catch (error) {
    console.error('Error notifying tournament start:', error);
  }
}

function rescheduleAllReminders(client) {
  let count = 0;
  for (const [, tournament] of tournaments) {
    if (
      (tournament.status === 'registration' || tournament.status === 'checkin') &&
      tournament.startTime &&
      new Date(tournament.startTime).getTime() > Date.now()
    ) {
      scheduleReminders(tournament, client);
      count++;
    }
  }
  console.log(`Re-scheduled reminders for ${count} active tournament(s)`);
}

module.exports = {
  scheduleReminders,
  cancelReminders,
  rescheduleAllReminders,
  openCheckin,
};
