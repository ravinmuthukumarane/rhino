import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setLoading(true);
    try { await authApi.forgotPassword(email); setSent(true); }
    catch { toast.error('Something went wrong'); }
    finally { setLoading(false); }
  };

  if (sent) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="card max-w-md w-full text-center">
        <div className="text-primary-600 dark:text-primary-400 text-5xl mb-4">✉</div>
        <h2 className="text-xl font-bold text-white mb-2">Check Your Email</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">If an account exists for {email}, a reset link has been sent.</p>
        <Link to="/login" className="btn-primary inline-block">Back to Login</Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <form onSubmit={handleSubmit} className="card max-w-md w-full space-y-4">
        <h2 className="text-xl font-bold text-white">Reset Password</h2>
        <div><label className="label">Email</label><input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'Sending…' : 'Send Reset Link'}</button>
        <Link to="/login" className="block text-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Back to Login</Link>
      </form>
    </div>
  );
}
