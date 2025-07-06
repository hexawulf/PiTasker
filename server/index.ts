import express from 'express';
import cors from 'cors';
import session from 'express-session';
import dotenv from 'dotenv';
import path from 'path';
import routes from './routes'; // Adjust if your routes are nested differently

dotenv.config();

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

// Mount backend API routes
app.use('/api', routes);

// Serve frontend if you're doing SSR or have static assets
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 5007;
app.listen(PORT, () => {
  console.log(`[express] PiTasker backend running on port ${PORT}`);
});
