const BN = require('bn.js');
const config = require('../config');
const { eventEmitter } = require('../loaders/eventEmitter');
const {
  getProvider,
  getHub,
  getERlc,
  getAppRegistry,
  getDatasetRegistry,
  getWorkerpoolRegistry,
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
const {
  callAtBlock,
  cleanRPC,
  getBlockNumber,
  NULL_ADDRESS,
} = require('../utils/eth-utils');
const { tokenIdToAddress, KYC_MEMBER_ROLE } = require('../utils/iexec-utils');

const { chainId } = config.chain;

const log = logger.extend('services:order');

log('instantiating service');

const cleanApporders = async ({
  orders = throwIfMissing(),
  reason = throwIfMissing(),
}) => {
  const ApporderModel = await apporderModel.getModel(chainId);
  const cleanedOrders = await Promise.all(
    orders.map(async (e) => {
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
    .filter((e) => !!e)
    .map((e) => e.toJSON())
    .forEach((e) => {
      log('apporder cleaned', e.orderHash, reason);
      eventEmitter.emit('apporder_cleaned', e);
    });
};

const cleanDatasetorders = async ({
  orders = throwIfMissing(),
  reason = throwIfMissing(),
}) => {
  const DatasetorderModel = await datasetorderModel.getModel(chainId);
  const cleanedOrders = await Promise.all(
    orders.map(async (e) => {
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
    .filter((e) => !!e)
    .map((e) => e.toJSON())
    .forEach((e) => {
      log('datasetorder cleaned', e.orderHash, reason);
      eventEmitter.emit('datasetorder_cleaned', e);
    });
};

const cleanWorkerpoolorders = async ({
  orders = throwIfMissing(),
  reason = throwIfMissing(),
}) => {
  const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
  const cleanedOrders = await Promise.all(
    orders.map(async (e) => {
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
    .filter((e) => !!e)
    .map((e) => e.toJSON())
    .forEach((e) => {
      log('workerpoolorder cleaned', e.orderHash, reason);
      eventEmitter.emit('workerpoolorder_cleaned', e);
    });
};

const cleanRequestorders = async ({
  orders = throwIfMissing(),
  reason = throwIfMissing(),
}) => {
  const RequestorderModel = await requestorderModel.getModel(chainId);
  const cleanedOrders = await Promise.all(
    orders.map(async (e) => {
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
    .filter((e) => !!e)
    .map((e) => e.toJSON())
    .forEach((e) => {
      log('requestorder cleaned', e.orderHash, reason);
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
      return workerpoolorders.filter((e) =>
        userStake.lt(
          new BN(e.order.workerpoolprice)
            .mul(new BN(30))
            .div(new BN(100))
            .mul(new BN(e.remaining)),
        ),
      );
    };
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const getDeadRequestOrders = async () => {
      const requestorders = await RequestorderModel.find({
        signer: address,
        status: STATUS_MAP.OPEN,
        remaining: { $gt: 0 },
      });
      return requestorders.filter((e) =>
        userStake.lt(
          new BN(e.order.appmaxprice)
            .add(
              new BN(e.order.datasetmaxprice).add(
                new BN(e.order.workerpoolmaxprice),
              ),
            )
            .mul(new BN(e.remaining)),
        ),
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
    log('cleanBalanceDependantOrders()', e);
    throw e;
  }
};

const cleanTransferredAppOrders = async ({
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

      await cleanApporders({
        orders: deadOrders,
        reason: 'owner dependant apporder',
      });
    }
  } catch (e) {
    log('cleanTransferredAppOrders()', e);
    throw e;
  }
};

const cleanTransferredDatasetOrders = async ({
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
      await cleanDatasetorders({
        orders: deadOrders,
        reason: 'owner dependant datasetorder',
      });
    }
  } catch (e) {
    log('cleanTransferredDatasetOrders()', e);
    throw e;
  }
};

const cleanTransferredWorkerpoolOrders = async ({
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

      await cleanWorkerpoolorders({
        orders: deadOrders,
        reason: 'owner dependant workerpoolorder',
      });
    }
  } catch (e) {
    log('cleanTransferredWorkerpoolOrders()', e);
    throw e;
  }
};

const cleanRevokedUserOrders = async ({
  address = throwIfMissing(),
  role = throwIfMissing(),
  blockNumber,
}) => {
  if (role !== KYC_MEMBER_ROLE) {
    log(`user ${address} revoked role is not KYC`);
    return;
  }
  // check user  isKYC
  const eRlcContract = getERlc();
  const isKYC = await callAtBlock(
    eRlcContract.functions.isKYC,
    [address],
    blockNumber,
  );
  if (isKYC) {
    log(`user ${address} is KYC`);
    return;
  }
  log(`user ${address} KYC revoked`);

  // fix block height to prevent the risk of moving indexes in registries
  const blockNumberOverride =
    blockNumber || (await getBlockNumber(getProvider()));
  const ApporderModel = await apporderModel.getModel(chainId);
  const DatasetorderModel = await datasetorderModel.getModel(chainId);
  const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
  const RequestorderModel = await requestorderModel.getModel(chainId);

  // clean orders signed by user
  const [
    userApporders,
    userDatasetorders,
    userWorkerpoolorders,
    userRequestorders,
  ] = await Promise.all([
    ApporderModel.find({
      signer: address,
      status: STATUS_MAP.OPEN,
      remaining: { $gt: 0 },
    }),
    DatasetorderModel.find({
      signer: address,
      status: STATUS_MAP.OPEN,
      remaining: { $gt: 0 },
    }),
    WorkerpoolorderModel.find({
      signer: address,
      status: STATUS_MAP.OPEN,
      remaining: { $gt: 0 },
    }),
    RequestorderModel.find({
      signer: address,
      status: STATUS_MAP.OPEN,
      remaining: { $gt: 0 },
    }),
  ]);

  await Promise.all([
    cleanApporders({ orders: userApporders, reason: 'signer KYC revoked' }),
    cleanDatasetorders({
      orders: userDatasetorders,
      reason: 'signer KYC revoked',
    }),
    cleanWorkerpoolorders({
      orders: userWorkerpoolorders,
      reason: 'signer KYC revoked',
    }),
    cleanRequestorders({
      orders: userRequestorders,
      reason: 'signer KYC revoked',
    }),
  ]);

  // list user apps
  const appRegistryContract = getAppRegistry();
  const appsCount = await callAtBlock(
    appRegistryContract.functions.balanceOf,
    [address],
    blockNumberOverride,
  );
  const deadApps = await Promise.all(
    new Array(Number(appsCount))
      .fill(null)
      .map(async (e, i) => {
        // protect from fork, index may be out of bound and cause VM execution error
        try {
          const resourceId = await callAtBlock(
            appRegistryContract.functions.tokenOfOwnerByIndex,
            [address, i],
            blockNumberOverride,
          );
          const resourceAddress = tokenIdToAddress(resourceId);
          return resourceAddress;
        } catch (err) {
          log(
            `failed to get app ${i} for owner ${address}${
              blockNumberOverride && ` at block ${blockNumberOverride}`
            } : ${err}`,
          );
          return null;
        }
      })
      .filter((e) => e !== null),
  );
  log('deadApps (owner KYC revoked)', deadApps);
  // list orders depending on user apps
  const [
    userAppDependantDatasetorders,
    userAppDependantWorkerpoolorders,
    userAppDependantRequestorders,
  ] = await Promise.all([
    Promise.all(
      deadApps.map(async (app) => {
        const dependantOrders = await DatasetorderModel.find({
          'order.apprestrict': app,
          status: STATUS_MAP.OPEN,
          remaining: { $gt: 0 },
        });
        return dependantOrders;
      }),
    ).then((res) => res.reduce((acc, curr) => [...acc, ...curr], [])),
    Promise.all(
      deadApps.map(async (app) => {
        const dependantOrders = await WorkerpoolorderModel.find({
          'order.apprestrict': app,
          status: STATUS_MAP.OPEN,
          remaining: { $gt: 0 },
        });
        return dependantOrders;
      }),
    ).then((res) => res.reduce((acc, curr) => [...acc, ...curr], [])),
    Promise.all(
      deadApps.map(async (app) => {
        const dependantOrders = await RequestorderModel.find({
          'order.app': app,
          status: STATUS_MAP.OPEN,
          remaining: { $gt: 0 },
        });
        return dependantOrders;
      }),
    ).then((res) => res.reduce((acc, curr) => [...acc, ...curr], [])),
  ]);

  await Promise.all([
    cleanDatasetorders({
      orders: userAppDependantDatasetorders,
      reason: 'KYC revoked app owner dependant',
    }),
    cleanWorkerpoolorders({
      orders: userAppDependantWorkerpoolorders,
      reason: 'KYC revoked app owner dependant',
    }),
    cleanRequestorders({
      orders: userAppDependantRequestorders,
      reason: 'KYC revoked app owner dependant',
    }),
  ]);

  // list user datasets
  const datasetRegistryContract = getDatasetRegistry();
  const datasetsCount = await callAtBlock(
    datasetRegistryContract.functions.balanceOf,
    [address],
    blockNumberOverride,
  );
  const deadDatasets = await Promise.all(
    new Array(Number(datasetsCount))
      .fill(null)
      .map(async (e, i) => {
        // protect from fork, index may be out of bound and cause VM execution error
        try {
          const resourceId = await callAtBlock(
            datasetRegistryContract.functions.tokenOfOwnerByIndex,
            [address, i],
            blockNumberOverride,
          );
          const resourceAddress = tokenIdToAddress(resourceId);
          return resourceAddress;
        } catch (err) {
          log(
            `failed to get dataset ${i} for owner ${address}${
              blockNumberOverride && ` at block ${blockNumberOverride}`
            } : ${err}`,
          );
          return null;
        }
      })
      .filter((e) => e !== null),
  );
  log('deadDatasets (owner KYC revoked)', deadDatasets);
  // list orders depending on user datasets
  const [
    userDatasetDependantApporders,
    userDatasetDependantWorkerpoolorders,
    userDatasetDependantRequestorders,
  ] = await Promise.all([
    Promise.all(
      deadDatasets.map(async (dataset) => {
        const dependantOrders = await ApporderModel.find({
          'order.datasetrestrict': dataset,
          status: STATUS_MAP.OPEN,
          remaining: { $gt: 0 },
        });
        return dependantOrders;
      }),
    ).then((res) => res.reduce((acc, curr) => [...acc, ...curr], [])),
    Promise.all(
      deadDatasets.map(async (dataset) => {
        const dependantOrders = await WorkerpoolorderModel.find({
          'order.datasetrestrict': dataset,
          status: STATUS_MAP.OPEN,
          remaining: { $gt: 0 },
        });
        return dependantOrders;
      }),
    ).then((res) => res.reduce((acc, curr) => [...acc, ...curr], [])),
    Promise.all(
      deadDatasets.map(async (dataset) => {
        const dependantOrders = await RequestorderModel.find({
          'order.dataset': dataset,
          status: STATUS_MAP.OPEN,
          remaining: { $gt: 0 },
        });
        return dependantOrders;
      }),
    ).then((res) => res.reduce((acc, curr) => [...acc, ...curr], [])),
  ]);

  await Promise.all([
    cleanApporders({
      orders: userDatasetDependantApporders,
      reason: 'KYC revoked dataset owner dependant',
    }),
    cleanWorkerpoolorders({
      orders: userDatasetDependantWorkerpoolorders,
      reason: 'KYC revoked dataset owner dependant',
    }),
    cleanRequestorders({
      orders: userDatasetDependantRequestorders,
      reason: 'KYC revoked dataset owner dependant',
    }),
  ]);

  // list user workerpools
  const workerpoolRegistryContract = getWorkerpoolRegistry();
  const workerpoolsCount = await callAtBlock(
    workerpoolRegistryContract.functions.balanceOf,
    [address],
    blockNumberOverride,
  );
  const deadWorkerpools = await Promise.all(
    new Array(Number(workerpoolsCount))
      .fill(null)
      .map(async (e, i) => {
        // protect from fork, index may be out of bound and cause VM execution error
        try {
          const resourceId = await callAtBlock(
            workerpoolRegistryContract.functions.tokenOfOwnerByIndex,
            [address, i],
            blockNumberOverride,
          );
          const resourceAddress = tokenIdToAddress(resourceId);
          return resourceAddress;
        } catch (err) {
          log(
            `failed to get workerpool ${i} for owner ${address}${
              blockNumberOverride && ` at block ${blockNumberOverride}`
            } : ${err}`,
          );
          return null;
        }
      })
      .filter((e) => e !== null),
  );
  log('deadWorkerpools (owner KYC revoked)', deadWorkerpools);
  // list orders depending on user workerpools
  const [
    userWorkerpoolDependantApporders,
    userWorkerpoolDependantDatasetorders,
    userWorkerpoolDependantRequestorders,
  ] = await Promise.all([
    Promise.all(
      deadWorkerpools.map(async (workerpool) => {
        const dependantOrders = await ApporderModel.find({
          'order.workerpoolrestrict': workerpool,
          status: STATUS_MAP.OPEN,
          remaining: { $gt: 0 },
        });
        return dependantOrders;
      }),
    ).then((res) => res.reduce((acc, curr) => [...acc, ...curr], [])),
    Promise.all(
      deadWorkerpools.map(async (workerpool) => {
        const dependantOrders = await DatasetorderModel.find({
          'order.workerpoolrestrict': workerpool,
          status: STATUS_MAP.OPEN,
          remaining: { $gt: 0 },
        });
        return dependantOrders;
      }),
    ).then((res) => res.reduce((acc, curr) => [...acc, ...curr], [])),
    Promise.all(
      deadWorkerpools.map(async (workerpool) => {
        const dependantOrders = await RequestorderModel.find({
          'order.workerpool': workerpool,
          status: STATUS_MAP.OPEN,
          remaining: { $gt: 0 },
        });
        return dependantOrders;
      }),
    ).then((res) => res.reduce((acc, curr) => [...acc, ...curr], [])),
  ]);

  await Promise.all([
    cleanApporders({
      orders: userWorkerpoolDependantApporders,
      reason: 'KYC revoked workerpool owner dependant',
    }),
    cleanDatasetorders({
      orders: userWorkerpoolDependantDatasetorders,
      reason: 'KYC revoked workerpool owner dependant',
    }),
    cleanRequestorders({
      orders: userWorkerpoolDependantRequestorders,
      reason: 'KYC revoked workerpool owner dependant',
    }),
  ]);
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
      const remaining =
        publishedOrder.remaining !== undefined
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
      const remaining =
        publishedOrder.remaining !== undefined
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
      const remaining =
        publishedOrder.remaining !== undefined
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
      const remaining =
        publishedOrder.remaining !== undefined
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
  cleanTransferredAppOrders,
  cleanTransferredDatasetOrders,
  cleanTransferredWorkerpoolOrders,
  cleanRevokedUserOrders,
  updateApporder,
  updateDatasetorder,
  updateWorkerpoolorder,
  updateRequestorder,
  cancelApporder,
  cancelDatasetorder,
  cancelWorkerpoolorder,
  cancelRequestorder,
};
