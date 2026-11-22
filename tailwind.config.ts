import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        pi: {
          dark: "var(--pi-dark)",
          darker: "var(--pi-darker)",
          card: "var(--pi-card)",
          "card-hover": "var(--pi-card-hover)",
          border: "var(--pi-border)",
          text: "var(--pi-text)",
          "text-muted": "var(--pi-text-muted)",
          input: "var(--pi-input)",
          accent: "var(--pi-accent)",
          "accent-text": "var(--pi-accent-text)",
          "accent-hover": "var(--pi-accent-hover)",
          "on-accent": "var(--pi-on-accent)",
          brand: "var(--pi-brand)",
          success: "var(--pi-success)",
          warning: "var(--pi-warning)",
          error: "var(--pi-error)",
          "success-soft": "var(--pi-success-soft)",
          "warning-soft": "var(--pi-warning-soft)",
          "error-soft": "var(--pi-error-soft)",
          "terminal-bg": "var(--pi-terminal-bg)",
          "terminal-text": "var(--pi-terminal-text)",
          "terminal-muted": "var(--pi-terminal-muted)",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
