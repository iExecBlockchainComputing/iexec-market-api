const config = require('../config');
const counterModel = require('../models/counterModel');
const { getLogger } = require('../utils/logger');
const { traceAll } = require('../utils/trace');

const { chainId } = config.chain;

const logger = getLogger('services:counter');

logger.log('instantiating service');

const getNextBlockToProcess = async () => {
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

const getLastBlock = async () => {
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

const setLastBlock = async (blockNumber) => {
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

const getCheckpointBlock = async () => {
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

const setCheckpointBlock = async (blockNumber) => {
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

module.exports = {
  getNextBlockToProcess: traceAll(getNextBlockToProcess, { logger }),
  getLastBlock: traceAll(getLastBlock, { logger }),
  setLastBlock: traceAll(setLastBlock, { logger }),
  getCheckpointBlock: traceAll(getCheckpointBlock, { logger }),
  setCheckpointBlock: traceAll(setCheckpointBlock, { logger }),
};
