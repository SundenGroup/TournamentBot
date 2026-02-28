// Express API server for webhooks and REST API
// Runs alongside the Discord bot

const express = require('express');
const { handleWebhook, constructWebhookEvent, isStripeConfigured } = require('../services/stripeService');
const { authenticate } = require('./middleware/auth');
const { rateLimit } = require('./middleware/rateLimit');
const tournamentsRouter = require('./v1/tournaments');

const app = express();

// ============================================================================
// Stripe Webhook Endpoint (raw body required)
// ============================================================================

app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!isStripeConfigured()) {
      console.log('[API] Stripe webhook received but Stripe is not configured');
      return res.status(503).send('Stripe not configured');
    }

    const signature = req.headers['stripe-signature'];

    if (!signature) {
      console.log('[API] Stripe webhook missing signature');
      return res.status(400).send('Missing signature');
    }

    try {
      const event = constructWebhookEvent(req.body, signature);
      await handleWebhook(event);
      res.status(200).json({ received: true });
    } catch (err) {
      console.error('[API] Stripe webhook error:', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

// ============================================================================
// JSON body parser for REST API
// ============================================================================

app.use(express.json());

// ============================================================================
// Health Check (no auth required)
// ============================================================================

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stripeConfigured: isStripeConfigured(),
    version: '1.0.0',
  });
});

// ============================================================================
// REST API v1 (requires auth)
// ============================================================================

app.use('/v1/tournaments', authenticate, rateLimit, tournamentsRouter);

// ============================================================================
// API Documentation
// ============================================================================

app.get('/v1', (req, res) => {
  res.json({
    name: 'Tournament Bot API',
    version: 'v1',
    documentation: 'https://docs.example.com/api',
    endpoints: {
      tournaments: {
        list: 'GET /v1/tournaments',
        get: 'GET /v1/tournaments/:id',
        bracket: 'GET /v1/tournaments/:id/bracket',
        matches: 'GET /v1/tournaments/:id/matches',
        participants: 'GET /v1/tournaments/:id/participants',
        standings: 'GET /v1/tournaments/:id/standings',
      },
    },
    authentication: 'Bearer token in Authorization header',
    rateLimit: '120 requests per minute',
  });
});

// ============================================================================
// 404 Handler
// ============================================================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `No endpoint at ${req.method} ${req.path}`,
  });
});

// ============================================================================
// Error Handler
// ============================================================================

app.use((err, req, res, next) => {
  console.error('[API] Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// ============================================================================
// Server Start
// ============================================================================

function startApiServer(port = 3000) {
  const apiPort = process.env.API_PORT || port;

  app.listen(apiPort, () => {
    console.log(`API server listening on port ${apiPort}`);
    console.log(`  - Stripe webhooks: POST /webhooks/stripe`);
    console.log(`  - REST API: /v1/tournaments/*`);
    console.log(`  - Health check: GET /health`);
  });

  return app;
}

module.exports = {
  app,
  startApiServer,
};
