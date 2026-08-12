import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import pool from './config/database';
import redis from './config/redis';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import readingsRoutes from './routes/readings';
import alertsRoutes from './routes/alerts';
import reportsRoutes from './routes/reports';
import settingsRoutes from './routes/settings';
import enhancedRoutes from './routes/enhanced';
import { startSimulator } from './services/simulatorService';
import { startMQTT } from './services/mqttService';
import { startScheduler } from './services/schedulerService';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL ?? 'http://localhost:3000', credentials: true },
});

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Too many requests' } }));

app.use('/api/auth', authRoutes);
app.use('/api/readings', readingsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', enhancedRoutes);

app.get('/api/health', async (_req, res) => {
  let redisStatus = 'disconnected';
  try { await redis.ping(); redisStatus = 'connected'; } catch { /* reported as disconnected below */ }

  try { await pool.query('SELECT 1'); res.json({ status: 'ok', db: 'connected', redis: redisStatus, ts: new Date() }); }
  catch { res.status(503).json({ status: 'error', db: 'disconnected', redis: redisStatus }); }
});

app.use(errorHandler);

io.on('connection', (socket) => {
  console.log(`[Socket] +${socket.id}`);
  socket.on('disconnect', () => console.log(`[Socket] -${socket.id}`));
});

const PORT = parseInt(process.env.PORT ?? '5000');
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[Server] Port ${PORT}`);
  try { await pool.query('SELECT 1'); console.log('[DB] Connected'); }
  catch (err) { console.error('[DB] Failed:', (err as Error).message); process.exit(1); }

  // Non-fatal: cacheWrap() falls back to querying Postgres directly if Redis
  // is unreachable, so a cache outage degrades performance, not uptime.
  try { await redis.ping(); } catch (err) { console.error('[Redis] Ping failed:', (err as Error).message); }

  if (process.env.ENABLE_MQTT === 'true') {
    await startMQTT(io);
  } else if (process.env.ENABLE_SIMULATOR !== 'false') {
    await startSimulator(io);
  }
  startScheduler();
});
