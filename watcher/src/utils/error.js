/* eslint max-classes-per-file: ["error", 6] */

const { logError } = require('./logger');
const { sleep } = require('./utils');

const getPropsToCopy = (error) => {
  const {
    name,
    message,
    stack,
    constructor,
    originalError,
    toJSON,
    ...propsToCopy
  } = error;
  return propsToCopy;
};

class InternalError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = this.constructor.name;
    this.originalError = originalError;
    if (originalError && typeof originalError === 'object') {
      Object.assign(this, getPropsToCopy(originalError));
    }
  }
}

class Web3ProviderError extends InternalError {
  constructor(message, originalError) {
    super(message, originalError);
    this.name = this.constructor.name;
    this.originalError = originalError;
    if (originalError && typeof originalError === 'object') {
      Object.assign(this, getPropsToCopy(originalError));
    }
  }
}

const wrapEthCall = async (promise) => {
  try {
    return await promise;
  } catch (err) {
    if (typeof err === 'string') {
      throw new Web3ProviderError(err, err);
    }
    throw new Web3ProviderError(err.message, err);
  }
};

const throwIfMissing = () => {
  throw new InternalError('missing parameter');
};

const recoverOnCriticalError = () => {
  logError(
    'A critical error has occured - Stopping process to recover on next sartup',
  );
  process.exit(1);
};

const errorHandler = async (error, context) => {
  logError(error, '\nContext: ', JSON.stringify(context, null, 2));
  if (context.critical) {
    await sleep(3000);
    recoverOnCriticalError();
  }
};

module.exports = {
  InternalError,
  Web3ProviderError,
  wrapEthCall,
  throwIfMissing,
  errorHandler,
  recoverOnCriticalError,
};
