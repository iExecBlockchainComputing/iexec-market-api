import { getLogger, APP_NAMESPACE } from './logger.js';
import { sleep } from './utils.js';

const logError = getLogger(APP_NAMESPACE).error;

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

let isRecovering = false;
const GRACE_PERIOD = 3000;
const recoverOnCriticalError = async () => {
  if (!isRecovering) {
    isRecovering = true;
    logError(
      `A critical error has occurred - Stopping process in ${GRACE_PERIOD}ms`,
    );
    sleep(GRACE_PERIOD);
    logError('A critical error has occurred - Stopping process now');
    process.exit(1);
  }
};

const errorHandler = async (error, context) => {
  logError(
    error,
    '\nContext: ',
    JSON.stringify(
      context,
      // safe stringify bigint
      (_, v) => (typeof v === 'bigint' ? `BigInt('${v}')` : v),
    ),
  );
  if (context.critical) {
    recoverOnCriticalError();
  }
};

export {
  InternalError,
  Web3ProviderError,
  wrapEthCall,
  throwIfMissing,
  errorHandler,
  recoverOnCriticalError,
};
