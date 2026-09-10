import { Router } from 'express';
import { publicAppConfig } from '../config.js';

const router = Router();

/** Public app settings for the client (no auth required). */
router.get('/', (_req, res) => {
  res.json(publicAppConfig());
});

export default router;
