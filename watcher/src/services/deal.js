import * as config from '../config.js';
import { getProvider, getHub } from '../loaders/ethereum.js';
import { eventEmitter } from '../loaders/eventEmitter.js';
import * as dealModel from '../models/dealModel.js';
import { getLogger } from '../utils/logger.js';
import { throwIfMissing } from '../utils/error.js';
import { waitForGetBlock, callAtBlock } from '../utils/eth-utils.js';
import { traceAll } from '../utils/trace.js';

const { chainId } = config.chain;

const logger = getLogger('services:deal');

logger.log('instantiating service');

const _addDeal = async ({
  dealid = throwIfMissing(),
  volume = throwIfMissing(),
  appHash = throwIfMissing(),
  datasetHash = throwIfMissing(),
  workerpoolHash = throwIfMissing(),
  requestHash = throwIfMissing(),
  transactionHash = throwIfMissing(),
  blockNumber = throwIfMissing(),
} = {}) => {
  try {
    const hubContract = getHub();
    const provider = getProvider();
    const { timestamp } = await waitForGetBlock(provider, blockNumber);
    const {
      app,
      dataset,
      workerpool,
      trust,
      category,
      tag,
      requester,
      beneficiary,
      callback,
      params,
      startTime,
      botFirst,
      botSize,
      workerStake,
      schedulerRewardRatio,
    } = await callAtBlock(
      hubContract.functions.viewDeal,
      [dealid],
      blockNumber,
    );
    const DealModel = await dealModel.getModel(chainId);
    const existing = await DealModel.findOne({ dealid });
    const saved = await DealModel.findOneAndUpdate(
      { dealid },
      {
        dealid,
        chainId,
        volume,
        app,
        dataset,
        workerpool,
        trust,
        category,
        tag,
        requester,
        beneficiary,
        callback,
        params,
        startTime,
        botFirst,
        botSize,
        workerStake,
        schedulerRewardRatio,
        appHash,
        datasetHash,
        workerpoolHash,
        requestHash,
        transactionHash,
        blockNumber,
        blockTimestamp: new Date(timestamp * 1000).toISOString(),
      },
      {
        upsert: true,
        new: true,
      },
    );
    if (!existing) {
      eventEmitter.emit('deal_created', saved.toJSON());
    }
  } catch (e) {
    logger.warn('addDeal() error', e);
    throw e;
  }
};

const addDeal = traceAll(_addDeal, { logger });

export { addDeal };
