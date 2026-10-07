import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionToken, safeNext } from '@/lib/session';
import { passwordMatches, loginBlocked, recordLoginFailure, clearLoginFailures } from '@/lib/login-guard';

async function login(formData) {
  'use server';
  const pw = String(formData.get('password') || '');
  const next = safeNext(formData.get('next'));
  const h = await headers();
  const who = (h.get('x-forwarded-for') || h.get('x-real-ip') || 'unknown').split(',')[0].trim();
  if (loginBlocked(who)) redirect(`/login?error=2&next=${encodeURIComponent(next)}`);
  if (!passwordMatches(pw, process.env.APP_PASSWORD)) {
    recordLoginFailure(who);
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  clearLoginFailures(who);
  (await cookies()).set('aq_session', await sessionToken(pw), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  redirect(next);
}

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  return (
    <div className="login">
      <form action={login} className="card narrow">
        <h1>Avery Quote Tool</h1>
        <p className="muted">Sign in with the team password.</p>
        <input type="hidden" name="next" value={sp?.next || '/'} />
        <label>
          Password
          <input type="password" name="password" autoFocus required />
        </label>
        {sp?.error && <p className="error">{sp.error === '2' ? 'Too many attempts. Wait 15 minutes and try again.' : 'That password didn’t work.'}</p>}
        <button className="primary">Sign in</button>
      </form>
    </div>
  );
}
