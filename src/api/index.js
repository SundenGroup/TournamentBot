// Express API server for webhooks and REST API
// Runs alongside the Discord bot

const path = require('path');
const express = require('express');
const { handleWebhook, constructWebhookEvent, isStripeConfigured } = require('../services/stripeService');
const { authenticate } = require('./middleware/auth');
const { rateLimit, ipRateLimit } = require('./middleware/rateLimit');
const tournamentsRouter = require('./v1/tournaments');
const publicBracketRouter = require('./publicBracket');
const botClient = require('./botClient');
const { router: adminAuthRouter } = require('./adminAuth');
const adminDashboardRouter = require('./adminDashboard');

const app = express();

// nginx is a single proxy hop in front of this app — trust it so req.ip is the
// real client (needed by the IP rate limiter), not 127.0.0.1.
app.set('trust proxy', 1);

// ============================================================================
// Security headers (nginx terminates TLS but sets none of these)
// ============================================================================

app.use((req, res, next) => {
  res.set({
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

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
// Public live bracket pages (no auth — gated per-tournament by publicBracket)
// ============================================================================

// IP rate-limit ONLY the anonymous, floodable surfaces: the public bracket
// pages and the OAuth entry points. Scoped by path so it runs once per request
// and never touches the authenticated dashboard, which is session-gated, fans
// out many legitimate reads (one /manage per tournament) + autorefresh, and
// has its own per-guild limiter on mutations. (Previously mounted as blanket
// middleware, which throttled — and double-counted — the admin's own session.)
app.use('/b', ipRateLimit);
app.use('/api/public', ipRateLimit);
app.use('/admin/login', ipRateLimit);
app.use('/admin/callback', ipRateLimit);

app.use(publicBracketRouter);

// ============================================================================
// Web-admin dashboard (Discord OAuth login + session-gated admin views)
// ============================================================================

app.use(adminAuthRouter);
app.use(adminDashboardRouter);
app.use(require('./adminActions'));

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
    documentation: 'https://tournaments.clutch.game/admin-manual.html',
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
// Static Files & Admin Manual
// ============================================================================

app.get('/admin-manual', (req, res) => res.redirect('/admin-manual.html'));
// `extensions` lets /faq, /user-guide, /contact resolve to their .html files;
// index.html is served automatically at /
app.use(express.static(path.join(__dirname, '../../public'), { extensions: ['html'] }));

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

function startApiServer(port = 3000, client = null) {
  const apiPort = process.env.API_PORT || port;

  // Share the running discord.js client so web-admin handlers can reach Discord
  // (guild/member lookups for authorization).
  if (client) botClient.setClient(client);

  app.listen(apiPort, () => {
    console.log(`API server listening on port ${apiPort}`);
    console.log(`  - Stripe webhooks: POST /webhooks/stripe`);
    console.log(`  - REST API: /v1/tournaments/*`);
    console.log(`  - Health check: GET /health`);
    console.log(`  - Admin manual: GET /admin-manual`);
    console.log(`  - Web admin: GET /admin ${require('../config').webAdmin.enabled ? '(enabled)' : '(disabled — set DISCORD_CLIENT_SECRET)'}`);
  });

  return app;
}

module.exports = {
  app,
  startApiServer,
};
