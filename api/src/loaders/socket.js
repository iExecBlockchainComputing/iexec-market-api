const socketio = require('socket.io');
const redis = require('redis').createClient;
const adapter = require('socket.io-redis');
const config = require('../config');
const { logger } = require('../utils/logger');
const { throwIfMissing } = require('../utils/error');

const log = logger.extend('socket');

let ws = null;

const getWs = () => {
  if (ws === null) throw new Error('socket not initialized');
  return ws;
};

const init = (server = throwIfMissing()) => {
  log('init socket');
  const redisConfig = { host: config.redis.host };
  const pubClient = redis(redisConfig);
  const subClient = redis(redisConfig);
  pubClient.on('error', err => log('pubClient', 'Error', err));
  subClient.on('error', err => log('subClient', 'Error', err));
  const redisAdapter = adapter({
    pubClient,
    subClient,
  });
  ws = socketio(server, { path: '/ws' });
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
        const rooms = Object.keys(socket.rooms).filter(e => e !== socket.id);
        rooms.forEach(room => socket.leave(room));
        fn(true);
      } catch (error) {
        log('ws.on(leaveAll)', error);
      }
    });
  });
};

const emit = (
  channel = throwIfMissing(),
  object = throwIfMissing(),
  message = throwIfMissing(),
) => {
  getWs()
    .to(channel)
    .emit(object, message);
  log(`emitted to ${channel}`, object, message);
};

module.exports = { init, emit };
