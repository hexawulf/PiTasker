import express from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { registerRoutes } from './routes';
import { pool } from './db';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust reverse proxy (e.g., Nginx, Cloudflare)
app.set('trust proxy', 1);

// CORS setup for frontend origin
app.use(
  cors({
    origin: 'https://pitasker.piapps.dev',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware (PostgreSQL store)
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ pool }),
    name: 'pitasker.sid',
    secret: process.env.SESSION_SECRET || 'replace_this_with_a_strong_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

const startServer = async () => {
  // Register backend routes
  await registerRoutes(app);

// Serve static frontend (works with Vite or CRA build)
  const rootDir = path.resolve(__dirname, '..');
  const candidateDirs = [
    path.join(__dirname, 'public'), // dist/public when bundled
    path.join(rootDir, 'client', 'dist'),
    path.join(rootDir, 'client', 'build'),
  ];
  const staticDir = candidateDirs.find((dir) =>
    fs.existsSync(path.join(dir, 'index.html')),
  );
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  } else {
    console.warn('[server] No frontend build directory found.');
  }

  const PORT = process.env.PORT || 5007;
  app.listen(PORT, () => {
    console.log(`[express] PiTasker backend running on port ${PORT}`);
  });
};

startServer().catch((err) => {
  console.error('[server] Failed to start:', err);
});
