import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "demo-api-key",
  authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-project"}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-project",
  storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-project"}.firebasestorage.app`,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "demo-app-id",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let messaging: any = null;

// Initialize messaging only in production
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  try {
    messaging = getMessaging(app);
  } catch (error) {
    console.warn("Firebase messaging not available:", error);
  }
}

export { auth, messaging };

export const requestNotificationPermission = async (): Promise<string | null> => {
  if (!messaging) {
    console.warn("Firebase messaging not available");
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || "demo-vapid-key"
      });
      console.log('Notification token:', token);
      return token;
    } else {
      console.log('Notification permission denied');
      return null;
    }
  } catch (error) {
    console.error('Error getting notification permission:', error);
    return null;
  }
};

export const setupNotificationListener = (callback: (payload: any) => void) => {
  if (!messaging) {
    console.warn("Firebase messaging not available");
    return;
  }

  try {
    onMessage(messaging, (payload) => {
      console.log('Message received:', payload);
      callback(payload);
    });
  } catch (error) {
    console.error('Error setting up notification listener:', error);
  }
};

export const showBrowserNotification = (title: string, body: string, icon?: string) => {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: icon || '/favicon.ico',
      tag: 'pitasker-notification',
      badge: '/favicon.ico',
      requireInteraction: false,
      silent: false
    });
  } else {
    console.warn('Browser notifications not available or not permitted');
  }
};

// Enhanced notification function for task completion
export const showTaskNotification = (taskName: string, status: 'success' | 'failed' | 'running', timestamp?: string) => {
  const statusEmoji = status === 'success' ? '✅' : status === 'failed' ? '❌' : '⏱️';
  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  
  const title = `PiTasker - Task ${status === 'success' ? 'Completed' : status === 'failed' ? 'Failed' : 'Started'}`;
  const body = `${statusEmoji} "${taskName}" at ${timeStr}`;
  
  showBrowserNotification(title, body);
};

// Overloaded function to handle string status from API
export const showTaskNotificationFromAPI = (taskName: string, status: string, timestamp?: string) => {
  if (status === 'success' || status === 'failed' || status === 'running') {
    showTaskNotification(taskName, status, timestamp);
  }
};
