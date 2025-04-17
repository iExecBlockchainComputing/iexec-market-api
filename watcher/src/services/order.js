import * as config from '../config.js';
import { eventEmitter } from '../loaders/eventEmitter.js';
import {
  getHub,
  getApp,
  getDataset,
  getWorkerpool,
} from '../loaders/ethereum.js';
import * as apporderModel from '../models/apporderModel.js';
import * as datasetorderModel from '../models/datasetorderModel.js';
import * as workerpoolorderModel from '../models/workerpoolorderModel.js';
import * as requestorderModel from '../models/requestorderModel.js';
import { getLogger } from '../utils/logger.js';
import { throwIfMissing } from '../utils/error.js';
import { STATUS_MAP, TAG_MAP, tagToArray } from '../utils/iexec-utils.js';
import { callAtBlock, NULL_ADDRESS } from '../utils/eth-utils.js';
import { traceAll } from '../utils/trace.js';

const { chainId } = config.chain;

const logger = getLogger('services:order');

logger.log('instantiating service');

const cleanApporders = async ({
  orders = throwIfMissing(),
  reason = throwIfMissing(),
}) => {
  const ApporderModel = await apporderModel.getModel(chainId);
  const cleanedOrders = await Promise.all(
    orders.map((e) =>
      ApporderModel.findOneAndUpdate(
        { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
        {
          status: STATUS_MAP.DEAD,
        },
        { returnOriginal: false },
      ),
    ),
  );
  cleanedOrders
    .filter((e) => !!e)
    .map((e) => e.toJSON())
    .forEach((e) => {
      logger.debug('apporder cleaned', e.orderHash, reason);
      eventEmitter.emit('apporder_cleaned', e);
    });
};

const cleanDatasetorders = async ({
  orders = throwIfMissing(),
  reason = throwIfMissing(),
}) => {
  const DatasetorderModel = await datasetorderModel.getModel(chainId);
  const cleanedOrders = await Promise.all(
    orders.map((e) =>
      DatasetorderModel.findOneAndUpdate(
        { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
        {
          status: STATUS_MAP.DEAD,
        },
        { returnOriginal: false },
      ),
    ),
  );
  cleanedOrders
    .filter((e) => !!e)
    .map((e) => e.toJSON())
    .forEach((e) => {
      logger.debug('datasetorder cleaned', e.orderHash, reason);
      eventEmitter.emit('datasetorder_cleaned', e);
    });
};

const cleanWorkerpoolorders = async ({
  orders = throwIfMissing(),
  reason = throwIfMissing(),
}) => {
  const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
  const cleanedOrders = await Promise.all(
    orders.map((e) =>
      WorkerpoolorderModel.findOneAndUpdate(
        { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
        {
          status: STATUS_MAP.DEAD,
        },
        { returnOriginal: false },
      ),
    ),
  );
  cleanedOrders
    .filter((e) => !!e)
    .map((e) => e.toJSON())
    .forEach((e) => {
      logger.debug('workerpoolorder cleaned', e.orderHash, reason);
      eventEmitter.emit('workerpoolorder_cleaned', e);
    });
};

const cleanRequestorders = async ({
  orders = throwIfMissing(),
  reason = throwIfMissing(),
}) => {
  const RequestorderModel = await requestorderModel.getModel(chainId);
  const cleanedOrders = await Promise.all(
    orders.map((e) =>
      RequestorderModel.findOneAndUpdate(
        { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
        {
          status: STATUS_MAP.DEAD,
        },
        { returnOriginal: false },
      ),
    ),
  );
  cleanedOrders
    .filter((e) => !!e)
    .map((e) => e.toJSON())
    .forEach((e) => {
      logger.debug('requestorder cleaned', e.orderHash, reason);
      eventEmitter.emit('requestorder_cleaned', e);
    });
};

const checkMatchableApporder = async ({ order = throwIfMissing() } = {}) => {
  const ApporderModel = await apporderModel.getModel(chainId);
  const teeRequired = tagToArray(order.tag).includes(TAG_MAP.tee);
  const [bestApporder] = await ApporderModel.find({
    'order.app': order.app,
    status: STATUS_MAP.OPEN,
    'order.workerpoolrestrict': {
      $in: [NULL_ADDRESS, order.workerpool],
    },
    'order.datasetrestrict': {
      $in: [NULL_ADDRESS, order.dataset],
    },
    'order.requesterrestrict': {
      $in: [NULL_ADDRESS, order.requester],
    },
    ...(teeRequired && { tagArray: { $all: [TAG_MAP.tee] } }),
  })
    .sort({ 'order.appprice': 1, publicationTimestamp: 1 })
    .limit(1);
  if (!bestApporder) {
    return false;
  }
  const bestAppPrice = BigInt(bestApporder.order.appprice);
  const appPrice = BigInt(order.appmaxprice);
  return appPrice >= bestAppPrice;
};

const checkMatchableDatasetorder = async ({
  order = throwIfMissing(),
} = {}) => {
  const DatasetorderModel = await datasetorderModel.getModel(chainId);
  const [bestDatasetorder] = await DatasetorderModel.find({
    'order.dataset': order.dataset,
    status: STATUS_MAP.OPEN,
    'order.workerpoolrestrict': {
      $in: [NULL_ADDRESS, order.workerpool],
    },
    'order.apprestrict': {
      $in: [NULL_ADDRESS, order.app],
    },
    'order.requesterrestrict': {
      $in: [NULL_ADDRESS, order.requester],
    },
  })
    .sort({ 'order.datasetprice': 1, publicationTimestamp: 1 })
    .limit(1);
  if (!bestDatasetorder) {
    return false;
  }
  const bestDatasetPrice = BigInt(bestDatasetorder.order.datasetprice);
  const datasetPrice = BigInt(order.datasetmaxprice);
  return datasetPrice >= bestDatasetPrice;
};

const _cleanApporderDependantOrders = async ({
  apporder = throwIfMissing(),
} = {}) => {
  try {
    const resourceAddress = apporder.order.app;
    let toCheckOrders = [];

    // standard apporder dependency check
    const ApporderModel = await apporderModel.getModel(chainId);
    const [priceRes] = await ApporderModel.aggregate([
      {
        $match: {
          'order.app': resourceAddress,
          'order.datasetrestrict': NULL_ADDRESS,
          'order.requesterrestrict': NULL_ADDRESS,
          'order.workerpoolrestrict': NULL_ADDRESS,
          status: STATUS_MAP.OPEN,
        },
      },
      {
        $group: {
          _id: null,
          price: {
            $min: '$order.appprice',
          },
        },
      },
    ]);
    const bestPrice = priceRes && priceRes.price;
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const standardDependantOrders = await RequestorderModel.find({
      status: STATUS_MAP.OPEN,
      'order.app': resourceAddress,
      ...(bestPrice !== undefined && {
        'order.appmaxprice': {
          $lt: bestPrice,
        },
      }),
    });
    toCheckOrders = toCheckOrders.concat(standardDependantOrders);

    // tee apporder dependency check
    if (
      apporder.order.tag &&
      tagToArray(apporder.order.tag).includes(TAG_MAP.tee)
    ) {
      const [priceTeeRes] = await ApporderModel.aggregate([
        {
          $match: {
            'order.app': resourceAddress,
            'order.datasetrestrict': NULL_ADDRESS,
            'order.requesterrestrict': NULL_ADDRESS,
            'order.workerpoolrestrict': NULL_ADDRESS,
            status: STATUS_MAP.OPEN,
            tagArray: { $all: [TAG_MAP.tee] },
          },
        },
        {
          $group: {
            _id: null,
            price: {
              $min: '$order.appprice',
            },
          },
        },
      ]);
      const bestPriceTee = priceTeeRes && priceTeeRes.price;
      const teeDependantOrders = await RequestorderModel.find({
        status: STATUS_MAP.OPEN,
        'order.app': resourceAddress,
        tagArray: { $all: [TAG_MAP.tee] },
        ...(bestPriceTee !== undefined && {
          'order.appmaxprice': {
            $lt: bestPriceTee,
          },
        }),
      });
      toCheckOrders = toCheckOrders.concat(teeDependantOrders);
    }

    const dependantOrders = await Promise.all(
      toCheckOrders.map((requestorder) =>
        checkMatchableApporder({ order: requestorder.order }),
      ),
    ).then((matchResults) =>
      toCheckOrders.filter((requestorder, index) => !matchResults[index]),
    );

    await cleanRequestorders({
      orders: dependantOrders,
      reason: 'apporder dependant requestorder',
    });
  } catch (e) {
    logger.warn('cleanApporderDependantOrders() error', e);
    throw e;
  }
};

const _cleanDatasetorderDependantOrders = async ({
  datasetorder = throwIfMissing(),
} = {}) => {
  try {
    const resourceAddress = datasetorder.order.dataset;

    // datasetorder dependency check
    const DatasetorderModel = await datasetorderModel.getModel(chainId);
    const [priceRes] = await DatasetorderModel.aggregate([
      {
        $match: {
          'order.dataset': resourceAddress,
          'order.requesterrestrict': NULL_ADDRESS,
          'order.workerpoolrestrict': NULL_ADDRESS,
          status: STATUS_MAP.OPEN,
        },
      },
      {
        $group: {
          _id: null,
          price: {
            $min: '$order.datasetprice',
          },
        },
      },
    ]);
    const bestPrice = priceRes && priceRes.price;
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const toCheckOrders = await RequestorderModel.find({
      status: STATUS_MAP.OPEN,
      'order.dataset': resourceAddress,
      ...(bestPrice !== undefined && {
        'order.datasetmaxprice': {
          $lt: bestPrice,
        },
      }),
    });

    const dependantOrders = await Promise.all(
      toCheckOrders.map((requestorder) =>
        checkMatchableDatasetorder({ order: requestorder.order }),
      ),
    ).then((matchResults) =>
      toCheckOrders.filter((requestorder, index) => !matchResults[index]),
    );

    await cleanRequestorders({
      orders: dependantOrders,
      reason: 'datasetorder dependant requestorder',
    });
  } catch (e) {
    logger.warn('cleanDatasetorderDependantOrders() error', e);
    throw e;
  }
};

const _cleanBalanceDependantOrders = async ({
  address = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const hubContract = getHub();
    const { stake: userStake } = await callAtBlock(
      hubContract.viewAccount.staticCallResult,
      [address],
      blockNumber,
    );

    // todo run in parallel
    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const getDeadWorkerpoolOrders = async () => {
      const workerpoolorders = await WorkerpoolorderModel.find({
        signer: address,
        status: STATUS_MAP.OPEN,
        'order.workerpoolprice': { $gt: 0 },
        remaining: { $gt: 0 },
      });
      return workerpoolorders.filter(
        (e) =>
          userStake <
          ((BigInt(e.order.workerpoolprice) * 30n) / 100n) *
            BigInt(e.remaining),
      );
    };
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const getDeadRequestOrders = async () => {
      const requestorders = await RequestorderModel.find({
        signer: address,
        status: STATUS_MAP.OPEN,
        remaining: { $gt: 0 },
      });
      return requestorders.filter(
        (e) =>
          userStake <
          (BigInt(e.order.appmaxprice) +
            BigInt(e.order.datasetmaxprice) +
            BigInt(e.order.workerpoolmaxprice)) *
            BigInt(e.remaining),
      );
    };
    const [deadRequestOrders, deadWorkerpoolOrders] = await Promise.all([
      getDeadRequestOrders(),
      getDeadWorkerpoolOrders(),
    ]);

    await Promise.all([
      cleanRequestorders({
        orders: deadRequestOrders,
        reason: 'balance dependant requestorder',
      }),
      cleanWorkerpoolorders({
        orders: deadWorkerpoolOrders,
        reason: 'balance dependant workerpoolorder',
      }),
    ]);
  } catch (e) {
    logger.warn('cleanBalanceDependantOrders()', e);
    throw e;
  }
};

const _cleanTransferredAppOrders = async ({
  address = throwIfMissing(),
  app = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const appContract = getApp(app);
    const owner = await callAtBlock(
      appContract.owner.staticCallResult,
      [],
      blockNumber,
    );
    if (owner !== address) {
      const ApporderModel = await apporderModel.getModel(chainId);
      const deadOrders = await ApporderModel.find({
        'order.app': app,
        signer: address,
        status: STATUS_MAP.OPEN,
        remaining: { $gt: 0 },
      });

      await cleanApporders({
        orders: deadOrders,
        reason: 'owner dependant apporder',
      });
    }
  } catch (e) {
    logger.warn('cleanTransferredAppOrders()', e);
    throw e;
  }
};

const _cleanTransferredDatasetOrders = async ({
  address = throwIfMissing(),
  dataset = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const datasetContract = getDataset(dataset);
    const owner = await callAtBlock(
      datasetContract.owner.staticCallResult,
      [],
      blockNumber,
    );
    if (owner !== address) {
      const DatasetorderModel = await datasetorderModel.getModel(chainId);
      const deadOrders = await DatasetorderModel.find({
        'order.dataset': dataset,
        signer: address,
        status: STATUS_MAP.OPEN,
        remaining: { $gt: 0 },
      });
      await cleanDatasetorders({
        orders: deadOrders,
        reason: 'owner dependant datasetorder',
      });
    }
  } catch (e) {
    logger.warn('cleanTransferredDatasetOrders()', e);
    throw e;
  }
};

const _cleanTransferredWorkerpoolOrders = async ({
  address = throwIfMissing(),
  workerpool = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const workerpoolContract = getWorkerpool(workerpool);
    const owner = await callAtBlock(
      workerpoolContract.owner.staticCallResult,
      [],
      blockNumber,
    );
    if (owner !== address) {
      const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
      const deadOrders = await WorkerpoolorderModel.find({
        'order.workerpool': workerpool,
        signer: address,
        status: STATUS_MAP.OPEN,
        remaining: { $gt: 0 },
      });

      await cleanWorkerpoolorders({
        orders: deadOrders,
        reason: 'owner dependant workerpoolorder',
      });
    }
  } catch (e) {
    logger.warn('cleanTransferredWorkerpoolOrders()', e);
    throw e;
  }
};

const _updateApporder = async ({
  orderHash = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const ApporderModel = await apporderModel.getModel(chainId);
    const publishedOrder = await ApporderModel.findOne({ orderHash });

    if (publishedOrder) {
      const hubContract = getHub();
      const consumedVolume = await callAtBlock(
        hubContract.viewConsumed.staticCallResult,
        [orderHash],
        blockNumber,
      );
      const volume = publishedOrder.order.volume - Number(consumedVolume);
      const remaining =
        publishedOrder.remaining !== undefined
          ? Math.min(volume, publishedOrder.remaining)
          : volume;
      if (remaining === publishedOrder.remaining) {
        return;
      }
      const update = { remaining };
      if (volume === 0) {
        update.status = STATUS_MAP.FILLED;
      }
      const saved = await ApporderModel.findOneAndUpdate(
        { orderHash },
        update,
        { returnOriginal: false },
      );
      if (saved && saved.status === STATUS_MAP.OPEN) {
        logger.debug('apporder updated', orderHash);
        eventEmitter.emit('apporder_updated', saved.toJSON());
      }
      if (saved && saved.status === STATUS_MAP.FILLED) {
        logger.debug('apporder filled', orderHash);
        eventEmitter.emit('apporder_filled', saved.toJSON());
      }
    }
  } catch (e) {
    logger.warn('updateApporder()', e);
    throw e;
  }
};

const _updateDatasetorder = async ({
  orderHash = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const DatasetorderModel = await datasetorderModel.getModel(chainId);
    const publishedOrder = await DatasetorderModel.findOne({ orderHash });

    if (publishedOrder) {
      const hubContract = getHub();
      const consumedVolume = await callAtBlock(
        hubContract.viewConsumed.staticCallResult,
        [orderHash],
        blockNumber,
      );
      const volume = publishedOrder.order.volume - Number(consumedVolume);
      const remaining =
        publishedOrder.remaining !== undefined
          ? Math.min(volume, publishedOrder.remaining)
          : volume;
      if (remaining === publishedOrder.remaining) {
        return;
      }
      const update = { remaining };
      if (volume === 0) {
        update.status = STATUS_MAP.FILLED;
      }
      const saved = await DatasetorderModel.findOneAndUpdate(
        { orderHash },
        update,
        { returnOriginal: false },
      );
      if (saved && saved.status === STATUS_MAP.OPEN) {
        logger.debug('datasetorder updated', orderHash);
        eventEmitter.emit('datasetorder_updated', saved.toJSON());
      }
      if (saved && saved.status === STATUS_MAP.FILLED) {
        logger.debug('datasetorder filled', orderHash);
        eventEmitter.emit('datasetorder_filled', saved.toJSON());
      }
    }
  } catch (e) {
    logger.warn('updateDatasetorder()', e);
    throw e;
  }
};

const _updateWorkerpoolorder = async ({
  orderHash = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const publishedOrder = await WorkerpoolorderModel.findOne({ orderHash });

    if (publishedOrder) {
      const hubContract = getHub();
      const consumedVolume = await callAtBlock(
        hubContract.viewConsumed.staticCallResult,
        [orderHash],
        blockNumber,
      );
      const volume = publishedOrder.order.volume - Number(consumedVolume);
      const remaining =
        publishedOrder.remaining !== undefined
          ? Math.min(volume, publishedOrder.remaining)
          : volume;
      if (remaining === publishedOrder.remaining) {
        return;
      }
      const update = { remaining };
      if (volume === 0) {
        update.status = STATUS_MAP.FILLED;
      }
      const saved = await WorkerpoolorderModel.findOneAndUpdate(
        { orderHash },
        update,
        { returnOriginal: false },
      );
      if (saved && saved.status === STATUS_MAP.OPEN) {
        logger.debug('workerpoolorder updated', orderHash);
        eventEmitter.emit('workerpoolorder_updated', saved.toJSON());
      }
      if (saved && saved.status === STATUS_MAP.FILLED) {
        logger.debug('workerpoolorder filled', orderHash);
        eventEmitter.emit('workerpoolorder_filled', saved.toJSON());
      }
    }
  } catch (e) {
    logger.warn('updateWorkerpoolorder()', e);
    throw e;
  }
};

const _updateRequestorder = async ({
  orderHash = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const publishedOrder = await RequestorderModel.findOne({ orderHash });

    if (publishedOrder) {
      const hubContract = getHub();
      const consumedVolume = await callAtBlock(
        hubContract.viewConsumed.staticCallResult,
        [orderHash],
        blockNumber,
      );
      const volume = publishedOrder.order.volume - Number(consumedVolume);
      const remaining =
        publishedOrder.remaining !== undefined
          ? Math.min(volume, publishedOrder.remaining)
          : volume;
      if (remaining === publishedOrder.remaining) {
        return;
      }
      const update = { remaining };
      if (volume === 0) {
        update.status = STATUS_MAP.FILLED;
      }
      const saved = await RequestorderModel.findOneAndUpdate(
        { orderHash },
        update,
        { returnOriginal: false },
      );
      if (saved && saved.status === STATUS_MAP.OPEN) {
        logger.debug('requestorder updated', orderHash);
        eventEmitter.emit('requestorder_updated', saved.toJSON());
      }
      if (saved && saved.status === STATUS_MAP.FILLED) {
        logger.debug('requestorder filled', orderHash);
        eventEmitter.emit('requestorder_filled', saved.toJSON());
      }
    }
  } catch (e) {
    logger.warn('updateRequestorder()', e);
    throw e;
  }
};

const _cancelApporder = async ({ orderHash = throwIfMissing() } = {}) => {
  try {
    const ApporderModel = await apporderModel.getModel(chainId);
    const published = await ApporderModel.findOneAndUpdate(
      {
        orderHash,
      },
      {
        remaining: 0,
        status: STATUS_MAP.CANCELED,
      },
      { returnOriginal: true, upsert: false },
    );
    if (published && published.status === STATUS_MAP.OPEN) {
      logger.debug('apporder canceled', orderHash);
      eventEmitter.emit('apporder_canceled', published.toJSON());
    }
  } catch (e) {
    logger.warn('cancelApporder() error', e);
    throw e;
  }
};

const _cancelDatasetorder = async ({ orderHash = throwIfMissing() } = {}) => {
  try {
    const DatasetorderModel = await datasetorderModel.getModel(chainId);
    const published = await DatasetorderModel.findOneAndUpdate(
      {
        orderHash,
      },
      {
        remaining: 0,
        status: STATUS_MAP.CANCELED,
      },
      { returnOriginal: true, upsert: false },
    );
    if (published && published.status === STATUS_MAP.OPEN) {
      logger.debug('datasetorder canceled', orderHash);
      eventEmitter.emit('datasetorder_canceled', published.toJSON());
    }
  } catch (e) {
    logger.warn('cancelDatasetorder() error', e);
    throw e;
  }
};

const _cancelWorkerpoolorder = async ({
  orderHash = throwIfMissing(),
} = {}) => {
  try {
    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const published = await WorkerpoolorderModel.findOneAndUpdate(
      {
        orderHash,
      },
      {
        remaining: 0,
        status: STATUS_MAP.CANCELED,
      },
      { returnOriginal: true, upsert: false },
    );
    if (published && published.status === STATUS_MAP.OPEN) {
      logger.debug('workerpoolorder canceled', orderHash);
      eventEmitter.emit('workerpoolorder_canceled', published.toJSON());
    }
  } catch (e) {
    logger.warn('cancelWorkerpoolorder() error', e);
    throw e;
  }
};

const _cancelRequestorder = async ({ orderHash = throwIfMissing() } = {}) => {
  try {
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const published = await RequestorderModel.findOneAndUpdate(
      {
        orderHash,
      },
      {
        remaining: 0,
        status: STATUS_MAP.CANCELED,
      },
      { returnOriginal: true, upsert: false },
    );
    if (published && published.status === STATUS_MAP.OPEN) {
      logger.debug('requestorder canceled', orderHash);
      eventEmitter.emit('requestorder_canceled', published.toJSON());
    }
  } catch (e) {
    logger.warn('cancelRequestorder() error', e);
    throw e;
  }
};

const cleanApporderDependantOrders = traceAll(_cleanApporderDependantOrders, {
  logger,
});
const cleanDatasetorderDependantOrders = traceAll(
  _cleanDatasetorderDependantOrders,
  {
    logger,
  },
);
const cleanBalanceDependantOrders = traceAll(_cleanBalanceDependantOrders, {
  logger,
});
const cleanTransferredAppOrders = traceAll(_cleanTransferredAppOrders, {
  logger,
});
const cleanTransferredDatasetOrders = traceAll(_cleanTransferredDatasetOrders, {
  logger,
});
const cleanTransferredWorkerpoolOrders = traceAll(
  _cleanTransferredWorkerpoolOrders,
  {
    logger,
  },
);
const updateApporder = traceAll(_updateApporder, { logger });
const updateDatasetorder = traceAll(_updateDatasetorder, { logger });
const updateWorkerpoolorder = traceAll(_updateWorkerpoolorder, { logger });
const updateRequestorder = traceAll(_updateRequestorder, { logger });
const cancelApporder = traceAll(_cancelApporder, { logger });
const cancelDatasetorder = traceAll(_cancelDatasetorder, { logger });
const cancelWorkerpoolorder = traceAll(_cancelWorkerpoolorder, { logger });
const cancelRequestorder = traceAll(_cancelRequestorder, { logger });

export {
  cleanApporderDependantOrders,
  cleanDatasetorderDependantOrders,
  cleanBalanceDependantOrders,
  cleanTransferredAppOrders,
  cleanTransferredDatasetOrders,
  cleanTransferredWorkerpoolOrders,
  updateApporder,
  updateDatasetorder,
  updateWorkerpoolorder,
  updateRequestorder,
  cancelApporder,
  cancelDatasetorder,
  cancelWorkerpoolorder,
  cancelRequestorder,
};
