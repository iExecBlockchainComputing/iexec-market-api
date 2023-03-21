const Debug = require('debug');

const DEBUG_NAMESPACE = 'iexec-watcher';

const baseLogger = Debug(DEBUG_NAMESPACE);

const logger = baseLogger.extend('log');
const logError = baseLogger.extend('error');
const logWarn = baseLogger.extend('warn');
const logDebug = baseLogger.extend('debug');
const logTrace = baseLogger.extend('trace');

const namespaces = Debug.disable();
Debug.enable(
  `${DEBUG_NAMESPACE}:error*,${DEBUG_NAMESPACE}:log:app${
    (namespaces && `,${namespaces}`) || ''
  }`,
);

const getLogger = (loggerNamespace) => {
  const log = logger.extend(loggerNamespace);
  const error = logError.extend(loggerNamespace);
  const warn = logWarn.extend(loggerNamespace);
  const debug = logDebug.extend(loggerNamespace);
  const trace = logTrace.extend(loggerNamespace);
  return {
    log,
    error,
    warn,
    debug,
    trace,
  };
};

module.exports = {
  getLogger,
  logError,
};
