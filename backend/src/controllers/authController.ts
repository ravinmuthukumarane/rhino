import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../config/database';
import { emailService } from '../services/emailService';
import { AuthRequest } from '../types';

const makeToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' });

export async function createUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { email, name, role } = req.body as { email: string; name: string; role?: string };
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) { res.status(409).json({ error: 'Email already registered' }); return; }

    // Unusable placeholder — the user sets their real password via the emailed invite link.
    const placeholder = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const { rows: [user] } = await pool.query(
      'INSERT INTO users (email, password_hash, name, role, is_verified) VALUES ($1,$2,$3,$4,false) RETURNING id, email, name, role, is_verified, created_at',
      [email, placeholder, name, role === 'admin' ? 'admin' : 'viewer']
    );

    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, token, new Date(Date.now() + 86400000)]
    );
    await emailService.sendInvite(email, name, token);

    res.status(201).json({ user });
  } catch (err) { next(err); }
}

export async function verifyEmail(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { token } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT user_id FROM email_verifications WHERE token=$1 AND used=false AND expires_at>NOW()', [token]
    );
    if (!rows[0]) { res.status(400).json({ error: 'Invalid or expired token' }); return; }
    await pool.query('UPDATE users SET is_verified=true WHERE id=$1', [rows[0].user_id]);
    await pool.query('UPDATE email_verifications SET used=true WHERE token=$1', [token]);
    res.json({ message: 'Email verified. You can now log in.' });
  } catch (err) { next(err); }
}

export async function login(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { email, password } = req.body as { email: string; password: string };
  try {
    const { rows: [user] } = await pool.query(
      'SELECT id, email, name, role, password_hash, is_verified FROM users WHERE email=$1', [email]
    );
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid email or password' }); return;
    }
    if (!user.is_verified) { res.status(403).json({ error: 'Please verify your email first' }); return; }
    const token = makeToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) { next(err); }
}

export async function forgotPassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { email } = req.body as { email: string };
  try {
    const { rows: [user] } = await pool.query('SELECT id, name FROM users WHERE email=$1', [email]);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query('UPDATE password_resets SET used=true WHERE user_id=$1', [user.id]);
      await pool.query('INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1,$2,$3)',
        [user.id, token, new Date(Date.now() + 3600000)]);
      await emailService.sendPasswordReset(email, user.name, token);
    }
    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) { next(err); }
}

export async function resetPassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { token, password } = req.body as { token: string; password: string };
  try {
    const { rows: [row] } = await pool.query(
      'SELECT user_id FROM password_resets WHERE token=$1 AND used=false AND expires_at>NOW()', [token]
    );
    if (!row) { res.status(400).json({ error: 'Invalid or expired reset token' }); return; }
    await pool.query('UPDATE users SET password_hash=$1, is_verified=true WHERE id=$2', [await bcrypt.hash(password, 12), row.user_id]);
    await pool.query('UPDATE password_resets SET used=true WHERE token=$1', [token]);
    res.json({ message: 'Password reset successful' });
  } catch (err) { next(err); }
}

export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  res.json({ user: req.user });
}

export async function listUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, name, role, is_verified, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users: rows });
  } catch (err) { next(err); }
}

export async function updateUserRole(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { userId } = req.params;
  const { role } = req.body as { role: string };
  if (!['admin', 'viewer'].includes(role)) { res.status(400).json({ error: 'Role must be admin or viewer' }); return; }
  if (userId === req.user?.id) { res.status(400).json({ error: 'Cannot change your own role' }); return; }
  try {
    await pool.query('UPDATE users SET role=$1 WHERE id=$2', [role, userId]);
    res.json({ message: 'Role updated' });
  } catch (err) { next(err); }
}
