const config = require('../config');
const { getProvider, getHub } = require('../loaders/ethereum');
const categoryModel = require('../models/categoryModel');
const { logger } = require('../utils/logger');
const { throwIfMissing } = require('../utils/error');
const { waitForGetBlock, callAtBlock } = require('../utils/eth-utils');

const { chainId } = config.chain;

const log = logger.extend('services:category');

log('instanciating service');

const addCategory = async ({
  catid = throwIfMissing(),
  transactionHash = throwIfMissing(),
  blockNumber = throwIfMissing(),
} = {}) => {
  try {
    const provider = getProvider();
    const hubContract = getHub();
    const { timestamp } = await waitForGetBlock(provider, blockNumber);
    const { name, description, workClockTimeRef } = await callAtBlock(
      hubContract.functions.viewCategory,
      [catid],
      blockNumber,
    );
    const CategoryModel = await categoryModel.getModel(chainId);
    await CategoryModel.findOneAndUpdate(
      { catid },
      {
        catid,
        chainId,
        name,
        description,
        workClockTimeRef,
        blockNumber,
        transactionHash,
        blockTimestamp: timestamp && new Date(timestamp * 1000).toISOString(),
      },
      {
        upsert: true,
        new: true,
      },
    );
  } catch (e) {
    log('addCategory() error', e);
    throw e;
  }
};

module.exports = {
  addCategory,
};
