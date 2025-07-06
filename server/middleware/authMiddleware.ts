import { type Request, type Response, type NextFunction } from 'express';
import type session from 'express-session';

// Define a custom type for the session data
interface AuthenticatedSession extends session.Session {
    userId?: number;
    user?: { id: number; username: string };
}

export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
    const session = req.session as AuthenticatedSession;
    if (session && (session.user?.id || session.userId)) {
        return next();
    }
    // If client expects JSON (API routes), send 401 JSON
    if (req.originalUrl.startsWith('/api/') || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(401).json({ message: 'Unauthorized: You must be logged in to access this resource.' });
    }
    // Otherwise, redirect to login page
    return res.redirect('/login');
}
