import * as config from '../config.js';
import * as counterModel from '../models/counterModel.js';
import { getLogger } from '../utils/logger.js';
import { traceAll } from '../utils/trace.js';

const { chainId } = config.chain;

const logger = getLogger('services:counter');

logger.log('instantiating service');

const _getNextBlockToProcess = async () => {
  try {
    const CounterModel = await counterModel.getModel(chainId);
    const lastBlockCounter = await CounterModel.findOne({ name: 'lastBlock' });
    if (lastBlockCounter !== null) return lastBlockCounter.value + 1;
    return config.runtime.startBlock;
  } catch (e) {
    logger.warn('getNextBlockToProcess()', e);
    throw e;
  }
};

const _getLastBlock = async () => {
  try {
    const CounterModel = await counterModel.getModel(chainId);
    const lastBlockCounter = await CounterModel.findOne({ name: 'lastBlock' });
    if (lastBlockCounter !== null) return lastBlockCounter.value;
    return config.runtime.startBlock;
  } catch (e) {
    logger.warn('getLastBlock()', e);
    throw e;
  }
};

const _setLastBlock = async (blockNumber) => {
  try {
    const CounterModel = await counterModel.getModel(chainId);
    const lastBlockCounter = await CounterModel.findOneAndUpdate(
      { name: 'lastBlock' },
      { $max: { value: blockNumber } },
      { new: true, upsert: true },
    );
    logger.log('lastBlockCounter', lastBlockCounter.value);
  } catch (e) {
    logger.warn('setLastBlock()', e);
    throw e;
  }
};

const _getCheckpointBlock = async () => {
  try {
    const CounterModel = await counterModel.getModel(chainId);
    const checkpointBlockCounter = await CounterModel.findOne({
      name: 'checkpointBlock',
    });
    if (checkpointBlockCounter !== null) return checkpointBlockCounter.value;
    return config.runtime.startBlock;
  } catch (e) {
    logger.warn('getCheckpointBlock()', e);
    throw e;
  }
};

const _setCheckpointBlock = async (blockNumber) => {
  try {
    const CounterModel = await counterModel.getModel(chainId);
    const checkpointBlockCounter = await CounterModel.findOneAndUpdate(
      { name: 'checkpointBlock' },
      { value: blockNumber },
      { new: true, upsert: true },
    );
    logger.log('checkpointBlockCounter', checkpointBlockCounter.value);
  } catch (e) {
    logger.warn('setCheckpointBlock()', e);
    throw e;
  }
};

const getNextBlockToProcess = traceAll(_getNextBlockToProcess, { logger });
const getLastBlock = traceAll(_getLastBlock, { logger });
const setLastBlock = traceAll(_setLastBlock, { logger });
const getCheckpointBlock = traceAll(_getCheckpointBlock, { logger });
const setCheckpointBlock = traceAll(_setCheckpointBlock, { logger });

export {
  getNextBlockToProcess,
  getLastBlock,
  setLastBlock,
  getCheckpointBlock,
  setCheckpointBlock,
};
