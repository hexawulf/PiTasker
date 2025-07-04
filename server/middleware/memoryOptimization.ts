import type { Express } from "express";

// Memory optimization middleware for Raspberry Pi deployment
export function setupMemoryOptimization(app: Express) {
  // Enable compression for all routes
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes cache
    next();
  });

  // Memory monitoring
  const startTime = Date.now();
  let peakMemory = 0;

  const logMemoryUsage = () => {
    const usage = process.memoryUsage();
    const rss = Math.round(usage.rss / 1024 / 1024);
    const heapUsed = Math.round(usage.heapUsed / 1024 / 1024);
    
    if (rss > peakMemory) {
      peakMemory = rss;
    }

    // Log warning if memory usage exceeds target
    if (rss > 90) {
      console.warn(`[MEMORY WARNING] RSS: ${rss}MB (target: <90MB), Heap: ${heapUsed}MB`);
    }

    // Force garbage collection if memory is high (Node.js with --expose-gc)
    if (rss > 85 && global.gc) {
      console.log(`[GC] Forcing garbage collection at ${rss}MB`);
      global.gc();
    }
  };

  // Monitor memory every 30 seconds
  setInterval(logMemoryUsage, 30000);

  // Memory endpoint for monitoring
  app.get("/api/memory", (req, res) => {
    const usage = process.memoryUsage();
    const uptime = Date.now() - startTime;
    
    res.json({
      current: {
        rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
        external: `${Math.round(usage.external / 1024 / 1024)}MB`
      },
      peak: `${peakMemory}MB`,
      uptime: `${Math.round(uptime / 1000)}s`,
      target: "<90MB",
      nodeVersion: process.version
    });
  });

  console.log("[MEMORY] Memory optimization middleware initialized");
}