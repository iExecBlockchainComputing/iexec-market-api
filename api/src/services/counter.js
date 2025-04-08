import * as counterModel from '../models/counterModel.js';
import { throwIfMissing } from '../utils/error.js';
import { logger } from '../utils/logger.js';

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

export { getLastBlock, getCheckpointBlock };
