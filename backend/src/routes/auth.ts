import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import * as auth from '../controllers/authController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: 'Validation failed', details: errors.array() }); return; }
  next();
};

router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty(),
  validate, auth.register);

router.get('/verify/:token', auth.verifyEmail);

router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validate, auth.login);

router.post('/forgot-password', body('email').isEmail().normalizeEmail(), validate, auth.forgotPassword);
router.post('/reset-password',
  body('token').notEmpty(), body('password').isLength({ min: 8 }), validate, auth.resetPassword);

router.get('/me', authenticate, auth.getProfile);
router.get('/users', authenticate, requireAdmin, auth.listUsers);
router.put('/users/:userId/role', authenticate, requireAdmin, auth.updateUserRole);

export default router;
