import Debug from 'debug';

const DEBUG_NAMESPACE = 'iexec-watcher';

const OFF = 'off';
const ERROR = 'error';
const WARN = 'warn';
const INFO = 'info';
const DEBUG = 'debug';
const TRACE = 'trace';
const ALL = 'all';

/**
 * always logged
 */
const APP_NAMESPACE = 'app';

const DEFAULT = INFO;

const LOG_LEVELS = [OFF, ERROR, WARN, INFO, DEBUG, TRACE, ALL];

let logLevel = process.env.LOG_LEVEL && process.env.LOG_LEVEL.toLowerCase();
const enabledNamespaces = [APP_NAMESPACE].concat(
  process.env.LOG_NAMESPACES && process.env.LOG_NAMESPACES.split(','),
);

if (!LOG_LEVELS.includes(logLevel)) {
  const quoteStr = (str) => `"${str}"`;
  // eslint-disable-next-line no-console
  console.warn(
    `LOG_LEVEL must be one of ${LOG_LEVELS.map(quoteStr).join(
      ' > ',
    )} (using default: ${quoteStr(DEFAULT)})`,
  );
  logLevel = DEFAULT;
}

const enabledLogLevels = LOG_LEVELS.slice(
  1,
  LOG_LEVELS.findIndex((val) => val === logLevel) + 1,
);

const computedNamespaces = enabledLogLevels
  .map((lvl) => `${DEBUG_NAMESPACE}:${lvl}`)
  .map((base) =>
    enabledNamespaces.map((namespace) => `${base}:${namespace}`).join(','),
  )
  .join(',');

const baseLogger = Debug(DEBUG_NAMESPACE);

const logDefault = baseLogger.extend(INFO);
const logError = baseLogger.extend(ERROR);
const logWarn = baseLogger.extend(WARN);
const logDebug = baseLogger.extend(DEBUG);
const logTrace = baseLogger.extend(TRACE);

const namespaces = Debug.disable();
Debug.enable(
  `${DEBUG_NAMESPACE}:${ERROR}*,${computedNamespaces}${
    (namespaces && `,${namespaces}`) || ''
  }`,
);

const getLogger = (loggerNamespace) => {
  const log = logDefault.extend(loggerNamespace);
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

const LOG_LEVEL = logLevel;

export { getLogger, APP_NAMESPACE, LOG_LEVEL, TRACE };
