const config = require('../config');
const { getLogger } = require('./logger');
const { sleep } = require('./utils');

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
    const res = await throwIfTimeout(obj[method](...args));
    return res;
  } catch (e) {
    if (e.code && e.code === 429) {
      logger.log('retryableCall()', method, 'try', count);
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
    const res = await throwIfTimeout(method(...args));
    return res;
  } catch (e) {
    if (e.code && e.code === 429) {
      logger.log('retryableFunctionCall()', 'try', count);
      if (count <= maxTry) {
        await sleep(1000 * count + getRandomInt(250));
        return retryableFunctionCall(method, args, { maxTry }, count + 1);
      }
    }
    throw e;
  }
};

const callAtBlock = async (method, args = [], blockNumber = undefined) => {
  const makeCall = async () =>
    blockNumber !== undefined
      ? retryableFunctionCall(method, args)
      : retryableFunctionCall(method, [...args, { blockTag: blockNumber }]);
  let currentTry = 0;
  let res;
  while (res === null || res === undefined) {
    currentTry += 1;
    try {
      res = await makeCall();
      if (res === null || res === undefined) {
        logger.log(
          'callAtBlock()',
          blockNumber,
          `returned ${res}, waiting for block`,
        );
        if (currentTry <= CALL_AT_BLOCK_MAX_TRY) {
          await sleep(config.runtime.retryDelay);
        } else {
          throw Error('callAtBlock()', blockNumber, 'Max try reached');
        }
      }
    } catch (error) {
      if (
        error.code === -32000 ||
        (error.message && error.message.indexOf('-32000') !== -1)
      ) {
        logger.log(
          'callAtBlock()',
          blockNumber,
          '-32000 error, waiting for block',
        );
        if (currentTry <= CALL_AT_BLOCK_MAX_TRY) {
          await sleep(config.runtime.retryDelay);
        } else {
          throw Error('callAtBlock()', blockNumber, 'Max try reached');
        }
      } else {
        throw error;
      }
    }
  }
  return cleanRPC(res[0]);
};

const getBlockNumber = (provider) =>
  retryableCall(provider, 'getBlockNumber', []);

const queryFilter = (contract, args) =>
  retryableCall(contract, 'queryFilter', args);

const waitForGetBlock = async (provider, blockNumber) => {
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
      block = await retryableCall(provider, 'getBlock', [blockNumber]);
    } catch (error) {
      logger.log('waitForGetBlock()', blockNumber, tryCount, error);
    }
    if (!block) {
      await sleep(1000);
    }
  }
  return block;
};

module.exports = {
  NULL_ADDRESS,
  cleanRPC,
  callAtBlock,
  waitForGetBlock,
  getBlockNumber,
  queryFilter,
};
