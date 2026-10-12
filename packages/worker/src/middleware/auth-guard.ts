import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { AppContext, SessionData } from '../types/env';
import { AppError } from './error-handler';

const MAX_SESSION_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days absolute max

export const authGuard = createMiddleware<AppContext>(async (c, next) => {
  const cookie = getCookie(c, 'omnidrive_sid');
  if (!cookie) {
    throw new AppError(401, 'Not authenticated');
  }

  const sessionJson = await c.env.KV.get(`session:${cookie}`);
  if (!sessionJson) {
    throw new AppError(401, 'Session expired');
  }

  const session: SessionData = JSON.parse(sessionJson);

  // Enforce absolute session lifetime
  if (session.createdAt && Date.now() - session.createdAt > MAX_SESSION_AGE) {
    await c.env.KV.delete(`session:${cookie}`);
    throw new AppError(401, 'Session expired');
  }

  c.set('userId', session.userId);
  c.set('session', session);

  // Sessions use a fixed 7-day KV TTL from login. Renewing on every request
  // exhausts the Workers Free KV daily write quota (1,000/day) and allows
  // high-traffic routes to make authentication unavailable for everyone.
  // Re-authentication after expiry is intentional.

  await next();
});
