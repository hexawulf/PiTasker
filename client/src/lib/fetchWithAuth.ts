// src/lib/fetchWithAuth.ts
export const fetchWithAuth = (url: string, options: RequestInit = {}) =>
  fetch(url, {
    ...options,
    credentials: 'include', // 👈 Ensures session cookies are sent
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
