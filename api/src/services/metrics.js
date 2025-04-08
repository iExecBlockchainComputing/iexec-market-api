import {
  countApporders,
  countDatasetorders,
  countWorkerpoolorders,
  countRequestorders,
} from './order.js';
import { getLastBlock, getCheckpointBlock } from './counter.js';
import { logger } from '../utils/logger.js';
import { throwIfMissing } from '../utils/error.js';

const log = logger.extend('services:metrics');

log('instantiating service');

const getMetrics = async ({ chainId = throwIfMissing() } = {}) => {
  try {
    const [
      lastBlock,
      checkpointBlock,
      apporders,
      datasetorders,
      workerpoolorders,
      requestorders,
    ] = await Promise.all([
      getLastBlock({ chainId }),
      getCheckpointBlock({ chainId }),
      countApporders({ chainId }),
      countDatasetorders({ chainId }),
      countWorkerpoolorders({ chainId }),
      countRequestorders({ chainId }),
    ]);
    return {
      lastBlock,
      checkpointBlock,
      apporders,
      datasetorders,
      workerpoolorders,
      requestorders,
    };
  } catch (e) {
    log('getMetrics() error', e);
    throw e;
  }
};

export { getMetrics };
