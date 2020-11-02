const http = require('http');
const Koa = require('koa');
const corsMiddleware = require('kcors')();
const { maxRequest, period } = require('./config').rateLimit;
const socket = require('./loaders/socket');
require('./controllers/eventsListener'); // load events controller
const { errorMiddleware } = require('./controllers/error');
const { router } = require('./controllers/router');
const { getRatelimitMiddleware } = require('./controllers/ratelimit');

const koa = new Koa();
const ratelimitMiddleware = getRatelimitMiddleware({ maxRequest, period });
const app = http.createServer(koa.callback());

socket.init(app);

koa
  .use(errorMiddleware)
  .use(corsMiddleware)
  .use(ratelimitMiddleware)
  .use(router.routes())
  .use(router.allowedMethods());

module.exports = app;
