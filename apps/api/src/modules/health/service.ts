import { prisma } from '../../db/index.js';
import { logger } from '../../logger/index.js';

export interface LivenessResult {
  status: 'ok';
  timestamp: string;
  uptime: number;
}

export interface ReadinessResult {
  status: 'ok' | 'error';
  timestamp: string;
  database: 'connected' | 'disconnected';
}

export const getLiveness = (): LivenessResult => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };
};

export const getReadiness = async (): Promise<ReadinessResult> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
    };
  } catch (err) {
    logger.error({ err }, 'Database health check failed');
    return {
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    };
  }
};
