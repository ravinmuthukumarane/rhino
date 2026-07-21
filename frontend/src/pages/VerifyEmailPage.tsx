import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { authApi } from '../services/api';

export default function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    if (token) authApi.verifyEmail(token).then(() => setState('success')).catch(() => setState('error'));
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="card max-w-md w-full text-center">
        {state === 'loading' && <p className="text-gray-600 dark:text-gray-400">Verifying…</p>}
        {state === 'success' && (<><div className="text-green-600 dark:text-green-400 text-5xl mb-4">✓</div><h2 className="text-xl font-bold text-white mb-2">Email Verified!</h2><Link to="/login" className="btn-primary inline-block">Sign In</Link></>)}
        {state === 'error' && (<><div className="text-red-600 dark:text-red-400 text-5xl mb-4">✗</div><h2 className="text-xl font-bold text-white mb-2">Verification Failed</h2><p className="text-gray-600 dark:text-gray-400 mb-4">Invalid or expired link.</p><Link to="/login" className="btn-secondary inline-block">Back to Login</Link></>)}
      </div>
    </div>
  );
}
