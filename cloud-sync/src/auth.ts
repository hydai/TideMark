// Google OAuth token verification and user management

import type { Env, GoogleTokenInfo, User, JWTPayload } from './types';
import { generateJWT } from './jwt';

// Verify Google OAuth token
export async function verifyGoogleToken(token: string): Promise<GoogleTokenInfo | null> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
    );

    if (!response.ok) {
      return null;
    }

    const tokenInfo = (await response.json()) as GoogleTokenInfo;

    // Verify token is valid
    if (!tokenInfo.email_verified) {
      return null;
    }

    return tokenInfo;
  } catch (error) {
    console.error('Google token verification error:', error);
    return null;
  }
}

// Find or create user in database
export async function findOrCreateUser(
  db: D1Database,
  googleInfo: GoogleTokenInfo
): Promise<User> {
  // Try to find existing user
  const existing = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(googleInfo.sub)
    .first<User>();

  if (existing) {
    return existing;
  }

  // Create new user
  await db
    .prepare('INSERT INTO users (id, email) VALUES (?, ?)')
    .bind(googleInfo.sub, googleInfo.email)
    .run();

  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(googleInfo.sub)
    .first<User>();

  if (!user) {
    throw new Error('Failed to create user');
  }

  return user;
}

// Handle Google OAuth login
export async function handleGoogleLogin(env: Env, googleToken: string): Promise<string | null> {
  // Verify Google token
  const googleInfo = await verifyGoogleToken(googleToken);
  if (!googleInfo) {
    return null;
  }

  // Find or create user
  const user = await findOrCreateUser(env.DB, googleInfo);

  // Generate JWT token (valid for 30 days)
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    sub: user.id,
    email: user.email,
    iat: now,
    exp: now + 30 * 24 * 60 * 60, // 30 days
  };

  const jwt = await generateJWT(payload, env.JWT_SECRET);
  return jwt;
}
