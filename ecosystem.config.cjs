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
      NODE_ENV: 'production',
      PORT: 5007,
      DATABASE_URL: 'postgresql://pitasker:eht7hcw0gyt.vmn3FAU@localhost:5432/pitasker'
    },
    log_file: '/var/log/pitasker/combined.log',
    out_file: '/var/log/pitasker/out.log',
    error_file: '/var/log/pitasker/error.log',
    time: true
  }]
};
