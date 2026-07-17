// Transcript archiving — the Support-bot model ported to tournaments
// (docs/CHANNEL-CAPACITY-PLAN.md, Phase 2).
//
// "Archive" here means: fetch the room's full history → persist it in
// Postgres (match_transcripts) → optionally mirror an HTML file to the
// server's admin-only #match-logs channel → DELETE the channel. Unlike the
// old move-to-category behavior, this actually frees the 500-channel cap
// while keeping every message browsable from the web dashboard forever.

const { v4: uuidv4 } = require('uuid');
const { ChannelType, PermissionFlagsBits, OverwriteType, AttachmentBuilder } = require('discord.js');
const db = require('../db');
const { getServerSettings, updateServerSettings } = require('../data/serverSettings');

// Bound the fetch so a runaway room can't balloon memory; match rooms are
// short-lived — 2000 messages is far beyond any real match.
const MAX_MESSAGES = 2000;

// ============================================================================
// History fetch + serialization
// ============================================================================

async function fetchChannelHistory(channel) {
  const messages = [];
  let lastId;

  while (messages.length < MAX_MESSAGES) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    messages.push(...batch.values());
    lastId = batch.last().id;
  }

  return messages.reverse().map(serializeMessage);
}

function serializeMessage(msg) {
  return {
    id: msg.id,
    authorId: msg.author?.id ?? null,
    author: msg.author?.tag || msg.author?.username || 'Unknown',
    bot: !!msg.author?.bot,
    content: msg.content || '',
    createdAt: msg.createdAt?.toISOString?.() ?? null,
    attachments: [...msg.attachments.values()].map(a => ({ name: a.name, url: a.url })),
    embeds: msg.embeds.length
      ? msg.embeds.map(e => e.title || e.description?.slice(0, 80) || '[embed]').slice(0, 5)
      : undefined,
  };
}

// ============================================================================
// Storage
// ============================================================================

async function saveTranscript({ tournament, matchKey, matchLabel, channelName, participants, messages }) {
  const row = {
    id: uuidv4(),
    tournament_id: tournament.id,
    guild_id: tournament.guildId,
    match_key: matchKey,
    match_label: matchLabel.slice(0, 255),
    channel_name: channelName.slice(0, 255),
    participants: JSON.stringify(participants || []),
    messages: JSON.stringify(messages),
    message_count: messages.length,
  };
  // Re-archiving the same match (e.g. a recreated room) replaces the transcript
  await db('match_transcripts')
    .insert(row)
    .onConflict(['tournament_id', 'match_key'])
    .merge(['match_label', 'channel_name', 'participants', 'messages', 'message_count', 'created_at']);
  return row;
}

async function listTranscripts(tournamentId) {
  const rows = await db('match_transcripts')
    .where('tournament_id', tournamentId)
    .select('match_key', 'match_label', 'channel_name', 'message_count', 'created_at')
    .orderBy('created_at', 'asc');
  return rows.map(r => ({
    key: r.match_key,
    label: r.match_label,
    channelName: r.channel_name,
    messageCount: r.message_count,
    createdAt: r.created_at,
  }));
}

async function getTranscript(tournamentId, matchKey) {
  const row = await db('match_transcripts')
    .where({ tournament_id: tournamentId, match_key: matchKey })
    .first();
  if (!row) return null;
  return {
    key: row.match_key,
    label: row.match_label,
    channelName: row.channel_name,
    participants: row.participants || [],
    messages: row.messages || [],
    messageCount: row.message_count,
    createdAt: row.created_at,
  };
}

// ============================================================================
// #match-logs mirror (admin-only channel, Support-bot style)
// ============================================================================

async function getOrCreateMatchLogsChannel(guild) {
  const settings = await getServerSettings(guild.id);
  if (!settings.matchLogsEnabled) return null;

  if (settings.matchLogsChannelId) {
    const existing = await guild.channels.fetch(settings.matchLogsChannelId).catch(() => null);
    if (existing) return existing;
  }

  // Reuse by name before creating (bot may have been re-added)
  const byName = guild.channels.cache.find(
    c => c.name === 'match-logs' && c.type === ChannelType.GuildText
  );
  if (byName) {
    await updateServerSettings(guild.id, { matchLogsChannelId: byName.id });
    return byName;
  }

  const { getTournamentAdminRoles } = require('../data/serverSettings');
  const adminRoles = await getTournamentAdminRoles(guild.id);
  const overwrites = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: guild.client.user.id,
      type: OverwriteType.Member,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
    },
    ...adminRoles.map(id => ({
      id, type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];

  const channel = await guild.channels.create({
    name: 'match-logs',
    type: ChannelType.GuildText,
    topic: 'Archived match-room transcripts (admins only) — full history also lives on the web dashboard.',
    permissionOverwrites: overwrites,
  });
  await updateServerSettings(guild.id, { matchLogsChannelId: channel.id });
  return channel;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Standalone HTML file for the #match-logs attachment. */
function renderTranscriptHTML({ tournament, matchLabel, channelName, messages }) {
  const rows = messages.map(m => `
    <div class="msg${m.bot ? ' bot' : ''}">
      <span class="author">${esc(m.author)}</span>
      <span class="time">${m.createdAt ? new Date(m.createdAt).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC' : ''}</span>
      <div class="content">${esc(m.content)}</div>
      ${(m.attachments || []).map(a => `<div class="att">📎 <a href="${esc(a.url)}">${esc(a.name)}</a></div>`).join('')}
      ${(m.embeds || []).map(e => `<div class="embed">▸ ${esc(e)}</div>`).join('')}
    </div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(matchLabel)} — transcript</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0B0E14; color: #E8EBF1; margin: 0; padding: 32px; }
  h1 { font-size: 18px; } .sub { color: #7C8698; font-size: 13px; margin-bottom: 24px; }
  .msg { padding: 8px 12px; border-left: 2px solid #232B3A; margin: 6px 0; }
  .msg.bot { border-left-color: #FF154D; opacity: .85; }
  .author { font-weight: 700; } .time { color: #5B667A; font-size: 11px; margin-left: 8px; }
  .content { margin-top: 2px; white-space: pre-wrap; word-break: break-word; }
  .att, .embed { color: #9BA3AF; font-size: 12.5px; margin-top: 3px; }
  a { color: #FF6B8E; }
</style></head><body>
<h1>${esc(matchLabel)}</h1>
<div class="sub">${esc(tournament.title)} · #${esc(channelName)} · ${messages.length} messages · archived ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
${rows || '<div class="msg"><div class="content"><i>No messages.</i></div></div>'}
</body></html>`;
}

// ============================================================================
// The archive operation
// ============================================================================

/**
 * Archive one room: history → DB → optional #match-logs mirror → delete
 * channel. Never throws for history/mirror problems — a full server must
 * still be freeable even if a fetch fails (we archive what we can).
 * @returns {{deleted: boolean, saved: boolean, messageCount: number}}
 */
async function archiveChannel({ guild, tournament, matchKey, matchLabel, channelId, participants = [] }) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return { deleted: false, saved: false, messageCount: 0, missing: true };

  let messages = [];
  let saved = false;
  try {
    messages = await fetchChannelHistory(channel);
    await saveTranscript({
      tournament, matchKey, matchLabel,
      channelName: channel.name, participants, messages,
    });
    saved = true;
  } catch (error) {
    console.error(`[transcript] history save failed for ${channel.name}:`, error.message);
  }

  // Mirror to #match-logs (best-effort)
  let mirrored = false;
  if (saved) {
    try {
      const logs = await getOrCreateMatchLogsChannel(guild);
      if (logs) {
        const html = renderTranscriptHTML({ tournament, matchLabel, channelName: channel.name, messages });
        await logs.send({
          content: `📜 **${matchLabel}** — ${tournament.title} · ${messages.length} messages`,
          files: [new AttachmentBuilder(Buffer.from(html), { name: `transcript-${channel.name}.html` })],
        });
        mirrored = true;
      } else {
        console.log('[transcript] match-logs mirror skipped (disabled for this server)');
      }
    } catch (error) {
      console.error('[transcript] match-logs mirror failed:', error.message);
    }
  }

  let deleted = false;
  try {
    await channel.delete();
    deleted = true;
  } catch (error) {
    console.error(`[transcript] delete failed for ${channel.name}:`, error.message);
  }

  return { deleted, saved, mirrored, messageCount: messages.length };
}

// ============================================================================
// Tournament-level archiving
// ============================================================================

/**
 * Every room a tournament currently owns, with the context a transcript
 * needs. Bracket matches + BR lobbies (groups & finals).
 */
function collectArchivables(tournament) {
  const bracket = tournament.bracket;
  if (!bracket) return [];
  const isSolo = tournament.settings.teamSize === 1;
  const name = (p) => (p ? (isSolo ? p.username : p.name) : 'TBD');
  const out = [];

  if (bracket.type === 'battle_royale') {
    for (const stage of [...(bracket.groups || []), ...(bracket.finals ? [bracket.finals] : [])]) {
      if (!stage.channelId) continue;
      out.push({
        matchKey: `br-lobby:${stage.id}`,
        matchLabel: `${stage.name} lobby`,
        channelId: stage.channelId,
        participants: stage.teams.map(t => ({ id: t.id, name: name(t) })),
        clear: () => { stage.channelId = null; stage.boardMessageId = null; },
        ref: stage,
      });
    }
    return out;
  }

  const { listAllMatches } = require('../utils/matchUtils');
  for (const { match } of listAllMatches(bracket)) {
    if (!match.channelId) continue;
    out.push({
      matchKey: String(match.id),
      matchLabel: `Match #${match.matchNumber ?? '?'} — ${name(match.participant1)} vs ${name(match.participant2)}`,
      channelId: match.channelId,
      participants: [match.participant1, match.participant2].filter(Boolean).map(p => ({ id: p.id, name: name(p) })),
      clear: () => { match.channelId = null; match.archiveAt = null; },
      ref: match,
    });
  }
  return out;
}

/**
 * Archive (transcript + delete) every room of a tournament. Clears channel
 * ids on the bracket as it goes; the CALLER persists the bracket afterwards.
 */
async function archiveTournamentChannels(guild, tournament) {
  let archived = 0, failed = 0, messages = 0;
  for (const item of collectArchivables(tournament)) {
    try {
      const res = await archiveChannel({
        guild, tournament,
        matchKey: item.matchKey,
        matchLabel: item.matchLabel,
        channelId: item.channelId,
        participants: item.participants,
      });
      if (res.deleted || res.missing) {
        item.clear();
        archived++;
        messages += res.messageCount;
      } else {
        failed++;
      }
    } catch (error) {
      console.error('[transcript] archive failed:', error.message);
      failed++;
    }
  }
  return { archived, failed, messages };
}

module.exports = {
  archiveChannel,
  archiveTournamentChannels,
  collectArchivables,
  listTranscripts,
  getTranscript,
  getOrCreateMatchLogsChannel,
  renderTranscriptHTML,
  fetchChannelHistory,
  serializeMessage,
};
