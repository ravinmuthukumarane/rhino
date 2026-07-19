import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { AuthRequest, AuthUser } from '../types';

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) { res.status(401).json({ error: 'Access token required' }); return; }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
    const result = await pool.query<AuthUser>(
      'SELECT id, email, name, role, is_verified FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (!result.rows[0]) { res.status(401).json({ error: 'User not found' }); return; }
    if (!result.rows[0].is_verified) { res.status(403).json({ error: 'Email not verified' }); return; }
    req.user = result.rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  next();
}
