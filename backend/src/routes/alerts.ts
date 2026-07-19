import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import * as ac from '../controllers/alertsController';

const router = Router();
router.use(authenticate);

router.get('/', ac.getAlerts);
router.get('/active', ac.getActiveAlerts);
router.get('/stats', ac.getAlertStats);
router.get('/setpoints', ac.getSetpoints);
router.put('/acknowledge-all', ac.acknowledgeAll);
router.put('/:alertId/acknowledge', ac.acknowledgeAlert);
router.put('/setpoints/:alertType', requireAdmin, ac.updateSetpoint);

export default router;
