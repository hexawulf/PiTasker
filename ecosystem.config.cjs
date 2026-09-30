// pm2 app for PiTasker (the only pm2 file). Settings live in .env, which the
// server loads itself (dotenv) from its working directory.
//   pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "pitasker",
      script: "dist/index.js",
      cwd: "/home/zk/projects/PiTasker",
      interpreter: "node",
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "384M",
      // A start that fails (e.g. pending migrations) stops after 10 tries instead of looping.
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 4000,
      kill_timeout: 8000,
      env: { NODE_ENV: "production" },
      log_file: "/var/log/pitasker/combined.log",
      out_file: "/var/log/pitasker/out.log",
      error_file: "/var/log/pitasker/error.log",
      time: true,
    },
  ],
};
