import express from 'express';
import cors from 'cors';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import passport from './auth/passport.js';
import authRoutes from './auth/routes.js';
import configRoutes from './routes/config.js';
import courseRoutes from './routes/courses.js';
import homeRoutes from './routes/home.js';
import rosterRoutes from './routes/roster.js';
import planRoutes from './routes/plans.js';
import collabRoutes from './routes/collab.js';

const app = express();

const allowedOrigins = new Set<string>([
  process.env.CLIENT_URL ?? 'http://localhost:5174',
]);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (no Origin header), e.g. health checks/tools.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(
  session({
    name: 'fp_sid',
    secret: process.env.SESSION_SECRET ?? 'development-only-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.use('/auth', authRoutes);
app.use('/api/config', configRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/roster', rosterRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/collab', collabRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected error';
  res.status(500).json({ message });
});

export default app;
