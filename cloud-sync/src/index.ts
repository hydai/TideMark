// Tidemark Cloud Sync API
// Cloudflare Workers + D1 Database

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authMiddleware } from './middleware';
import {
  authGoogle,
  getSync,
  createRecord,
  deleteRecord,
  createFolder,
  deleteFolder,
} from './handlers';

type Variables = {
  user_id: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS middleware - allow requests from Extension and Desktop
app.use('/*', cors({
  origin: '*', // In production, restrict to specific origins
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Public routes
app.post('/auth/google', authGoogle);

// Protected routes (require JWT authentication)
app.use('/sync', authMiddleware);
app.use('/records', authMiddleware);
app.use('/records/*', authMiddleware);
app.use('/folders', authMiddleware);
app.use('/folders/*', authMiddleware);

// Sync endpoint
app.get('/sync', getSync);

// Records endpoints
app.post('/records', createRecord);
app.delete('/records/:id', deleteRecord);

// Folders endpoints
app.post('/folders', createFolder);
app.delete('/folders/:id', deleteFolder);

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
