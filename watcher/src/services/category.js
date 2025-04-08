import * as config from '../config.js';
import { getProvider, getHub } from '../loaders/ethereum.js';
import * as categoryModel from '../models/categoryModel.js';
import { getLogger } from '../utils/logger.js';
import { throwIfMissing } from '../utils/error.js';
import { waitForGetBlock, callAtBlock } from '../utils/eth-utils.js';
import { traceAll } from '../utils/trace.js';

const { chainId } = config.chain;

const logger = getLogger('services:category');

logger.log('instantiating service');

const _addCategory = async ({
  catid = throwIfMissing(),
  transactionHash = throwIfMissing(),
  blockNumber = throwIfMissing(),
} = {}) => {
  try {
    const provider = getProvider();
    const hubContract = getHub();
    const { timestamp } = await waitForGetBlock(provider, blockNumber);
    const { name, description, workClockTimeRef } = await callAtBlock(
      hubContract.viewCategory.staticCallResult,
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
    logger.warn('addCategory() error', e);
    throw e;
  }
};

const addCategory = traceAll(_addCategory, { logger });

export { addCategory };
