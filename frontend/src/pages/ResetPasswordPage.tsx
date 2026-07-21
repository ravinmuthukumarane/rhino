import { useState, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    try {
      await authApi.resetPassword({ token, password: form.password });
      toast.success('Password reset!'); navigate('/login');
    } catch (err: any) { toast.error(err.response?.data?.error ?? 'Reset failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <form onSubmit={handleSubmit} className="card max-w-md w-full space-y-4">
        <h2 className="text-xl font-bold text-white">New Password</h2>
        <div><label className="label">Password</label><input type="password" className="input" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
        <div><label className="label">Confirm</label><input type="password" className="input" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required /></div>
        <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'Resetting…' : 'Reset Password'}</button>
      </form>
    </div>
  );
}
