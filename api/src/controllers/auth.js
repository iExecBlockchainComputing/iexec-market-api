const { checkAuthorization } = require('../services/auth');
const { logger } = require('../utils/logger');
const { AuthError } = require('../utils/error');
const { object, string, chainIdSchema } = require('../utils/validator');

const log = logger.extend('controllers:auth');

const authentify = async (ctx, next) => {
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  try {
    const { authorization } = await object({
      authorization: string().required(
        'missing Authorization, please first sign a challenge',
      ),
    }).validate(ctx.request.headers);
    const authorized = await checkAuthorization({
      chainId,
      authorization,
    });
    ctx.authorized = authorized;
  } catch (e) {
    log('authentify() error', e);
    throw new AuthError(e.message, e);
  }
  await next();
};

module.exports = {
  authentify,
};
