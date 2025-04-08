import { getLogger, TRACE, LOG_LEVEL } from './logger.js';

const defaultTraceLogger = getLogger('default-trace-logger');

const traceExecutionTime = (obj, { logger = defaultTraceLogger } = {}) => {
  if (TRACE !== LOG_LEVEL) {
    return obj;
  }
  return new Proxy(obj, {
    apply(target, thisArg, args) {
      const startHRTime = process.hrtime();
      const res = target.apply(thisArg, args);
      if (res instanceof Promise) {
        res.finally(() => {
          const endHRTime = process.hrtime(startHRTime);
          const execTime = endHRTime[0] * 1000 + endHRTime[1] / 1000000;
          logger.trace(`${target && target.name} executed in ${execTime}ms`);
        });
      } else {
        const endHRTime = process.hrtime(startHRTime);
        const execTime = endHRTime[0] * 1000 + endHRTime[1] / 1000000;
        logger.trace(`${target && target.name} executed in ${execTime}ms`);
      }
      return res;
    },
  });
};

const traceConcurrentExecutions = (
  obj,
  { logger = defaultTraceLogger } = {},
) => {
  if (TRACE !== LOG_LEVEL) {
    return obj;
  }
  let started = 0;
  let ended = 0;
  return new Proxy(obj, {
    apply(target, thisArg, args) {
      started += 1;
      logger.trace(
        `${target && target.name} running ${started - ended} ended ${ended}`,
      );
      const res = target.apply(thisArg, args);
      if (res instanceof Promise) {
        res.finally(() => {
          ended += 1;
          logger.trace(
            `${target && target.name} running ${
              started - ended
            } ended ${ended}`,
          );
        });
      } else {
        ended += 1;
        logger.trace(
          `${target && target.name} running ${started - ended} ended ${ended}`,
        );
      }
      return res;
    },
  });
};

const traceAll = (obj, { logger = defaultTraceLogger } = {}) =>
  traceConcurrentExecutions(traceExecutionTime(obj, { logger }), { logger });

export { traceExecutionTime, traceConcurrentExecutions, traceAll };
