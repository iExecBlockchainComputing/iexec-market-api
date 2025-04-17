/* eslint-disable sonarjs/no-identical-functions */
import { ValidationError } from 'yup';
import { logError } from './logger.js';

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

class OperationalError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class AuthError extends OperationalError {
  constructor(message, originalError) {
    super(message);
    this.name = this.constructor.name;
    this.originalError = originalError;
    if (originalError && typeof originalError === 'object') {
      Object.assign(this, getPropsToCopy(originalError));
    }
  }
}

class BusinessError extends OperationalError {
  constructor(message, originalError) {
    super(message);
    this.name = this.constructor.name;
    this.originalError = originalError;
    if (originalError && typeof originalError === 'object') {
      Object.assign(this, getPropsToCopy(originalError));
    }
  }
}

class ObjectNotFoundError extends OperationalError {
  constructor(message, originalError) {
    super(message);
    this.name = this.constructor.name;
    this.originalError = originalError;
    if (originalError && typeof originalError === 'object') {
      Object.assign(this, getPropsToCopy(originalError));
    }
  }
}

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

const errorHandler = (error, context) => {
  if (
    !(error instanceof ValidationError) &&
    !(error instanceof OperationalError)
  ) {
    logError(error, '\nContext: ', JSON.stringify(context, null, 2));
  }
};

export {
  ValidationError,
  AuthError,
  BusinessError,
  ObjectNotFoundError,
  InternalError,
  Web3ProviderError,
  wrapEthCall,
  throwIfMissing,
  errorHandler,
};
