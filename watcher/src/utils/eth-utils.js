import * as config from '../config.js';
import { getLogger } from './logger.js';
import { traceAll } from './trace.js';
import { sleep } from './utils.js';

const logger = getLogger('utils:eth-utils');

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

const CALL_AT_BLOCK_MAX_TRY = 10;
const RATE_LIMIT_MAX_TRY = 20;

const getRandomInt = (max) => Math.floor(Math.random() * max);

const throwIfTimeout = (promise, timeout = 30 * 1000) =>
  Promise.race([
    promise,
    sleep(timeout).then(() => {
      throw Error(`Ethereum call timeout after ${timeout} ms`);
    }),
  ]);

const cleanRPC = (res) => {
  if (typeof res === 'boolean') {
    return res;
  }
  if (typeof res === 'string') {
    return res;
  }
  if (typeof res === 'number') {
    return res.toString();
  }
  if (Array.isArray(res) && res.length === Object.keys(res).length) {
    return res.map((e) => cleanRPC(e));
  }
  if (typeof res === 'object' && res._isBigNumber) {
    return res.toString();
  }
  return Object.keys(res).reduce((acc, key) => {
    if (Number.isNaN(parseInt(key, 10))) {
      return Object.assign(acc, { [key]: cleanRPC(res[key]) });
    }
    return acc;
  }, {});
};

const retryableCall = async (
  obj,
  method,
  args,
  { maxTry = RATE_LIMIT_MAX_TRY } = {},
  count = 1,
) => {
  try {
    return await throwIfTimeout(obj[method](...args));
  } catch (e) {
    if (e.code && e.code === 429) {
      logger.debug(`retryableCall ${method} try ${count}`);
      if (count <= maxTry) {
        await sleep(1000 * count + getRandomInt(250));
        return retryableCall(obj, method, args, { maxTry }, count + 1);
      }
    }
    throw e;
  }
};

const retryableFunctionCall = async (
  method,
  args,
  { maxTry = RATE_LIMIT_MAX_TRY } = {},
  count = 1,
) => {
  try {
    return await throwIfTimeout(method(...args));
  } catch (e) {
    if (e.code && e.code === 429) {
      logger.debug(`retryableFunctionCall ${method} try ${count}`);
      if (count <= maxTry) {
        await sleep(1000 * count + getRandomInt(250));
        return retryableFunctionCall(method, args, { maxTry }, count + 1);
      }
    }
    throw e;
  }
};

const _callAtBlock = async (method, args = [], blockNumber = undefined) => {
  const makeCall = async () =>
    blockNumber !== undefined
      ? retryableFunctionCall(method, args)
      : retryableFunctionCall(method, [...args, { blockTag: blockNumber }]);
  let currentTry = 0;
  let res;
  while (res === null || res === undefined) {
    currentTry += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await makeCall();
      if (res === null || res === undefined) {
        logger.debug(
          'callAtBlock()',
          blockNumber,
          `returned ${res}, waiting for block`,
        );
        if (currentTry <= CALL_AT_BLOCK_MAX_TRY) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(config.runtime.retryDelay);
        } else {
          throw Error(`callAtBlock ${blockNumber} Max try reached`);
        }
      }
    } catch (error) {
      if (
        error.code === -32000 ||
        (error.message && error.message.indexOf('-32000') !== -1)
      ) {
        logger.debug(
          'callAtBlock()',
          blockNumber,
          '-32000 error, waiting for block',
        );
        if (currentTry <= CALL_AT_BLOCK_MAX_TRY) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(config.runtime.retryDelay);
        } else {
          throw Error(`callAtBlock ${blockNumber} Max try reached`);
        }
      } else {
        throw error;
      }
    }
  }
  return cleanRPC(res[0]);
};
const callAtBlock = traceAll(_callAtBlock, { logger });

const _getBlockNumber = (provider) =>
  retryableCall(provider, 'getBlockNumber', []);
const getBlockNumber = traceAll(_getBlockNumber, { logger });

const _queryFilter = (contract, args) =>
  retryableCall(contract, 'queryFilter', args);
const queryFilter = traceAll(_queryFilter, { logger });

const _waitForGetBlock = async (provider, blockNumber) => {
  let block;
  let tryCount = 0;
  while (block === undefined || block === null) {
    tryCount += 1;
    if (tryCount > 10) {
      throw Error(
        `Impossible to get block ${blockNumber} after ${tryCount * 1000}ms`,
      );
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      block = await retryableCall(provider, 'getBlock', [blockNumber]);
    } catch (error) {
      logger.debug(
        `waitForGetBlock() ${blockNumber} try ${tryCount} error ${error}`,
      );
    }
    if (!block) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000);
    }
  }
  return block;
};
const waitForGetBlock = traceAll(_waitForGetBlock, { logger });

export {
  NULL_ADDRESS,
  cleanRPC,
  callAtBlock,
  waitForGetBlock,
  getBlockNumber,
  queryFilter,
};
