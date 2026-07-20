const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBranding } = require('../data/subscriptions');
const { getEffectiveTier } = require('../services/subscriptionService');
const config = require('../config');

/** Public live-bracket page URL for a tournament (Pro/Business feature). */
function getBracketUrl(tournament) {
  if (!tournament.settings?.publicBracket) return null;
  return `${config.publicBaseUrl}/b/${tournament.id}`;
}

/**
 * Apply branding to an embed if Business tier
 */
async function applyBranding(embed, guildId) {
  // Only apply branding for Business tier
  const tier = await getEffectiveTier(guildId);
  if (tier !== 'studio') return embed;

  const branding = await getBranding(guildId);
  if (!branding) return embed;

  // Apply custom accent color
  if (branding.accentColor) {
    embed.setColor(parseInt(branding.accentColor.replace('#', ''), 16));
  }

  // Apply custom author (bot name + avatar)
  if (branding.botName || branding.botAvatar) {
    embed.setAuthor({
      name: branding.botName || 'Tournament Bot',
      iconURL: branding.botAvatar || undefined,
    });
  }

  // Apply custom footer
  if (branding.footerText) {
    const existingFooter = embed.data.footer?.text;
    embed.setFooter({
      text: existingFooter ? `${existingFooter} • ${branding.footerText}` : branding.footerText,
    });
  }

  return embed;
}

async function createTournamentEmbed(tournament) {
  const { game, settings, title, description, startTime, status, participants, teams } = tournament;
  const isSolo = settings.teamSize === 1;
  const currentCount = isSolo ? participants.length : teams.length;
  const maxCount = settings.maxParticipants;

  const embed = new EmbedBuilder()
    .setTitle(`${getStatusEmoji(status)} ${title}`)
    .setColor(getStatusColor(status));

  // Status banner (the 📝/✅/🎮 status emoji lives in the title only — it used
  // to also prefix the description, which read as two different markers).
  const statusText = getStatusText(status);
  let descriptionText = `**Status: ${statusText}**\n\n`;

  if (description) {
    descriptionText += `${description}\n\n`;
  }

  embed.setDescription(descriptionText);

  const fields = [
    { name: '🎮 Game', value: `${require('../config/gamePresets').getGameEmojiText(game)} ${game.displayName}`, inline: true },
    { name: '📅 Date', value: formatDate(startTime), inline: true },
    { name: isSolo ? '👥 Players' : '👥 Teams', value: `${currentCount} / ${maxCount}`, inline: true },
  ];

  if (!isSolo) {
    fields.push({ name: '👤 Team Size', value: `${settings.teamSize} players`, inline: true });
  }

  const formatNames = {
    single_elimination: 'Single Elimination',
    double_elimination: 'Double Elimination',
    swiss: 'Swiss',
    round_robin: 'Round Robin',
    battle_royale: 'Battle Royale',
  };
  const formatDisplay = formatNames[settings.format] || settings.format;
  if (settings.format === 'battle_royale') {
    fields.push({ name: '🔄 Format', value: `${formatDisplay} · ${settings.gamesPerStage || 3} games`, inline: true });
    if (settings.brScoring?.label) {
      fields.push({ name: '🏆 Scoring', value: settings.brScoring.label, inline: true });
    }
  } else {
    // Bo1 is the default — only call out a series length worth knowing about
    fields.push({ name: '🔄 Format', value: settings.bestOf > 1 ? `${formatDisplay} (Bo${settings.bestOf})` : formatDisplay, inline: true });
  }

  // Separate signup deadline (e.g. to leave a seeding window before start)
  if (settings.signupCloseTime && (status === 'registration' || status === 'checkin')) {
    const closeAt = new Date(settings.signupCloseTime);
    fields.push({
      name: '🕓 Signups close',
      value: closeAt.getTime() <= Date.now() ? 'Closed' : formatDate(closeAt),
      inline: true,
    });
  }

  if (settings.checkinRequired && status === 'registration') {
    fields.push({ name: '✅ Check-in', value: `${settings.checkinWindow} min before start`, inline: true });
  }

  if (settings.seedingEnabled) {
    fields.push({ name: '🌱 Seeding', value: 'Enabled', inline: true });
  }

  if (settings.requireGameNick) {
    // Fixed-width label, game-specific text in the value — long names like
    // "GOALS Username + ID" wrap badly as bold field names in the grid.
    const { getNickSummary } = require('../config/gamePresets');
    fields.push({ name: '🪪 Signup info', value: `${getNickSummary(game)} required`, inline: true });
  }

  if (settings.requiredRoles && settings.requiredRoles.length > 0) {
    fields.push({
      name: '🔒 Required Roles',
      value: settings.requiredRoles.map(id => `<@&${id}>`).join(', '),
      inline: true,
    });
  }

  // Masked link instead of the raw two-line URL (the Live Bracket button
  // carries the same link; this keeps it visible when the embed is forwarded).
  const bracketUrl = getBracketUrl(tournament);
  if (bracketUrl) {
    fields.push({ name: '🌐 Live Bracket', value: `[Watch live ↗](${bracketUrl})`, inline: true });
  }

  embed.addFields(fields);

  // Add game logo as thumbnail if available
  if (game.logo) {
    embed.setThumbnail(game.logo);
  }

  if (tournament.setupMode === 'simple') {
    embed.setFooter({ text: '⚙️ Created with Simple Mode' });
  }

  // Apply white-label branding for Business tier
  await applyBranding(embed, tournament.guildId);

  return embed;
}

function signupsClosed(tournament) {
  const t = tournament.settings?.signupCloseTime;
  return !!t && new Date(t).getTime() <= Date.now();
}

function createTournamentButtons(tournament) {
  const { status, settings, id } = tournament;
  const isSolo = settings.teamSize === 1;
  const rows = [];

  // Row 1: Registration/Check-in buttons
  const row1 = new ActionRowBuilder();

  if (status === 'checkin') {
    // Check-in is the primary action, but signups stay open through the window
    // (latecomers are auto-checked-in) and players can still withdraw.
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`checkin:${id}`)
        .setLabel('Check In')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    );
  }

  if (status === 'registration' || status === 'checkin') {
    // Past a separate signup deadline the Sign Up button disappears (the
    // embed says "Signups close: Closed"); withdrawing stays possible.
    if (!signupsClosed(tournament)) {
      row1.addComponents(
        new ButtonBuilder()
          .setCustomId(`signup:${id}`)
          .setLabel(isSolo ? 'Sign Up' : 'Register Team')
          .setEmoji(isSolo ? '✅' : '🎯')
          .setStyle(ButtonStyle.Primary)
      );
    }
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`withdraw:${id}`)
        .setLabel(isSolo ? 'Withdraw' : 'Withdraw Team')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (row1.components.length > 0) {
    rows.push(row1);
  }

  // Row 2: View buttons first, admin Start last — red Danger read as
  // "destructive" and pulled player eyes to an admin-only control.
  const row2 = new ActionRowBuilder();

  if (status === 'active' && tournament.bracket) {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`viewBracket:${id}`)
        .setLabel('View Bracket')
        .setEmoji('📊')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (status === 'completed' && tournament.bracket) {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`viewResults:${id}`)
        .setLabel('Show Complete Results')
        .setEmoji('🏆')
        .setStyle(ButtonStyle.Success)
    );
  }

  // Live web bracket link (Pro/Business, toggled at creation)
  const bracketUrl = getBracketUrl(tournament);
  if (bracketUrl) {
    row2.addComponents(
      new ButtonBuilder()
        .setLabel('Live Bracket')
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Link)
        .setURL(bracketUrl)
    );
  }

  // Admins can start from registration AND during check-in (the click is
  // permission-gated in startTournament.js; non-admins get a polite refusal).
  if (status === 'registration' || status === 'checkin') {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`startTournament:${id}`)
        .setLabel('Start Tournament')
        .setEmoji('🚀')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (row2.components.length > 0) {
    rows.push(row2);
  }

  return rows;
}

async function createParticipantListEmbed(tournament) {
  const { settings, participants, teams, title, status, guildId } = tournament;
  const isSolo = settings.teamSize === 1;

  // `gameNick` holds only the PUBLIC signup value (e.g. GOALS Username);
  // private ids (GOALS User ID) live in gameFields and never reach this list,
  // which is posted in the public announcement channel.
  const embed = new EmbedBuilder()
    .setColor(getStatusColor(status));

  // Two caps on the public list: 128 entries (a scrollable wall past that —
  // the web bracket is the real home for big fields) and 4096 embed chars
  // (Discord rejects the edit outright, freezing the list mid-registration).
  const bracketUrl = getBracketUrl(tournament);
  const joinCapped = (entries, sep, total, noun) => {
    const ENTRY_CAP = 128;
    const budget = 3900; // headroom for the "+N more" line
    const out = [];
    let used = 0;
    for (const e of entries.slice(0, ENTRY_CAP)) {
      if (used + e.length + sep.length > budget) break;
      out.push(e);
      used += e.length + sep.length;
    }
    let text = out.join(sep);
    if (out.length < total) {
      const more = `…and **${total - out.length}** more ${noun}`;
      text += bracketUrl
        ? `\n${more} — [full list on the live bracket](${bracketUrl})`
        : `\n${more}`;
    }
    return text;
  };

  if (isSolo) {
    embed.setTitle(`📋 Signed Up (${participants.length}/${settings.maxParticipants})`);
    if (participants.length === 0) {
      embed.setDescription('No participants yet.');
    } else {
      const entries = participants.map((p, i) => {
        let entry = `${i + 1}. ${p.username}`;
        if (p.gameNick) entry += ` (${p.gameNick})`;
        if (p.seed) entry += ` [#${p.seed}]`;
        if (p.disqualified) entry += ' 🚫DQ';
        if (status === 'checkin') {
          entry += p.checkedIn ? ' ✓' : ' ⏳';
        }
        return entry;
      });
      embed.setDescription(joinCapped(entries, '\n', participants.length, 'players'));
    }
  } else {
    embed.setTitle(`📋 Registered Teams (${teams.length}/${settings.maxParticipants})`);
    if (teams.length === 0) {
      embed.setDescription('No teams registered yet.');
    } else {
      const entries = teams.map((t, i) => {
        const members = t.members.map(m => m.pending ? `${m.username} (pending)` : m.username).join(', ');
        let entry = `**${i + 1}. ${t.name}** (Captain: ${t.captain.username})`;
        if (t.seed) entry += ` [#${t.seed}]`;
        if (t.disqualified) entry += ' 🚫DQ';
        if (status === 'checkin') {
          const checkedIn = Object.keys(t.memberCheckins || {}).length;
          entry += ` (${checkedIn}/${settings.teamSize} checked in)`;
        }
        entry += `\n└ ${members}`;
        return entry;
      });
      embed.setDescription(joinCapped(entries, '\n\n', teams.length, 'teams'));
    }
  }

  // Apply white-label branding for Business tier
  await applyBranding(embed, guildId);

  return embed;
}

function getStatusColor(status) {
  const colors = {
    registration: 0x3498db,  // Blue
    checkin: 0xf39c12,       // Orange
    active: 0x2ecc71,        // Green
    completed: 0x9b59b6,     // Purple
    cancelled: 0xe74c3c,     // Red
  };
  return colors[status] || 0x95a5a6;
}

function getStatusEmoji(status) {
  const emojis = {
    registration: '📝',
    checkin: '✅',
    active: '🎮',
    completed: '🏆',
    cancelled: '❌',
  };
  return emojis[status] || '📋';
}

function getStatusText(status) {
  const texts = {
    registration: 'Registration Open',
    checkin: 'Check-in Open',
    active: 'Tournament In Progress',
    completed: 'Tournament Completed',
    cancelled: 'Tournament Cancelled',
  };
  return texts[status] || status;
}

function formatDate(date) {
  if (!date) return 'TBD';
  const { toDiscordShortAndRelative } = require('./timeUtils');
  return toDiscordShortAndRelative(date);
}

module.exports = {
  createTournamentEmbed,
  createTournamentButtons,
  createParticipantListEmbed,
  applyBranding,
  getBracketUrl,
  signupsClosed,
  getStatusColor,
  getStatusEmoji,
  getStatusText,
  formatDate,
};
