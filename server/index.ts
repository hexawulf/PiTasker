import express from 'express';
import cors from 'cors';
import session from 'express-session';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerRoutes } from './routes'; // <- Correct import!

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust reverse proxy (e.g., Nginx, Cloudflare) to support secure cookies
app.set('trust proxy', 1);

// CORS configuration to allow frontend to send cookies
app.use(
  cors({
    origin: 'https://pitasker.piapps.dev', // <-- Replace with your frontend origin
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body parsers for JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(
  session({
    name: 'pitasker.sid',
    secret: process.env.SESSION_SECRET || 'replace_this_with_a_strong_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,       // Required for HTTPS
      sameSite: 'none',   // Required for cross-site cookies
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);

const startServer = async () => {
  // Register backend routes with access to app
  await registerRoutes(app);

  // Serve frontend (Vite static assets)
  const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientBuildPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });

  const PORT = process.env.PORT || 5007;
  app.listen(PORT, () => {
    console.log(`[express] PiTasker backend running on port ${PORT}`);
  });
};

// Start the server (wrap in top-level await if needed in ESM)
startServer().catch((err) => {
  console.error('[server] Failed to start:', err);
});
