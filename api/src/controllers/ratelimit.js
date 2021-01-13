const ratelimit = require('koa-ratelimit');
const { logger } = require('../utils/logger');

const log = logger.extend('controllers:ratelimit');

const getIp = (ctx) => {
  const ip = ctx.header['x-real-ip'] || ctx.header['x-forwarded-for'] || ctx.ip;
  log('request ip', ip);
  return ip;
};

const getRatelimitMiddleware = ({ maxRequest, period }) => {
  const ratelimitMap = new Map();
  return ratelimit({
    driver: 'memory',
    db: ratelimitMap,
    duration: period,
    errorMessage: {
      ok: false,
      error: 'Rate limit exceeded',
    },
    id: getIp,
    max: maxRequest,
    whitelist: (ctx) => {
      // allow * iex.ec
      if (
        ctx.header
        && ctx.header.origin
        && ctx.header.origin.split('.').slice(-2).join('.') === 'iex.ec'
      ) return true;
      // allow localhost
      if (ctx.ip === '::ffff:127.0.0.1') return true;
      return false;
    },
  });
};

module.exports = {
  getRatelimitMiddleware,
};
