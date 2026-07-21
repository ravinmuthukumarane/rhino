import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { generateReport, getReportHistory, getReportSchedules, updateReportSchedule } from '../controllers/reportsController';

const router = Router();
router.use(authenticate);

router.post('/generate', generateReport);
router.get('/history', getReportHistory);
router.get('/schedules', requireAdmin, getReportSchedules);
router.put('/schedules/:frequency', requireAdmin, updateReportSchedule);

export default router;
