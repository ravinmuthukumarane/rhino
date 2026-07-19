import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import * as dsp from '../controllers/deviceSetpointsController';
import * as up from '../controllers/userPreferencesController';
import * as er from '../controllers/enhancedReportsController';

const router = Router();

// ── Device-Level Setpoints ────────────────────────────────
router.get('/device-setpoints', authenticate, dsp.getDeviceSetpoints);
router.get('/device-setpoints/effective', authenticate, dsp.getEffectiveSetpoints);
router.post('/device-setpoints', authenticate, requireAdmin, dsp.createDeviceSetpoint);
router.put('/device-setpoints/:id', authenticate, requireAdmin, dsp.updateDeviceSetpoint);
router.delete('/device-setpoints/:id', authenticate, requireAdmin, dsp.deleteDeviceSetpoint);

// ── User Preferences (Theme, Notifications, etc) ────────────
router.get('/user/preferences', authenticate, up.getUserPreferences);
router.put('/user/preferences', authenticate, up.updateUserPreferences);

// ── Enhanced Reports ───────────────────────────────────────
router.get('/reports/tariff', authenticate, er.getTariffReport);
router.get('/reports/generator-analysis', authenticate, er.getGeneratorAnalysis);
router.get('/reports/device-comparison', authenticate, er.getDeviceComparison);
router.get('/reports/consumption-trend', authenticate, er.getConsumptionTrend);

export default router;
