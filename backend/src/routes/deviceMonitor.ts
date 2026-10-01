import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import * as dm from '../controllers/deviceMonitorController';

const router = Router();
router.use(authenticate);

router.get('/status', dm.getStatus);
router.get('/recipients', requireAdmin, dm.getRecipients);
router.post('/recipients', requireAdmin, dm.addRecipient);
router.put('/recipients/:id', requireAdmin, dm.updateRecipient);
router.delete('/recipients/:id', requireAdmin, dm.deleteRecipient);

export default router;
