module.exports = {
  apps: [{
    name: 'pitasker',
    script: 'dist/index.js', // ✅ Start compiled backend
    cwd: '/home/zk/projects/pitasker', // ✅ Confirm this is correct
    interpreter: 'node',
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '90M',
    env: {
      NODE_ENV: 'production', // Keep NODE_ENV as production for PM2 default
      // PORT, SESSION_SECRET, and DATABASE_URL should be inherited from the shell environment
      // where PM2 is started, or defined in a .env file loaded by your application.
      // PM2 can also inject environment variables using command line options or its own features.
      // Example: PORT: process.env.PORT, (but it's better to let the app handle .env loading)
    },
    log_file: '/var/log/pitasker/combined.log',
    out_file: '/var/log/pitasker/out.log',
    error_file: '/var/log/pitasker/error.log',
    time: true
  }]
};
