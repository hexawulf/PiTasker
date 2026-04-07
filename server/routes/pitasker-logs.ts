import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { logRetentionService, LOG_DIR } from '../services/logRetentionService';

const router = express.Router();

const isValidLog = (name: string) => /^[\w.-]+\.log$/.test(name);

router.get('/', (_, res) => {
  fs.readdir(LOG_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot list logs' });
    
    const filteredFiles = files
      .filter(isValidLog)
      .filter(file => logRetentionService.isWithinRetention(file));
      
    res.json(filteredFiles);
  });
});

router.get('/:filename', (req, res) => {
  const { filename } = req.params;
  const isDownload = req.query.download === '1';

  if (!isValidLog(filename)) {
    return res.status(400).json({ error: 'Invalid log file' });
  }

  const logPath = path.join(LOG_DIR, filename);

  if (isDownload) {
    return res.download(logPath); // Serve the file as download
  }

  const tail = spawn('tail', ['-n', '100', logPath]);
  let output = '';
  tail.stdout.on('data', chunk => (output += chunk));
  tail.on('close', () => res.json({ content: output }));
});

export default router;
