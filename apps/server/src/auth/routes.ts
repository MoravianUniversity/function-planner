import { Router } from 'express';
import passport from './passport.js';
import { appConfig } from '../config.js';

const router = Router();

router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(501).json({ message: 'Google OAuth is not configured in this environment.' });
  }
  const options: { scope: string[]; hd?: string } = { scope: ['profile', 'email'] };
  // Optional Google-hosted-domain hint when exactly one domain is configured (not a hard server check).
  if (appConfig.allowedEmailDomains.length === 1) {
    options.hd = appConfig.allowedEmailDomains[0];
  }
  return passport.authenticate('google', options)(req, res, next);
});

router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/auth/failure' }), (_req, res) => {
  res.redirect(process.env.CLIENT_URL ?? 'http://localhost:5174');
});

router.get('/failure', (_req, res) => {
  res.status(401).json({ message: 'Login failed' });
});

router.post('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie('fp_sid');
      res.status(200).json({ success: true });
    });
  });
});

router.get('/session', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ authenticated: false });
  }

  return res.json({
    authenticated: true,
    user: req.user
  });
});

export default router;
