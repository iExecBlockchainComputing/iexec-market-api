import { checkAuthorization } from '../services/auth.js';
import { logger } from '../utils/logger.js';
import { AuthError } from '../utils/error.js';
import { object, string, chainIdSchema } from '../utils/validator.js';

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

export { authentify };
