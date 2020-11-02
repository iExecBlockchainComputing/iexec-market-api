const BN = require('bn.js');
const config = require('../config');
const { eventEmitter } = require('../loaders/eventEmitter');
const {
  getHub,
  getApp,
  getDataset,
  getWorkerpool,
} = require('../loaders/ethereum');
const apporderModel = require('../models/apporderModel');
const datasetorderModel = require('../models/datasetorderModel');
const workerpoolorderModel = require('../models/workerpoolorderModel');
const requestorderModel = require('../models/requestorderModel');
const { logger } = require('../utils/logger');
const { throwIfMissing } = require('../utils/error');
const { STATUS_MAP, TAG_MAP, tagToArray } = require('../utils/order-utils');
const { callAtBlock, cleanRPC, NULL_ADDRESS } = require('../utils/eth-utils');

const { chainId } = config.chain;

const log = logger.extend('services:order');

log('instanciating service');

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
  const bestAppPrice = new BN(bestApporder.order.appprice);
  const appPrice = new BN(order.appmaxprice);
  if (appPrice.lt(bestAppPrice)) {
    return false;
  }
  return true;
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
  const bestDatasetPrice = new BN(bestDatasetorder.order.datasetprice);
  const datasetPrice = new BN(order.datasetmaxprice);
  if (datasetPrice.lt(bestDatasetPrice)) {
    return false;
  }
  return true;
};

const cleanApporderDependantOrders = async ({
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
      apporder.order.tag
      && tagToArray(apporder.order.tag).includes(TAG_MAP.tee)
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
      toCheckOrders.map(requestorder => checkMatchableApporder({ order: requestorder.order })),
    ).then(matchResults => toCheckOrders.filter((requestorder, index) => !matchResults[index]));

    const cleanedOrders = await Promise.all(
      dependantOrders.map(async (e) => {
        const updated = await RequestorderModel.findOneAndUpdate(
          { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
          {
            status: STATUS_MAP.DEAD,
          },
          { returnOriginal: false },
        );
        return updated;
      }),
    );
    cleanedOrders
      .filter(e => !!e)
      .map(e => e.toJSON())
      .forEach((e) => {
        log('apporder dependant requestorder cleaned', e.orderHash);
        eventEmitter.emit('requestorder_cleaned', e);
      });
  } catch (e) {
    log('cleanApporderDependantOrders() error', e);
    throw e;
  }
};

const cleanDatasetorderDependantOrders = async ({
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
      toCheckOrders.map(requestorder => checkMatchableDatasetorder({ order: requestorder.order })),
    ).then(matchResults => toCheckOrders.filter((requestorder, index) => !matchResults[index]));

    const cleanedOrders = await Promise.all(
      dependantOrders.map(async (e) => {
        const updated = await RequestorderModel.findOneAndUpdate(
          { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
          {
            status: STATUS_MAP.DEAD,
          },
          { returnOriginal: false },
        );
        return updated;
      }),
    );
    cleanedOrders
      .filter(e => !!e)
      .map(e => e.toJSON())
      .forEach((e) => {
        log('datasetorder dependant requestorder cleaned', e.orderHash);
        eventEmitter.emit('requestorder_cleaned', e);
      });
  } catch (e) {
    log('cleanDatasetorderDependantOrders() error', e);
    throw e;
  }
};

const cleanBalanceDependantOrders = async ({
  address = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const hubContract = getHub();
    const { stake } = cleanRPC(
      await callAtBlock(
        hubContract.functions.viewAccount,
        [address],
        blockNumber,
      ),
    );
    // todo run in parallel
    const userStake = new BN(stake);
    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const getDeadWorkerpoolOrders = async () => {
      const workerpoolorders = await WorkerpoolorderModel.find({
        signer: address,
        status: STATUS_MAP.OPEN,
        'order.workerpoolprice': { $gt: 0 },
        remaining: { $gt: 0 },
      });
      return workerpoolorders.filter(e => userStake.lt(
        new BN(e.order.workerpoolprice)
          .mul(new BN(30))
          .div(new BN(100))
          .mul(new BN(e.remaining)),
      ));
    };
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const getDeadRequestOrders = async () => {
      const requestorders = await RequestorderModel.find({
        signer: address,
        status: STATUS_MAP.OPEN,
        remaining: { $gt: 0 },
      });
      return requestorders.filter(e => userStake.lt(
        new BN(e.order.appmaxprice)
          .add(
            new BN(e.order.datasetmaxprice).add(
              new BN(e.order.workerpoolmaxprice),
            ),
          )
          .mul(new BN(e.remaining)),
      ));
    };
    const [deadRequestOrders, deadWorkerpoolOrders] = await Promise.all([
      getDeadRequestOrders(),
      getDeadWorkerpoolOrders(),
    ]);

    const cleanedRequestOrders = await Promise.all(
      deadRequestOrders.map(async (e) => {
        const updated = await RequestorderModel.findOneAndUpdate(
          { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
          {
            status: STATUS_MAP.DEAD,
          },
          { returnOriginal: false },
        );
        return updated;
      }),
    );
    cleanedRequestOrders
      .filter(e => !!e)
      .map(e => e.toJSON())
      .forEach((e) => {
        log('balance dependant requestorder cleaned', e.orderHash);
        eventEmitter.emit('requestorder_cleaned', e);
      });
    const cleanedWorkerpoolOrders = await Promise.all(
      deadWorkerpoolOrders.map(async (e) => {
        const updated = await WorkerpoolorderModel.findOneAndUpdate(
          { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
          {
            status: STATUS_MAP.DEAD,
          },
          { returnOriginal: false },
        );
        return updated;
      }),
    );
    cleanedWorkerpoolOrders
      .filter(e => !!e)
      .map(e => e.toJSON())
      .forEach((e) => {
        log('balance dependant workerpoolorder cleaned', e.orderHash);
        eventEmitter.emit('workerpoolorder_cleaned', e);
      });
  } catch (e) {
    log('cleanBalanceDependantOrders()', e);
    throw e;
  }
};

const cleanTransferedAppOrders = async ({
  address = throwIfMissing(),
  app = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const appContract = getApp(app);
    const owner = await callAtBlock(
      appContract.functions.owner,
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
      const cleanedOrders = await Promise.all(
        deadOrders.map(async (e) => {
          const updated = await ApporderModel.findOneAndUpdate(
            { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
            {
              status: STATUS_MAP.DEAD,
            },
            { returnOriginal: false },
          );
          return updated;
        }),
      );
      cleanedOrders
        .filter(e => !!e)
        .map(e => e.toJSON())
        .forEach((e) => {
          log('owner dependant apporder cleaned', e.orderHash);
          eventEmitter.emit('apporder_cleaned', e);
        });
    }
  } catch (e) {
    log('cleanTransferedAppOrders()', e);
    throw e;
  }
};

const cleanTransferedDatasetOrders = async ({
  address = throwIfMissing(),
  dataset = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const datasetContract = getDataset(dataset);
    const owner = await callAtBlock(
      datasetContract.functions.owner,
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
      const cleanedOrders = await Promise.all(
        deadOrders.map(async (e) => {
          const updated = await DatasetorderModel.findOneAndUpdate(
            { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
            {
              status: STATUS_MAP.DEAD,
            },
            { returnOriginal: false },
          );
          return updated;
        }),
      );
      cleanedOrders
        .filter(e => !!e)
        .map(e => e.toJSON())
        .forEach((e) => {
          log('owner dependant datasetorder cleaned', e.orderHash);
          eventEmitter.emit('datasetorder_cleaned', e);
        });
    }
  } catch (e) {
    log('cleanTransferedDatasetOrders()', e);
    throw e;
  }
};

const cleanTransferedWorkerpoolOrders = async ({
  address = throwIfMissing(),
  workerpool = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const workerpoolContract = getWorkerpool(workerpool);
    const owner = await callAtBlock(
      workerpoolContract.functions.owner,
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
      const cleanedOrders = await Promise.all(
        deadOrders.map(async (e) => {
          const updated = await WorkerpoolorderModel.findOneAndUpdate(
            { orderHash: e.orderHash, status: STATUS_MAP.OPEN },
            {
              status: STATUS_MAP.DEAD,
            },
            { returnOriginal: false },
          );
          return updated;
        }),
      );
      cleanedOrders
        .filter(e => !!e)
        .map(e => e.toJSON())
        .forEach((e) => {
          log('owner dependant workerpoolorder cleaned', e.orderHash);
          eventEmitter.emit('workerpoolorder_cleaned', e);
        });
    }
  } catch (e) {
    log('cleanTransferedWorkerpoolOrders()', e);
    throw e;
  }
};

const updateApporder = async ({
  orderHash = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const ApporderModel = await apporderModel.getModel(chainId);
    const publishedOrder = await ApporderModel.findOne({ orderHash });

    if (publishedOrder) {
      const hubContract = getHub();
      const consumedVolume = new BN(
        await callAtBlock(
          hubContract.functions.viewConsumed,
          [orderHash],
          blockNumber,
        ),
      );
      const volume = new BN(publishedOrder.order.volume).sub(consumedVolume);
      const remaining = publishedOrder.remaining !== undefined
        ? Math.min(volume.toNumber(), publishedOrder.remaining)
        : volume.toNumber();
      if (remaining === publishedOrder.remaining) {
        return;
      }
      const update = { remaining };
      if (volume.isZero()) {
        update.status = STATUS_MAP.FILLED;
      }
      const saved = await ApporderModel.findOneAndUpdate(
        { orderHash },
        update,
        { returnOriginal: false },
      );
      if (saved && saved.status === STATUS_MAP.OPEN) {
        log('apporder updated', orderHash);
        eventEmitter.emit('apporder_updated', saved.toJSON());
      }
      if (saved && saved.status === STATUS_MAP.FILLED) {
        log('apporder filled', orderHash);
        eventEmitter.emit('apporder_filled', saved.toJSON());
      }
    }
  } catch (e) {
    log('updateApporder()', e);
    throw e;
  }
};

const updateDatasetorder = async ({
  orderHash = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const DatasetorderModel = await datasetorderModel.getModel(chainId);
    const publishedOrder = await DatasetorderModel.findOne({ orderHash });

    if (publishedOrder) {
      const hubContract = getHub();
      const consumedVolume = new BN(
        await callAtBlock(
          hubContract.functions.viewConsumed,
          [orderHash],
          blockNumber,
        ),
      );
      const volume = new BN(publishedOrder.order.volume).sub(consumedVolume);
      const remaining = publishedOrder.remaining !== undefined
        ? Math.min(volume.toNumber(), publishedOrder.remaining)
        : volume.toNumber();
      if (remaining === publishedOrder.remaining) {
        return;
      }
      const update = { remaining };
      if (volume.isZero()) {
        update.status = STATUS_MAP.FILLED;
      }
      const saved = await DatasetorderModel.findOneAndUpdate(
        { orderHash },
        update,
        { returnOriginal: false },
      );
      if (saved && saved.status === STATUS_MAP.OPEN) {
        log('datasetorder updated', orderHash);
        eventEmitter.emit('datasetorder_updated', saved.toJSON());
      }
      if (saved && saved.status === STATUS_MAP.FILLED) {
        log('datasetorder filled', orderHash);
        eventEmitter.emit('datasetorder_filled', saved.toJSON());
      }
    }
  } catch (e) {
    log('updateDatasetorder()', e);
    throw e;
  }
};

const updateWorkerpoolorder = async ({
  orderHash = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const publishedOrder = await WorkerpoolorderModel.findOne({ orderHash });

    if (publishedOrder) {
      const hubContract = getHub();
      const consumedVolume = new BN(
        await callAtBlock(
          hubContract.functions.viewConsumed,
          [orderHash],
          blockNumber,
        ),
      );
      const volume = new BN(publishedOrder.order.volume).sub(consumedVolume);
      const remaining = publishedOrder.remaining !== undefined
        ? Math.min(volume.toNumber(), publishedOrder.remaining)
        : volume.toNumber();
      if (remaining === publishedOrder.remaining) {
        return;
      }
      const update = { remaining };
      if (volume.isZero()) {
        update.status = STATUS_MAP.FILLED;
      }
      const saved = await WorkerpoolorderModel.findOneAndUpdate(
        { orderHash },
        update,
        { returnOriginal: false },
      );
      if (saved && saved.status === STATUS_MAP.OPEN) {
        log('workerpoolorder updated', orderHash);
        eventEmitter.emit('workerpoolorder_updated', saved.toJSON());
      }
      if (saved && saved.status === STATUS_MAP.FILLED) {
        log('workerpoolorder filled', orderHash);
        eventEmitter.emit('workerpoolorder_filled', saved.toJSON());
      }
    }
  } catch (e) {
    log('updateWorkerpoolorder()', e);
    throw e;
  }
};

const updateRequestorder = async ({
  orderHash = throwIfMissing(),
  blockNumber,
} = {}) => {
  try {
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const publishedOrder = await RequestorderModel.findOne({ orderHash });

    if (publishedOrder) {
      const hubContract = getHub();
      const consumedVolume = new BN(
        await callAtBlock(
          hubContract.functions.viewConsumed,
          [orderHash],
          blockNumber,
        ),
      );
      const volume = new BN(publishedOrder.order.volume).sub(consumedVolume);
      const remaining = publishedOrder.remaining !== undefined
        ? Math.min(volume.toNumber(), publishedOrder.remaining)
        : volume.toNumber();
      if (remaining === publishedOrder.remaining) {
        return;
      }
      const update = { remaining };
      if (volume.isZero()) {
        update.status = STATUS_MAP.FILLED;
      }
      const saved = await RequestorderModel.findOneAndUpdate(
        { orderHash },
        update,
        { returnOriginal: false },
      );
      if (saved && saved.status === STATUS_MAP.OPEN) {
        log('requestorder updated', orderHash);
        eventEmitter.emit('requestorder_updated', saved.toJSON());
      }
      if (saved && saved.status === STATUS_MAP.FILLED) {
        log('requestorder filled', orderHash);
        eventEmitter.emit('requestorder_filled', saved.toJSON());
      }
    }
  } catch (e) {
    log('updateRequestorder()', e);
    throw e;
  }
};

const cancelApporder = async ({ orderHash = throwIfMissing() } = {}) => {
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
      log('apporder canceled', orderHash);
      eventEmitter.emit('apporder_canceled', published.toJSON());
    }
  } catch (e) {
    log('cancelApporder() error', e);
    throw e;
  }
};

const cancelDatasetorder = async ({ orderHash = throwIfMissing() } = {}) => {
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
      log('datasetorder canceled', orderHash);
      eventEmitter.emit('datasetorder_canceled', published.toJSON());
    }
  } catch (e) {
    log('cancelDatasetorder() error', e);
    throw e;
  }
};

const cancelWorkerpoolorder = async ({ orderHash = throwIfMissing() } = {}) => {
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
      log('workerpoolorder canceled', orderHash);
      eventEmitter.emit('workerpoolorder_canceled', published.toJSON());
    }
  } catch (e) {
    log('cancelWorkerpoolorder() error', e);
    throw e;
  }
};

const cancelRequestorder = async ({ orderHash = throwIfMissing() } = {}) => {
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
      log('requestorder canceled', orderHash);
      eventEmitter.emit('requestorder_canceled', published.toJSON());
    }
  } catch (e) {
    log('cancelRequestorder() error', e);
    throw e;
  }
};

module.exports = {
  cleanApporderDependantOrders,
  cleanDatasetorderDependantOrders,
  cleanBalanceDependantOrders,
  cleanTransferedAppOrders,
  cleanTransferedDatasetOrders,
  cleanTransferedWorkerpoolOrders,
  updateApporder,
  updateDatasetorder,
  updateWorkerpoolorder,
  updateRequestorder,
  cancelApporder,
  cancelDatasetorder,
  cancelWorkerpoolorder,
  cancelRequestorder,
};
