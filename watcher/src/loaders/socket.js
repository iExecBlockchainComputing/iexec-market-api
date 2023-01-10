const http = require('http');
const socketIo = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const config = require('../config');
const { logger } = require('../utils/logger');
const { throwIfMissing, errorHandler } = require('../utils/error');

const log = logger.extend('socket');

const server = http.createServer();

let ws = null;

const getWs = () => {
  if (ws === null) throw new Error('socket not initialized');
  return ws;
};

const init = async () => {
  try {
    log('init socket');
    const redisConfig = config.redis;
    const pubClient = createClient(redisConfig);
    const subClient = pubClient.duplicate();
    pubClient.on('error', (err) => log('pubClient', 'Error', err));
    subClient.on('error', (err) => log('subClient', 'Error', err));
    pubClient.on('connect', () => log('pubClient connect'));
    subClient.on('connect', () => log('subClient connect'));
    pubClient.on('end', () => log('pubClient end'));
    subClient.on('end', () => log('subClient end'));
    await Promise.all[(pubClient.connect(), subClient.connect())];
    const redisAdapter = createAdapter(pubClient, subClient);
    ws = socketIo(server);
    ws.adapter(redisAdapter);
    log('socket initialized');
  } catch (error) {
    errorHandler(error, {
      type: 'init-socket',
    });
  }
};

const emit = async (
  channel = throwIfMissing(),
  object = throwIfMissing(),
  message = throwIfMissing(),
) => {
  try {
    await getWs().to(channel).emit(object, message);
    log(`emitted to ${channel}`, object, message);
  } catch (error) {
    errorHandler(error, {
      type: 'socket-emit',
      channel,
      object,
      message,
    });
  }
};

module.exports = { init, emit };
