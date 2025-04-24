import Debug from 'debug';

const DEBUG_NAMESPACE = 'iexec-market-api';

const logger = Debug(DEBUG_NAMESPACE);
const logError = logger.extend('error');

const namespaces = Debug.disable();
Debug.enable(
  `${DEBUG_NAMESPACE}:error*,${DEBUG_NAMESPACE}${
    (namespaces && `,${namespaces}`) || ''
  }`,
);

export { logger, logError };
