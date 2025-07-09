import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Debug: output environment variables during build to verify Vite injected them
// correctly. This log is helpful when troubleshooting missing VITE_FIREBASE_*
// variables in the frontend. It will be removed in production builds.
console.log("Vite env:", import.meta.env);

createRoot(document.getElementById("root")!).render(<App />);
