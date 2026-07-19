import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    try {
      await authApi.register({ name: form.name, email: form.email, password: form.password });
      setDone(true);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Registration failed');
    } finally { setLoading(false); }
  };

  if (done) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="card max-w-md w-full text-center">
        <div className="text-green-400 text-5xl mb-4">✓</div>
        <h2 className="text-xl font-bold text-white mb-2">Check Your Email</h2>
        <p className="text-gray-400 mb-4">Verification link sent to <strong className="text-white">{form.email}</strong>.</p>
        <Link to="/login" className="btn-primary inline-block">Back to Login</Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-800 rounded-2xl mb-4">
            <Zap className="w-8 h-8 text-primary-300" />
          </div>
          <h1 className="text-2xl font-bold text-white">Create Account</h1>
        </div>
        <form onSubmit={handleSubmit} className="card space-y-4">
          {[
            { label: 'Full Name', key: 'name', type: 'text', placeholder: 'John Doe' },
            { label: 'Email', key: 'email', type: 'email', placeholder: 'you@example.com' },
            { label: 'Password', key: 'password', type: 'password', placeholder: 'Min. 8 characters' },
            { label: 'Confirm Password', key: 'confirm', type: 'password', placeholder: 'Repeat password' },
          ].map(({ label, key, type, placeholder }) => (
            <div key={key}>
              <label className="label">{label}</label>
              <input type={type} className="input" placeholder={placeholder}
                value={form[key as keyof typeof form]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                required minLength={key === 'password' ? 8 : undefined} />
            </div>
          ))}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Creating…' : 'Create Account'}
          </button>
          <p className="text-center text-sm text-gray-400">
            Already have an account? <Link to="/login" className="text-primary-400 hover:text-primary-300">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
