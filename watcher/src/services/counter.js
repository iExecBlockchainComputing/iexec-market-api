const config = require('../config');
const counterModel = require('../models/counterModel');
const { getLogger } = require('../utils/logger');

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
    logger.log('getNextBlockToProcess()', e);
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
    logger.log('getLastBlock()', e);
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
    logger.log('setLastBlock()', e);
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
    logger.log('getCheckpointBlock()', e);
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
    logger.log('setCheckpointBlock()', e);
    throw e;
  }
};

module.exports = {
  getNextBlockToProcess,
  getLastBlock,
  setLastBlock,
  getCheckpointBlock,
  setCheckpointBlock,
};
