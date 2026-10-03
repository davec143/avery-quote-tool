import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionToken } from '@/middleware';

async function login(formData) {
  'use server';
  const pw = String(formData.get('password') || '');
  const next = String(formData.get('next') || '/');
  if (!process.env.APP_PASSWORD || pw !== process.env.APP_PASSWORD) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  (await cookies()).set('aq_session', await sessionToken(pw), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
  redirect(next.startsWith('/') ? next : '/');
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
        {sp?.error && <p className="error">That password didn&apos;t work.</p>}
        <button className="primary">Sign in</button>
      </form>
    </div>
  );
}
