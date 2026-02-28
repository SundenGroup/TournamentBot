// Webhook Delivery Service
// Sends webhook events to Business tier subscribers

const { getSubscription } = require('../data/subscriptions');
const { getEffectiveTier } = require('./subscriptionService');
const { signWebhookPayload } = require('../utils/apiKeyGenerator');

// Webhook event types
const WEBHOOK_EVENTS = {
  TOURNAMENT_CREATED: 'tournament.created',
  TOURNAMENT_STARTED: 'tournament.started',
  TOURNAMENT_COMPLETED: 'tournament.completed',
  TOURNAMENT_CANCELLED: 'tournament.cancelled',
  PARTICIPANT_REGISTERED: 'participant.registered',
  PARTICIPANT_WITHDRAWN: 'participant.withdrawn',
  PARTICIPANT_CHECKED_IN: 'participant.checked_in',
  MATCH_STARTED: 'match.started',
  MATCH_COMPLETED: 'match.completed',
};

// Queue for webhook deliveries (simple in-memory queue)
const deliveryQueue = [];
let isProcessing = false;

/**
 * Send a webhook event
 */
async function sendWebhook(guildId, event, data) {
  // Check if guild has webhooks configured and is Business tier
  const sub = getSubscription(guildId);
  if (!sub?.webhookUrl || !sub?.webhookSecret) {
    return { sent: false, reason: 'Webhook not configured' };
  }

  const tier = getEffectiveTier(guildId);
  if (tier !== 'business') {
    return { sent: false, reason: 'Business tier required' };
  }

  const payload = {
    event,
    timestamp: new Date().toISOString(),
    guildId,
    data,
  };

  const signature = signWebhookPayload(payload, sub.webhookSecret);

  // Add to queue
  deliveryQueue.push({
    url: sub.webhookUrl,
    payload,
    signature,
    attempts: 0,
    maxAttempts: 3,
    guildId,
  });

  // Process queue
  processQueue();

  return { sent: true, queued: true };
}

/**
 * Process the webhook delivery queue
 */
async function processQueue() {
  if (isProcessing || deliveryQueue.length === 0) {
    return;
  }

  isProcessing = true;

  while (deliveryQueue.length > 0) {
    const item = deliveryQueue.shift();

    try {
      const response = await fetch(item.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': item.signature,
          'X-Webhook-Event': item.payload.event,
          'User-Agent': 'TournamentBot-Webhook/1.0',
        },
        body: JSON.stringify(item.payload),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (response.ok) {
        console.log(`[Webhook] Delivered ${item.payload.event} to ${item.guildId}`);
      } else {
        console.error(`[Webhook] Failed ${item.payload.event} to ${item.guildId}: ${response.status}`);
        retryIfNeeded(item);
      }
    } catch (error) {
      console.error(`[Webhook] Error delivering ${item.payload.event} to ${item.guildId}:`, error.message);
      retryIfNeeded(item);
    }

    // Small delay between deliveries
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  isProcessing = false;
}

/**
 * Retry failed webhook delivery
 */
function retryIfNeeded(item) {
  item.attempts++;
  if (item.attempts < item.maxAttempts) {
    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.pow(2, item.attempts - 1) * 1000;
    setTimeout(() => {
      deliveryQueue.push(item);
      processQueue();
    }, delay);
  } else {
    console.error(`[Webhook] Gave up on ${item.payload.event} to ${item.guildId} after ${item.maxAttempts} attempts`);
  }
}

/**
 * Test webhook configuration
 */
async function testWebhook(guildId) {
  const sub = getSubscription(guildId);
  if (!sub?.webhookUrl || !sub?.webhookSecret) {
    return { success: false, error: 'Webhook not configured' };
  }

  const payload = {
    event: 'webhook.test',
    timestamp: new Date().toISOString(),
    guildId,
    data: {
      message: 'This is a test webhook from Tournament Bot',
    },
  };

  const signature = signWebhookPayload(payload, sub.webhookSecret);

  try {
    const response = await fetch(sub.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': 'webhook.test',
        'User-Agent': 'TournamentBot-Webhook/1.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      return { success: true, status: response.status };
    } else {
      return { success: false, error: `HTTP ${response.status}`, status: response.status };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Event Trigger Helpers
// ============================================================================

function onTournamentCreated(tournament) {
  sendWebhook(tournament.guildId, WEBHOOK_EVENTS.TOURNAMENT_CREATED, {
    tournamentId: tournament.id,
    title: tournament.title,
    game: tournament.game?.displayName,
    format: tournament.settings.format,
    teamSize: tournament.settings.teamSize,
    maxParticipants: tournament.settings.maxParticipants,
    startTime: tournament.startTime,
  });
}

function onTournamentStarted(tournament) {
  const isSolo = tournament.settings.teamSize === 1;
  sendWebhook(tournament.guildId, WEBHOOK_EVENTS.TOURNAMENT_STARTED, {
    tournamentId: tournament.id,
    title: tournament.title,
    participantCount: isSolo ? tournament.participants?.length : tournament.teams?.length,
  });
}

function onTournamentCompleted(tournament, standings) {
  sendWebhook(tournament.guildId, WEBHOOK_EVENTS.TOURNAMENT_COMPLETED, {
    tournamentId: tournament.id,
    title: tournament.title,
    standings: standings?.slice(0, 3).map((s, i) => ({
      place: i + 1,
      name: s.name || s.displayName,
    })),
  });
}

function onTournamentCancelled(tournament) {
  sendWebhook(tournament.guildId, WEBHOOK_EVENTS.TOURNAMENT_CANCELLED, {
    tournamentId: tournament.id,
    title: tournament.title,
  });
}

function onParticipantRegistered(tournament, participant) {
  const isSolo = tournament.settings.teamSize === 1;
  sendWebhook(tournament.guildId, WEBHOOK_EVENTS.PARTICIPANT_REGISTERED, {
    tournamentId: tournament.id,
    participant: {
      id: participant.id || participant.odId,
      name: participant.name || participant.displayName,
      type: isSolo ? 'player' : 'team',
    },
  });
}

function onParticipantWithdrawn(tournament, participant) {
  const isSolo = tournament.settings.teamSize === 1;
  sendWebhook(tournament.guildId, WEBHOOK_EVENTS.PARTICIPANT_WITHDRAWN, {
    tournamentId: tournament.id,
    participant: {
      id: participant.id || participant.odId,
      name: participant.name || participant.displayName,
      type: isSolo ? 'player' : 'team',
    },
  });
}

function onParticipantCheckedIn(tournament, participant) {
  const isSolo = tournament.settings.teamSize === 1;
  sendWebhook(tournament.guildId, WEBHOOK_EVENTS.PARTICIPANT_CHECKED_IN, {
    tournamentId: tournament.id,
    participant: {
      id: participant.id || participant.odId,
      name: participant.name || participant.displayName,
      type: isSolo ? 'player' : 'team',
    },
  });
}

function onMatchStarted(tournament, match) {
  sendWebhook(tournament.guildId, WEBHOOK_EVENTS.MATCH_STARTED, {
    tournamentId: tournament.id,
    matchId: match.id,
    round: match.round,
    participant1: match.participant1 ? {
      id: match.participant1.id || match.participant1.odId,
      name: match.participant1.name || match.participant1.displayName,
    } : null,
    participant2: match.participant2 ? {
      id: match.participant2.id || match.participant2.odId,
      name: match.participant2.name || match.participant2.displayName,
    } : null,
  });
}

function onMatchCompleted(tournament, match) {
  sendWebhook(tournament.guildId, WEBHOOK_EVENTS.MATCH_COMPLETED, {
    tournamentId: tournament.id,
    matchId: match.id,
    round: match.round,
    winner: match.winner ? {
      id: match.winner.id || match.winner.odId,
      name: match.winner.name || match.winner.displayName,
    } : null,
    loser: match.loser ? {
      id: match.loser.id || match.loser.odId,
      name: match.loser.name || match.loser.displayName,
    } : null,
    score: match.score,
  });
}

module.exports = {
  WEBHOOK_EVENTS,
  sendWebhook,
  testWebhook,

  // Event triggers
  onTournamentCreated,
  onTournamentStarted,
  onTournamentCompleted,
  onTournamentCancelled,
  onParticipantRegistered,
  onParticipantWithdrawn,
  onParticipantCheckedIn,
  onMatchStarted,
  onMatchCompleted,
};
