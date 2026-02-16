// Authentication middleware for protected routes

import type { Context, Next } from 'hono';
import type { Env } from './types';
import { verifyJWT } from './jwt';

type Variables = {
  user_id: string;
};

// JWT Authentication middleware
export async function authMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix
  const payload = await verifyJWT(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // Store user_id in context for downstream handlers
  c.set('user_id', payload.sub);

  await next();
}
