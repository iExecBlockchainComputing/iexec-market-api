import http from 'http';
import { Server as SocketIo } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis as redisConfig } from '../config.js';
import { getLogger } from '../utils/logger.js';
import { throwIfMissing, errorHandler } from '../utils/error.js';

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
    ws = new SocketIo(server);
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

export { init, emit };
