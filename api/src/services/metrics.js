const {
  countApporders,
  countDatasetorders,
  countWorkerpoolorders,
  countRequestorders,
} = require('./order');
const {
  getLastBlock,
  getCheckpointBlock,
} = require('./counter');
const { logger } = require('../utils/logger');
const { throwIfMissing } = require('../utils/error');

const log = logger.extend('services:metrics');

log('instanciating service');

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

module.exports = { getMetrics };
