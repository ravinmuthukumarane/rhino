import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  console.error(err.stack ?? err.message);
  if (err.code === '23505') { res.status(409).json({ error: 'Duplicate entry — resource already exists' }); return; }
  const status: number = err.status ?? 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message ?? 'Unknown error');
  res.status(status).json({ error: message });
}
