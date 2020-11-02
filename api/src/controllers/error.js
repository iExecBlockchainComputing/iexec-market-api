const { logger } = require('../utils/logger');
const {
  ValidationError,
  AuthError,
  InternalError,
  BusinessError,
  ObjectNotFoundError,
  errorHandler,
} = require('../utils/error');

const log = logger.extend('controllers:error');

const errorMiddleware = async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    errorHandler(error, { type: 'request', request: ctx.request });
    if (error instanceof AuthError) {
      log('AuthError:', error.message);
      ctx.status = 403;
      ctx.body = { ok: false, error: 'invalid authorization' };
      return;
    }
    if (error instanceof InternalError) {
      log('InternalError:', error.message);
      ctx.status = 500;
      ctx.body = {
        ok: false,
        error: 'Something went wrong, you should retry later.',
      };
      return;
    }
    if (error instanceof ValidationError) {
      log('ValidationError:', error.message);
      ctx.status = 400;
      ctx.body = { ok: false, error: error.message };
      return;
    }
    if (error instanceof BusinessError) {
      log('BusinessError:', error.message);
      ctx.status = 403;
      ctx.body = { ok: false, error: error.message };
      return;
    }
    if (error instanceof ObjectNotFoundError) {
      log('ObjectNotFoundError:', error.message);
      ctx.status = 404;
      ctx.body = { ok: false, error: error.message };
      return;
    }
    log('Error:', error.message);
    ctx.status = 500;
    ctx.body = {
      ok: false,
      error: 'Internal error',
    };
  }
};

module.exports = {
  errorMiddleware,
};
