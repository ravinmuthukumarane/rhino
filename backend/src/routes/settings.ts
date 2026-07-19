import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import * as sc from '../controllers/settingsController';

const router = Router();
router.use(authenticate);

// Plants
router.get('/plants', sc.getPlants);
router.post('/plants', requireAdmin, sc.createPlant);
router.put('/plants/:id', requireAdmin, sc.updatePlant);
router.delete('/plants/:id', requireAdmin, sc.deletePlant);

// Energy Meters
router.get('/energy-meters', sc.getEnergyMeters);
router.post('/energy-meters', requireAdmin, sc.createEnergyMeter);
router.put('/energy-meters/:id', requireAdmin, sc.updateEnergyMeter);

// Flow Meters
router.get('/flow-meters', sc.getFlowMeters);
router.post('/flow-meters', requireAdmin, sc.createFlowMeter);
router.put('/flow-meters/:id', requireAdmin, sc.updateFlowMeter);

// Generators
router.get('/generators', sc.getGenerators);
router.post('/generators', requireAdmin, sc.createGenerator);
router.put('/generators/:id', requireAdmin, sc.updateGenerator);

export default router;
