import { cookies } from 'next/headers';
import { validSession } from './session.js';

export async function requireAuth() {
  const password = process.env.APP_PASSWORD;
  if (!password && process.env.NODE_ENV !== 'production') return;
  if (!password || !(await validSession((await cookies()).get('aq_session')?.value, password))) throw new Error('Sign in to access this tool. Production requires APP_PASSWORD.');
}
