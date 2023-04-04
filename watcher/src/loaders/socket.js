const http = require('http');
const socketIo = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const config = require('../config');
const { getLogger } = require('../utils/logger');
const { throwIfMissing, errorHandler } = require('../utils/error');

const logger = getLogger('socket');

const server = http.createServer();

let ws = null;

const getWs = () => {
  if (ws === null) throw new Error('socket not initialized');
  return ws;
};

const init = async () => {
  try {
    logger.log('init socket');
    const redisConfig = config.redis;
    const pubClient = createClient(redisConfig);
    const subClient = pubClient.duplicate();
    pubClient.on('error', (err) => logger.warn('pubClient', 'Error', err));
    subClient.on('error', (err) => logger.warn('subClient', 'Error', err));
    pubClient.on('connect', () => logger.log('pubClient connect'));
    subClient.on('connect', () => logger.log('subClient connect'));
    pubClient.on('end', () => logger.log('pubClient end'));
    subClient.on('end', () => logger.log('subClient end'));
    await Promise.all[(pubClient.connect(), subClient.connect())];
    const redisAdapter = createAdapter(pubClient, subClient);
    ws = socketIo(server);
    ws.adapter(redisAdapter);
    logger.log('socket initialized');
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
    logger.debug(`emitted to ${channel}`, object, message);
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
