const Debug = require('debug');

const DEBUG_NAMESPACE = 'iexec-watcher';

const logger = Debug(DEBUG_NAMESPACE);
const logError = logger.extend('error');

const namespaces = Debug.disable();
Debug.enable(
  `${DEBUG_NAMESPACE}:error*,${DEBUG_NAMESPACE}:app${(namespaces
    && `,${namespaces}`)
    || ''}`,
);

module.exports = {
  logger,
  logError,
};
