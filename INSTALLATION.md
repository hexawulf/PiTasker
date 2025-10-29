# 🔧 PiTasker Raspberry Pi 5 Deployment Guide

Complete installation guide for deploying PiTasker on Raspberry Pi 5 running Ubuntu 25.04.

## 📋 Requirements

### Hardware
- Raspberry Pi 5 (4GB+ RAM recommended)
- MicroSD card (32GB+ Class 10)
- Stable internet connection

### Software Prerequisites
- Ubuntu 25.04 LTS (or Raspberry Pi OS Bookworm)
- Node.js 20.18.1+
- PostgreSQL 15+
- PM2 process manager
- NGINX (for reverse proxy and SSL)
- Firebase project with Cloud Messaging enabled

## 🚀 Installation Steps

### 1. System Preparation

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install essential packages
sudo apt install -y curl wget git build-essential software-properties-common
```

### 2. Install Node.js 20+

```bash
# Install Node.js via NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v20.18.1 or higher
npm --version
```

### 3. Install PostgreSQL

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql -c "CREATE DATABASE pitasker;"
sudo -u postgres psql -c "CREATE USER pitasker WITH PASSWORD 'your_secure_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE pitasker TO pitasker;"
sudo -u postgres psql -c "ALTER USER pitasker CREATEDB;"
```

### 4. Install PM2 Process Manager

```bash
# Install PM2 globally
sudo npm install -g pm2

# Configure PM2 to start on boot
pm2 startup
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
```

### 5. Install NGINX

```bash
# Install NGINX
sudo apt install -y nginx

# Enable and start NGINX
sudo systemctl enable nginx
sudo systemctl start nginx

# Allow HTTP and HTTPS through firewall
sudo ufw allow 'Nginx Full'
```

### 6. Setup Crontab Access

```bash
# Verify crontab access (required for crontab integration)
crontab -l

# If you get "no crontab" - that's fine, it means you have access
# If you get permission error, fix with:
sudo chmod u+rw /var/spool/cron/crontabs/$(whoami) 2>/dev/null || true

# Create empty crontab if needed
echo "" | crontab -

# Verify access again
crontab -l && echo "Crontab access confirmed"
```

### 7. Clone and Setup PiTasker

```bash
# Clone the repository
cd /home/$USER
git clone https://github.com/hexawulf/pitasker.git
cd pitasker

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

### 7. Configure Environment Variables

Edit the `.env` file with your specific configuration:

```bash
nano .env
```

**Example `.env` file:**

```env
# Database Configuration
DATABASE_URL=postgresql://pitasker:your_secure_password@localhost:5432/pitasker
PGHOST=localhost
PGPORT=5432
PGUSER=pitasker
PGPASSWORD=your_secure_password
PGDATABASE=pitasker

# Firebase Configuration (from Firebase Console)
VITE_FIREBASE_API_KEY=AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=1:123456789:web:abcdefghijklmnop

# Application Configuration
NODE_ENV=production
PORT=5000
HOST=0.0.0.0

# Optional: Memory optimization
NODE_OPTIONS="--max-old-space-size=512"
```

### 8. Initialize Database

```bash
# Push database schema
npm run db:push

# Verify database connection
npm run db:studio  # Optional: Opens Drizzle Studio
```

### 9. Build Application

```bash
# Build frontend for production
npm run build

# Verify build completed successfully
ls -la dist/
```

### 10. Configure PM2

Create PM2 ecosystem file:

```bash
nano ecosystem.config.js
```

**ecosystem.config.js:**

```javascript
module.exports = {
  apps: [{
    name: 'pitasker',
    script: 'npm',
    args: 'start',
    cwd: '/home/pi/pitasker',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '90M',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    log_file: '/var/log/pitasker/combined.log',
    out_file: '/var/log/pitasker/out.log',
    error_file: '/var/log/pitasker/error.log',
    time: true
  }]
};
```

### 11. Start Application with PM2

```bash
# Create log directory
sudo mkdir -p /var/log/pitasker
sudo chown $USER:$USER /var/log/pitasker

# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Check application status
pm2 status
pm2 logs pitasker
```

### 12. Configure NGINX Reverse Proxy

Create NGINX configuration:

```bash
sudo nano /etc/nginx/sites-available/pitasker
```

**NGINX Configuration:**

```nginx
server {
    listen 80;
    server_name pitasker.piapps.dev;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pitasker.piapps.dev;

    # SSL Configuration (replace with your certificates)
    ssl_certificate /etc/ssl/certs/pitasker.piapps.dev.crt;
    ssl_certificate_key /etc/ssl/private/pitasker.piapps.dev.key;
    
    # SSL Security Headers
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied expired no-cache no-store private must-revalidate auth;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/javascript application/xml+rss application/json;

    # Proxy to Node.js application
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # Static file caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security - Hide sensitive endpoints from public access
    location /api/memory {
        allow 127.0.0.1;
        allow 192.168.0.0/16;
        allow 10.0.0.0/8;
        deny all;
        proxy_pass http://127.0.0.1:5000;
    }
}
```

Enable the site:

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/pitasker /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload NGINX
sudo systemctl reload nginx
```

### 13. SSL Certificate Setup

For production deployment with SSL:

```bash
# Install Certbot for Let's Encrypt
sudo apt install -y certbot python3-certbot-nginx

# Generate SSL certificate
sudo certbot --nginx -d pitasker.piapps.dev

# Auto-renewal setup
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

## 🧪 Testing Installation

### 1. Verify Application is Running

```bash
# Check PM2 status
pm2 status

# Check application logs
pm2 logs pitasker --lines 50

# Test local connection
curl -s http://localhost:5000/health | jq .
```

**Expected health response:**
```json
{
  "status": "ok",
  "uptime": "15234ms",
  "timestamp": "2025-10-29T12:30:00.000Z",
  "nodeVersion": "v20.18.1",
  "memoryUsage": {
    "rss": "87MB",
    "heapUsed": "45MB",
    "heapTotal": "65MB"
  }
}
```

### 2. Test Crontab Integration

```bash
# Run verification script
cd /home/zk/projects/pitasker
./verify-crontab-integration.sh

# Should show all checks passing
```

### 3. Test Task Creation and Crontab Sync

```bash
# Create a system-managed test task via UI or API
curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "Pi System Info",
    "cronSchedule": "*/5 * * * *",
    "command": "echo \"Pi Temperature: $(vcgencmd measure_temp)\" >> /tmp/pi-status.log",
    "isSystemManaged": true
  }'

# Verify task was created in database
curl -s http://localhost:5000/api/tasks | jq .

# Verify task was synced to crontab
crontab -l | grep "Pi System Info"

# Should see entry with PITASKER_ID comment:
# # PITASKER_ID:550e8400-e29b-41d4-a716-446655440000
# # PITASKER_COMMENT:Pi System Info
# */5 * * * * echo "Pi Temperature: $(vcgencmd measure_temp)" >> /tmp/pi-status.log

# Check crontab sync status
curl -s http://localhost:5000/api/crontab/status -b cookies.txt | jq .

# Check execution after 5 minutes
tail -f /tmp/pi-status.log
```

### 4. Test Browser Access

Open web browser and navigate to:
- `http://pitasker.piapps.dev` (should redirect to HTTPS)
- `https://pitasker.piapps.dev`

You should see the PiTasker dashboard with:
- Task statistics cards
- Task creation form with "Sync to System Crontab" toggle
- System monitor (showing memory <90MB)
- Task list with sync status badges
- "Import from Crontab" button
- Filter dropdown for viewing tasks by sync status

**Test UI Features**:
1. Create a new task with system crontab sync enabled
2. Verify green "Synced" badge appears
3. Click "Import from Crontab" - should show your test entry
4. Use filter dropdown to view "System Managed" tasks only
5. Click purple Server icon to toggle system management
6. Verify badge changes and crontab updates

## 📊 Memory Monitoring and Optimization

### Real-time Memory Monitoring

```bash
# Monitor application memory usage
watch -n 5 'pm2 show pitasker | grep memory'

# Check system-wide memory
free -h

# Monitor via API endpoint (local network only)
curl -s http://localhost:5000/api/memory | jq .
```

**Expected memory footprint:**
- **Target**: <90MB RSS
- **Typical**: 65-85MB RSS in production
- **Development**: 200-400MB (due to Vite hot reload)

### Memory Optimization Tips

```bash
# Force garbage collection (if enabled)
pm2 reload pitasker

# Monitor memory trends
pm2 monit

# Check for memory leaks
top -p $(pgrep -f "node.*pitasker")
```

## 🔄 Example Tasks for Raspberry Pi

Here are some practical tasks you can schedule with PiTasker:

### 1. System Monitoring
```bash
# CPU temperature logging
vcgencmd measure_temp >> /var/log/pi-temp.log

# Disk usage monitoring
df -h >> /var/log/disk-usage.log

# Memory usage tracking
free -h >> /var/log/memory-usage.log
```

### 2. Maintenance Tasks
```bash
# System cleanup
apt-get autoremove -y && apt-get autoclean

# Log rotation
find /var/log -name "*.log" -size +100M -delete

# Backup important files
tar -czf /backup/home-$(date +%Y%m%d).tar.gz /home/pi
```

### 3. IoT and Automation
```bash
# Take webcam photo
fswebcam -r 1280x720 /home/pi/photos/$(date +%Y%m%d_%H%M%S).jpg

# Check internet connectivity
ping -c 4 8.8.8.8 > /tmp/connectivity.log 2>&1

# GPIO control (if using RPi.GPIO)
python3 /home/pi/scripts/led_blink.py
```

## 🚨 Troubleshooting

### Common Issues

**1. Application won't start**
```bash
# Check logs
pm2 logs pitasker

# Verify database connection
psql -U pitasker -d pitasker -h localhost -c "SELECT 1;"

# Check environment variables
pm2 env 0
```

**2. High memory usage**
```bash
# Restart application
pm2 restart pitasker

# Check for memory leaks
pm2 monit

# Adjust memory limit
pm2 restart pitasker --max-memory-restart 90M
```

**3. Database connection errors**
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Verify database exists
sudo -u postgres psql -l | grep pitasker

# Reset database if needed
npm run db:push
```

**4. NGINX issues**
```bash
# Check NGINX status
sudo systemctl status nginx

# Test configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log
```

### Performance Optimization

**1. Enable swap (if needed)**
```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**2. Optimize PostgreSQL for Pi**
```bash
sudo nano /etc/postgresql/15/main/postgresql.conf
```

Add these optimizations:
```
shared_buffers = 32MB
effective_cache_size = 256MB
maintenance_work_mem = 16MB
checkpoint_completion_target = 0.9
wal_buffers = 1MB
```

## 📊 Success Indicators

After successful installation, you should see:

### 1. System Health
- PM2 shows "online" status
- Memory usage <90MB RSS
- NGINX serving traffic on port 443
- Database connections working

### 2. Application Features
- Dashboard loads in browser
- Task creation form works
- System monitor shows current memory
- Scheduled tasks execute automatically
- Browser notifications work (after Firebase setup)

### 3. API Endpoints Working
```bash
curl -s https://pitasker.piapps.dev/health
curl -s http://localhost:5000/api/memory  # Local only
curl -s https://pitasker.piapps.dev/api/tasks
```

## 🔒 Security Considerations

### Firewall Configuration
```bash
# Enable UFW
sudo ufw enable

# Allow SSH
sudo ufw allow ssh

# Allow HTTP/HTTPS
sudo ufw allow 'Nginx Full'

# Deny direct access to application port
sudo ufw deny 5000
```

### Regular Maintenance
```bash
# Update system packages monthly
sudo apt update && sudo apt upgrade

# Monitor application logs
pm2 logs pitasker --lines 100

# Backup database weekly
pg_dump -U pitasker pitasker > backup_$(date +%Y%m%d).sql
```

## 📞 Support

If you encounter issues:

1. Check the application logs: `pm2 logs pitasker`
2. Verify system health: `curl http://localhost:5000/health`
3. Monitor memory usage: `curl http://localhost:5000/api/memory`
4. Review NGINX logs: `sudo tail -f /var/log/nginx/error.log`

For additional help, create an issue on the GitHub repository with:
- Error messages from logs
- System specifications
- Steps to reproduce the issue

---

**🎉 Congratulations! PiTasker is now running on your Raspberry Pi 5!**

Access your dashboard at `https://pitasker.piapps.dev` and start automating your Pi tasks.
