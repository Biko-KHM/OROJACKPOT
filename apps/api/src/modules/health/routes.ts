import { Router, Request, Response } from 'express';
import { getLiveness, getReadiness } from './service.js';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'hiree-api',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get('/live', (_req: Request, res: Response) => {
  const result = getLiveness();
  res.status(200).json(result);
});

healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const result = await getReadiness();
  if (result.status === 'ok') {
    res.status(200).json(result);
  } else {
    res.status(503).json(result);
  }
});
