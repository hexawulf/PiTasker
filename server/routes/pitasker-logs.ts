import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const router = express.Router();
const LOG_DIR = '/home/zk/logs/pitasker';

const isValidLog = (name: string) => /^[\w.-]+\.log$/.test(name);

router.get('/', (_, res) => {
  fs.readdir(LOG_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot list logs' });
    res.json(files.filter(isValidLog));
  });
});

router.get('/:filename', (req, res) => {
  const file = req.params.filename;
  if (!isValidLog(file)) return res.status(400).json({ error: 'Invalid log file' });

  const filePath = path.join(LOG_DIR, file);
  const tail = spawn('tail', ['-n', '100', filePath]);

  let output = '';
  tail.stdout.on('data', chunk => output += chunk);
  tail.on('close', () => res.json({ content: output }));
});

export default router;
