import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { generateReport, getReportHistory } from '../controllers/reportsController';

const router = Router();
router.use(authenticate);

router.post('/generate', generateReport);
router.get('/history', getReportHistory);

export default router;
