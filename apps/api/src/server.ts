import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './logger/index.js';
import { startWorker } from './worker/index.js';
import { bootstrapSuperadmin } from './modules/auth/service.js';

// Polyfill BigInt.prototype.toJSON to prevent uncaught serialization errors across JSON.stringify, pino, & res.json
if (!(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

// Enterprise Crash Prevention: Keep server resilient against unhandled edge cases
process.on('uncaughtException', (err: Error) => {
  logger.error({ err }, '[Fatal] Uncaught Exception caught by server boundary — server kept alive');
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ reason }, '[Fatal] Unhandled Promise Rejection caught by server boundary — server kept alive');
});

const stopWorker = startWorker();

// Automatically provision or synchronize Superadmin credentials on boot
void bootstrapSuperadmin().catch((err) => {
  logger.error({ err }, '[Startup] Error bootstrapping superadmin credentials');
});

const server = app.listen(config.PORT, () => {
  logger.info(`Server started on port ${config.PORT} [${config.NODE_ENV}]`);
});

// Render Free Tier 24/7 Keep-Alive: Ping public URL every 9 minutes to prevent idle sleep
const publicHost = process.env.RENDER_EXTERNAL_HOSTNAME || process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL;
const rawPublicUrl = publicHost
  ? (publicHost.startsWith('http') ? publicHost : `https://${publicHost}`)
  : (config.NODE_ENV === 'production' ? 'https://mini-tg-app.onrender.com' : null);

let pingInterval: NodeJS.Timeout | null = null;

if (rawPublicUrl && config.NODE_ENV === 'production') {
  const INTERVAL_MS = 9 * 60 * 1000; // 9 minutes (Render idle sleep triggers at 14m)
  const target = rawPublicUrl.replace(/\/+$/, '') + '/health';
  logger.info(`[Keep-Alive] Initializing 24/7 keep-alive heartbeat targeting ${target} (every 9m)`);

  // Initial ping 10 seconds after boot to warm connection
  setTimeout(async () => {
    try {
      const res = await fetch(target);
      logger.info(`[Keep-Alive] Initial warm-up ping complete. Status: ${res.status}`);
    } catch {
      // ignore startup race
    }
  }, 10000);

  pingInterval = setInterval(async () => {
    try {
      const res = await fetch(target);
      logger.info(`[Keep-Alive] 24/7 Heartbeat sent. Status: ${res.status}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: msg }, '[Keep-Alive] 24/7 Heartbeat ping failed');
    }
  }, INTERVAL_MS);
}

const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  if (pingInterval) clearInterval(pingInterval);
  stopWorker();
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
