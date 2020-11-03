const counterModel = require('../models/counterModel');
const { throwIfMissing } = require('../utils/error');
const { logger } = require('../utils/logger');

const log = logger.extend('services:counter');

const getLastBlock = async ({ chainId } = throwIfMissing()) => {
  try {
    const CounterModel = await counterModel.getModel(chainId);
    const lastBlockCounter = await CounterModel.findOne({ name: 'lastBlock' });
    if (lastBlockCounter !== null) return lastBlockCounter.value;
    return 0;
  } catch (e) {
    log('getLastBlock()', e);
    throw e;
  }
};

const getCheckpointBlock = async ({ chainId } = throwIfMissing()) => {
  try {
    const CounterModel = await counterModel.getModel(chainId);
    const checkpointBlockCounter = await CounterModel.findOne({
      name: 'checkpointBlock',
    });
    if (checkpointBlockCounter !== null) return checkpointBlockCounter.value;
    return 0;
  } catch (e) {
    log('getCheckpointBlock()', e);
    throw e;
  }
};

module.exports = {
  getLastBlock,
  getCheckpointBlock,
};
