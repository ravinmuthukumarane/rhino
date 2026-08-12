import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as rc from '../controllers/readingsController';

const router = Router();
router.use(authenticate);

router.get('/latest', rc.getLatestReading);
router.get('/latest-by-meter', rc.getLatestReadingsByMeter);
router.get('/energy/history', rc.getEnergyHistory);
router.get('/diesel/history', rc.getDieselHistory);
router.get('/generator/events', rc.getGeneratorEvents);
router.get('/summary/daily', rc.getDailySummary);
router.get('/summary/monthly', rc.getMonthlySummary);
router.get('/summary/yearly', rc.getYearlySummary);
router.get('/power-interruptions', rc.getPowerInterruptions);
router.get('/dashboard-stats', rc.getDashboardStats);

export default router;
