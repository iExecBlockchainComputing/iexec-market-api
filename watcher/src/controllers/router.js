const Router = require('koa-router');
const { getVersion } = require('../services/version');
const { getLogger } = require('../utils/logger');
const logger = getLogger('controllers:router');


const router = new Router();

// version
router.get('/version', (ctx) => {
  logger.log('GET /version');
  const version = getVersion();
  ctx.body = { ok: true, version };
});


module.exports = {
  router,
};
