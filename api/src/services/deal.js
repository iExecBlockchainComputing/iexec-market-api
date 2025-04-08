import * as dealModel from '../models/dealModel.js';
import { logger } from '../utils/logger.js';
import { throwIfMissing, ObjectNotFoundError } from '../utils/error.js';
import { getDbPage, getClientNextPage } from '../utils/pagination-utils.js';

const log = logger.extend('services:deal');

log('instantiating service');

const getOhlc = async ({
  chainId = throwIfMissing(),
  category = throwIfMissing(),
} = {}) => {
  try {
    const DealModel = await dealModel.getModel(chainId);
    const request = { category };
    const sort = {
      blockNumber: 'desc',
      'workerpool.price': 'asc',
      dealid: 'asc', // make sort deterministic
    };
    const limit = 100;
    const deals = await DealModel.find(request).sort(sort).limit(limit);
    return deals.map((e) => [e.blockTimestamp, e.workerpool.price, e.volume]);
  } catch (e) {
    log('getOhlc() error', e);
    throw e;
  }
};

const getDeal = async ({
  chainId = throwIfMissing(),
  dealid = throwIfMissing(),
} = {}) => {
  try {
    const DealModel = await dealModel.getModel(chainId);
    const request = { dealid };
    const deal = await DealModel.findOne(request);
    if (!deal) {
      throw new ObjectNotFoundError('deal not found');
    }
    return deal.toJSON();
  } catch (e) {
    log('getDeal() error', e);
    throw e;
  }
};

const getDeals = async ({
  chainId = throwIfMissing(),
  category,
  requester,
  beneficiary,
  app,
  dataset,
  workerpool,
  appOwner,
  datasetOwner,
  workerpoolOwner,
  apporderHash,
  datasetorderHash,
  workerpoolorderHash,
  requestorderHash,
  page,
  pageIndex,
  pageSize,
} = {}) => {
  try {
    const DealModel = await dealModel.getModel(chainId);
    const request = {
      ...(category !== undefined && {
        category,
      }),
      ...(requester !== undefined && {
        requester,
      }),
      ...(beneficiary !== undefined && {
        beneficiary,
      }),
      ...(app !== undefined && {
        'app.pointer': app,
      }),
      ...(dataset !== undefined && {
        'dataset.pointer': dataset,
      }),
      ...(workerpool !== undefined && {
        'workerpool.pointer': workerpool,
      }),
      ...(appOwner !== undefined && {
        'app.owner': appOwner,
      }),
      ...(datasetOwner !== undefined && {
        'dataset.owner': datasetOwner,
      }),
      ...(workerpoolOwner !== undefined && {
        'workerpool.owner': workerpoolOwner,
      }),
      ...(apporderHash !== undefined && {
        appHash: apporderHash,
      }),
      ...(datasetorderHash !== undefined && {
        datasetHash: datasetorderHash,
      }),
      ...(workerpoolorderHash !== undefined && {
        workerpoolHash: workerpoolorderHash,
      }),
      ...(requestorderHash !== undefined && {
        requestHash: requestorderHash,
      }),
    };
    const sort = {
      blockNumber: 'desc',
      dealid: 'asc', // make sort deterministic
    };

    const { skip, limit } = getDbPage({
      page,
      pageIndex,
      pageSize,
    });

    const count = await DealModel.find(request).countDocuments();
    const deals = await DealModel.find(request)
      .sort(sort)
      .limit(limit)
      .skip(skip);

    const { nextPage } = getClientNextPage({
      resultLength: deals.length,
      limit,
      skip,
    });

    return {
      deals: deals.map((e) => e.toJSON()),
      count,
      nextPage,
    };
  } catch (e) {
    log('getDeals() error', e);
    throw e;
  }
};

export { getDeals, getOhlc, getDeal };
