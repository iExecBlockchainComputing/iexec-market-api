const http = require('http');
const socketio = require('socket.io');
const redis = require('redis').createClient;
const adapter = require('socket.io-redis');
const config = require('../config');
const { logger } = require('../utils/logger');
const { throwIfMissing } = require('../utils/error');

const log = logger.extend('socket');

const server = http.createServer();

let ws = null;

const getWs = () => {
  if (ws === null) throw new Error('socket not initialized');
  return ws;
};

const init = () => {
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
  ws = socketio(server);
  ws.adapter(redisAdapter);
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
