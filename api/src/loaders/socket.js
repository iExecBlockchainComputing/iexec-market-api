const socketIo = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const config = require('../config');
const { logger } = require('../utils/logger');
const { throwIfMissing, errorHandler } = require('../utils/error');

const log = logger.extend('socket');

let ws = null;

const getWs = () => {
  if (ws === null) throw new Error('socket not initialized');
  return ws;
};

const init = async (server = throwIfMissing()) => {
  try {
    log('init socket');
    const redisConfig = config.redis;
    const pubClient = createClient(redisConfig);
    const subClient = createClient(redisConfig);
    pubClient.on('error', (err) => log('pubClient', 'Error', err));
    subClient.on('error', (err) => log('subClient', 'Error', err));
    pubClient.on('connect', () => log('pubClient connect'));
    subClient.on('connect', () => log('subClient connect'));
    pubClient.on('end', () => log('pubClient end'));
    subClient.on('end', () => log('subClient end'));
    await Promise.all[(pubClient.connect(), subClient.connect())];
    const redisAdapter = createAdapter(pubClient, subClient);
    ws = socketIo(server, { path: '/ws', cors: { origin: '*' } });
    ws.adapter(redisAdapter);
    ws.sockets.on('connection', (socket) => {
      log('connection');
      socket.on('join', (data, fn) => {
        try {
          if (data.chainId && data.topic) {
            log('on.join', socket.id, `${data.chainId}:${data.topic}`);
            socket.join(`${data.chainId}:${data.topic}`);
            fn(true);
          }
        } catch (error) {
          log('ws.on(join)', error);
        }
      });
      socket.on('leave', (data, fn) => {
        try {
          log('on.leave', socket.id, `${data.chainId}:${data.category}`);
          socket.leave(`${data.chainId}:${data.category}`);
          fn(true);
        } catch (error) {
          log('ws.on(leave)', error);
        }
      });
      socket.on('leaveAll', (data, fn) => {
        try {
          log('on.leaveAll', socket.id, `${data.chainId}:${data.category}`);
          const rooms = Object.keys(socket.rooms).filter(
            (e) => e !== socket.id,
          );
          rooms.forEach((room) => socket.leave(room));
          fn(true);
        } catch (error) {
          log('ws.on(leaveAll)', error);
        }
      });
    });
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
