import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../services/api';
import { fmt } from '../utils/formatters';
import { Users, Shield, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import type { User } from '../types';

const ROLE_CLS: Record<string, string> = {
  admin: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30',
  viewer: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-500/30',
};

export default function UsersPage() {
  const { isAdmin, user: me } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;

  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => authApi.listUsers().then((r) => r.data) });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => authApi.updateUserRole(userId, role),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Role updated'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Update failed'),
  });

  const [form, setForm] = useState({ name: '', email: '', role: 'viewer' });
  const createMutation = useMutation({
    mutationFn: () => authApi.createUser(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(`Invitation sent to ${form.email}`);
      setForm({ name: '', email: '', role: 'viewer' });
    },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Could not create user'),
  });
  const handleCreate = (e: FormEvent) => { e.preventDefault(); createMutation.mutate(); };

  const users: User[] = data?.users ?? [];

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-center gap-2 mb-1"><Users className="w-5 h-5 text-primary-600 dark:text-primary-400" /><h3 className="font-semibold text-gray-800 dark:text-gray-200">User Management</h3></div>
        <p className="text-sm text-gray-600 dark:text-gray-400">Accounts are created by admins only. New users get an email to set their own password.</p>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-3"><UserPlus className="w-4 h-4 text-primary-600 dark:text-primary-400" /><h3 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">Create User</h3></div>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Full Name</label>
            <input type="text" className="input" placeholder="John Doe" required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" placeholder="user@factory.com" required
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Sending…' : 'Send Invite'}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: users.length },
          { label: 'Verified', value: users.filter((u) => u.is_verified).length },
          { label: 'Admins', value: users.filter((u) => u.role === 'admin').length },
        ].map(({ label, value }) => (
          <div key={label} className="card"><p className="text-xs text-gray-500">{label}</p><p className="text-2xl font-bold text-gray-800 dark:text-gray-200 mt-1">{value}</p></div>
        ))}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-gray-800">{['Name','Email','Role','Verified','Registered','Change Role'].map((h) => <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                : users.map((u) => (
                <tr key={u.id} className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold flex-shrink-0">{u.name?.[0]?.toUpperCase()}</div>
                      <span className="text-gray-800 dark:text-gray-200 font-medium text-sm">{u.name}</span>
                      {u.id === me?.id && <span className="text-xs text-gray-500">(you)</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-sm">{u.email}</td>
                  <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${ROLE_CLS[u.role] ?? ''}`}>{u.role}</span></td>
                  <td className="px-4 py-3">{u.is_verified ? <span className="badge-success">Verified</span> : <span className="text-yellow-600 dark:text-yellow-400 text-xs">Pending</span>}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmt.datetime(u.created_at)}</td>
                  <td className="px-4 py-3">
                    {u.id !== me?.id && (
                      <select value={u.role} onChange={(e) => roleMutation.mutate({ userId: u.id, role: e.target.value })} className="input py-1 text-xs w-24">
                        <option value="viewer">Viewer</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700/30">
        <div className="flex items-start gap-2"><Shield className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">Role Permissions</p>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-0.5">
              <li><strong className="text-red-700 dark:text-red-300">Admin</strong> — Full access: setpoints, device settings, user management, all reports</li>
              <li><strong className="text-blue-700 dark:text-blue-300">Viewer</strong> — Read-only: dashboard, alerts (acknowledge), reports (view)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
