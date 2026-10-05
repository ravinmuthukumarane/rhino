import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { generateReport, getReportHistory, deleteReportHistory, getReportSchedules, createReportSchedule,
  updateReportSchedule, deleteReportSchedule, getScheduleRecipients, addScheduleRecipient,
  deleteScheduleRecipient, sendScheduleNow } from '../controllers/reportsController';

const router = Router();
router.use(authenticate);

router.post('/generate', generateReport);
router.get('/history', getReportHistory);
router.delete('/history/:id', requireAdmin, deleteReportHistory);
router.get('/schedules', requireAdmin, getReportSchedules);
router.post('/schedules', requireAdmin, createReportSchedule);
router.put('/schedules/:id', requireAdmin, updateReportSchedule);
router.delete('/schedules/:id', requireAdmin, deleteReportSchedule);
router.post('/schedules/:id/send-now', requireAdmin, sendScheduleNow);
router.get('/schedules/:id/recipients', requireAdmin, getScheduleRecipients);
router.post('/schedules/:id/recipients', requireAdmin, addScheduleRecipient);
router.delete('/schedules/:id/recipients/:recipientId', requireAdmin, deleteScheduleRecipient);

export default router;
