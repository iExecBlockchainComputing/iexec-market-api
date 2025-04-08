import http from 'http';
import Koa from 'koa';
import kcors from 'kcors';
import { rateLimit as rateLimitConfig } from './config.js';
import * as socket from './loaders/socket.js';
import './controllers/eventsListener.js'; // load events controller
import { errorMiddleware } from './controllers/error.js';
import { router } from './controllers/router.js';
import { getRatelimitMiddleware } from './controllers/ratelimit.js';

const corsMiddleware = kcors();
const koa = new Koa();
const ratelimitMiddleware = getRatelimitMiddleware(rateLimitConfig);
const app = http.createServer(koa.callback());

socket.init(app);

koa
  .use(errorMiddleware)
  .use(corsMiddleware)
  .use(ratelimitMiddleware)
  .use(router.routes())
  .use(router.allowedMethods());

export default app;
