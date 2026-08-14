import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { generateReport, getReportHistory, getReportSchedules, updateReportSchedule,
  getScheduleRecipients, addScheduleRecipient, deleteScheduleRecipient } from '../controllers/reportsController';

const router = Router();
router.use(authenticate);

router.post('/generate', generateReport);
router.get('/history', getReportHistory);
router.get('/schedules', requireAdmin, getReportSchedules);
router.put('/schedules/:frequency', requireAdmin, updateReportSchedule);
router.get('/schedules/:frequency/recipients', requireAdmin, getScheduleRecipients);
router.post('/schedules/:frequency/recipients', requireAdmin, addScheduleRecipient);
router.delete('/schedules/:frequency/recipients/:id', requireAdmin, deleteScheduleRecipient);

export default router;
