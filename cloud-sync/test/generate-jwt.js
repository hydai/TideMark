#!/usr/bin/env node

// Generate JWT token for testing
// Usage: node generate-jwt.js [user_id] [email] [secret]

const crypto = require('crypto');

const userId = process.argv[2] || 'test-user-123';
const email = process.argv[3] || 'test@example.com';
const secret = process.argv[4] || 'test-secret-key-for-local-dev';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

const header = {
  alg: 'HS256',
  typ: 'JWT',
};

const now = Math.floor(Date.now() / 1000);
const payload = {
  sub: userId,
  email: email,
  iat: now,
  exp: now + 86400, // 24 hours
};

const headerEncoded = base64url(JSON.stringify(header));
const payloadEncoded = base64url(JSON.stringify(payload));
const message = `${headerEncoded}.${payloadEncoded}`;

const signature = crypto
  .createHmac('sha256', secret)
  .update(message)
  .digest('base64url');

const jwt = `${message}.${signature}`;

console.log('JWT Token Generated:');
console.log(jwt);
console.log('');
console.log('User ID:', userId);
console.log('Email:', email);
console.log('Expires:', new Date((now + 86400) * 1000).toISOString());
