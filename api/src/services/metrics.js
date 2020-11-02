const {
  countApporders,
  countDatasetorders,
  countWorkerpoolorders,
  countRequestorders,
} = require('./order');
const { logger } = require('../utils/logger');
const { throwIfMissing } = require('../utils/error');

const log = logger.extend('services:metrics');

log('instanciating service');

const getMetrics = async ({ chainId = throwIfMissing() } = {}) => {
  try {
    const [
      apporders,
      datasetorders,
      workerpoolorders,
      requestorders,
    ] = await Promise.all([
      countApporders({ chainId }),
      countDatasetorders({ chainId }),
      countWorkerpoolorders({ chainId }),
      countRequestorders({ chainId }),
    ]);
    return {
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
