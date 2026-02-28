// API Key Generator
// Generates secure API keys for Business tier users

const crypto = require('crypto');

/**
 * Generate a new API key
 * Format: tb_live_<32 random hex chars>
 */
function generateApiKey() {
  const randomBytes = crypto.randomBytes(16).toString('hex');
  return `tb_live_${randomBytes}`;
}

/**
 * Generate a webhook secret
 * Format: whsec_<32 random hex chars>
 */
function generateWebhookSecret() {
  const randomBytes = crypto.randomBytes(16).toString('hex');
  return `whsec_${randomBytes}`;
}

/**
 * Hash an API key for storage (we store hashes, not raw keys)
 */
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Sign a webhook payload
 */
function signWebhookPayload(payload, secret) {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return `sha256=${signature}`;
}

/**
 * Verify a webhook signature
 */
function verifyWebhookSignature(payload, signature, secret) {
  const expected = signWebhookPayload(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

module.exports = {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  signWebhookPayload,
  verifyWebhookSignature,
};
