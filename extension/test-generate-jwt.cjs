/**
 * Generate a test JWT for local development
 * This simulates the /auth/google endpoint response for testing
 */

const crypto = require('crypto');

// This should match the JWT_SECRET in cloud-sync/.dev.vars
const JWT_SECRET = 'test-secret-key-for-local-dev-change-in-production';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function generateJWT(userId, email) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    email: email,
    iat: now,
    exp: now + (30 * 24 * 60 * 60) // 30 days
  };

  const headerEncoded = base64url(JSON.stringify(header));
  const payloadEncoded = base64url(JSON.stringify(payload));
  const signatureInput = `${headerEncoded}.${payloadEncoded}`;

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(signatureInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${signatureInput}.${signature}`;

  return jwt;
}

// Generate test JWT
const testUserId = 'test-user-123';
const testEmail = 'test@example.com';
const jwt = generateJWT(testUserId, testEmail);

console.log('Test JWT generated:');
console.log('User ID:', testUserId);
console.log('Email:', testEmail);
console.log('JWT:', jwt);
console.log('\nYou can use this JWT for testing by manually setting it in Chrome storage:');
console.log(`
chrome.storage.local.set({
  syncState: {
    jwt: "${jwt}",
    user: { id: "${testUserId}", email: "${testEmail}" },
    lastSyncedAt: "${new Date(0).toISOString()}",
    queue: [],
    status: "synced"
  }
}, () => console.log("Test JWT set"));
`);
