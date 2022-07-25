const BN = require('bn.js');
const { eventEmitter } = require('../loaders/eventEmitter');
const apporderModel = require('../models/apporderModel');
const datasetorderModel = require('../models/datasetorderModel');
const workerpoolorderModel = require('../models/workerpoolorderModel');
const requestorderModel = require('../models/requestorderModel');
const { logger } = require('../utils/logger');
const {
  apporderSchema,
  signedApporderSchema,
  datasetorderSchema,
  signedDatasetorderSchema,
  workerpoolorderSchema,
  signedWorkerpoolorderSchema,
  requestorderSchema,
  signedRequestorderSchema,
} = require('../utils/validator');
const {
  AuthError,
  BusinessError,
  ObjectNotFoundError,
  InternalError,
  wrapEthCall,
  throwIfMissing,
} = require('../utils/error');
const {
  NULL_ADDRESS,
  NULL_BYTES32,
  getContract,
  ethersBnToBn,
} = require('../utils/eth-utils');
const { hashEIP712 } = require('../utils/sig-utils');
const {
  OBJ_MAP,
  STATUS_MAP,
  UNPUBLISH_TARGET_MAP,
  TAG_MAP,
  tagToArray,
  excludeTagArray,
} = require('../utils/order-utils');
const { isEnterpriseFlavour } = require('../utils/iexec-utils');
const { flavour, maxOpenOrdersPerWallet } = require('../config');

const PAGE_LENGHT = 20;

const log = logger.extend('services:order');

log('instanciating service');

const minTagClause = (minTag) =>
  minTag &&
  minTag !== NULL_BYTES32 && { tagArray: { $all: tagToArray(minTag) } };

const maxTagClause = (maxTag) =>
  maxTag && { tagArray: { $nin: excludeTagArray(tagToArray(maxTag)) } };

const tagClause = ({ minTag, maxTag }) => {
  if (!minTag && !maxTag) {
    return {};
  }
  const computedMaxTagClause = maxTagClause(maxTag);
  const computedMinTagClause = minTagClause(minTag);
  if (computedMaxTagClause && computedMinTagClause) {
    return {
      $and: [computedMaxTagClause, computedMinTagClause],
    };
  }
  if (computedMinTagClause) {
    return computedMinTagClause;
  }
  if (computedMaxTagClause) {
    return computedMaxTagClause;
  }
  return {};
};

const minVolumeClause = (minVolume) =>
  minVolume && { remaining: { $gte: minVolume } };

const minTrustClause = (minTrust) =>
  minTrust && minTrust > 1 && { 'order.trust': { $gte: minTrust } };

const maxTrustClause = (maxTrust) =>
  (maxTrust || maxTrust === 0) && { 'order.trust': { $lte: maxTrust } };

const fetchIExecDomain = async (iExecContract = throwIfMissing()) => {
  const { name, version, chainId, verifyingContract } = await wrapEthCall(
    iExecContract.domain(),
  );
  return { name, version, chainId, verifyingContract };
};

const fetchContractOwner = async ({
  chainId = throwIfMissing(),
  iExecContract = throwIfMissing(),
  deployedAddress = throwIfMissing(),
  registryName = throwIfMissing(),
  contractName = throwIfMissing(),
} = {}) => {
  const registryAddress = await wrapEthCall(iExecContract[registryName]());
  const registryContract = getContract(registryName, chainId, {
    at: registryAddress,
  });
  const isDeployed = await wrapEthCall(
    registryContract.isRegistered(deployedAddress),
  );
  if (!isDeployed) throw new BusinessError('Resource not deployed');
  const deployedContract = getContract(contractName, chainId, {
    at: deployedAddress,
  });
  const owner = await wrapEthCall(deployedContract.owner());
  return owner;
};

const checkAddressInWhitelist = async ({
  chainId = throwIfMissing(),
  iExecContract = throwIfMissing(),
  address = throwIfMissing(),
} = {}) => {
  const tokenAddress = await wrapEthCall(iExecContract.token());
  const tokenContract = getContract('erlc', chainId, { at: tokenAddress });
  const isWhitelisted = await wrapEthCall(tokenContract.isKYC(address));
  return isWhitelisted;
};

const checkSignerInWhitelist = async ({
  chainId = throwIfMissing(),
  iExecContract = throwIfMissing(),
  signer = throwIfMissing(),
} = {}) => {
  const isInWhitelist = await checkAddressInWhitelist({
    chainId,
    iExecContract,
    address: signer,
  });
  if (!isInWhitelist) {
    throw new BusinessError(`Order signer ${signer} is not authorized by eRLC`);
  }
};

const checkAppownerInWhitelist = async ({
  chainId = throwIfMissing(),
  iExecContract = throwIfMissing(),
  app = throwIfMissing(),
} = {}) => {
  if (app !== NULL_ADDRESS) {
    const appOwner = await fetchContractOwner({
      chainId,
      iExecContract,
      deployedAddress: app,
      registryName: OBJ_MAP.apporder.registryName,
      contractName: OBJ_MAP.apporder.contractName,
    });
    const isAppOwnerInWhitelist = await checkAddressInWhitelist({
      chainId,
      iExecContract,
      address: appOwner,
    });
    if (!isAppOwnerInWhitelist) {
      throw new BusinessError(
        `App owner ${appOwner} is not authorized by eRLC`,
      );
    }
  }
};

const checkDatasetownerInWhitelist = async ({
  chainId = throwIfMissing(),
  iExecContract = throwIfMissing(),
  dataset = throwIfMissing(),
} = {}) => {
  if (dataset !== NULL_ADDRESS) {
    const datasetOwner = await fetchContractOwner({
      chainId,
      iExecContract,
      deployedAddress: dataset,
      registryName: OBJ_MAP.datasetorder.registryName,
      contractName: OBJ_MAP.datasetorder.contractName,
    });
    const isDatasetOwnerInWhitelist = await checkAddressInWhitelist({
      chainId,
      iExecContract,
      address: datasetOwner,
    });
    if (!isDatasetOwnerInWhitelist) {
      throw new BusinessError(
        `Dataset owner ${datasetOwner} is not authorized by eRLC`,
      );
    }
  }
};

const checkWorkerpoolownerInWhitelist = async ({
  chainId = throwIfMissing(),
  iExecContract = throwIfMissing(),
  workerpool = throwIfMissing(),
} = {}) => {
  if (workerpool !== NULL_ADDRESS) {
    const workerpoolOwner = await fetchContractOwner({
      chainId,
      iExecContract,
      deployedAddress: workerpool,
      registryName: OBJ_MAP.workerpoolorder.registryName,
      contractName: OBJ_MAP.workerpoolorder.contractName,
    });
    const isWorkerpoolOwnerInWhitelist = await checkAddressInWhitelist({
      chainId,
      iExecContract,
      address: workerpoolOwner,
    });
    if (!isWorkerpoolOwnerInWhitelist) {
      throw new BusinessError(
        `Workerpool owner ${workerpoolOwner} is not authorized by eRLC`,
      );
    }
  }
};

const checkRequesterInWhitelist = async ({
  chainId = throwIfMissing(),
  iExecContract = throwIfMissing(),
  requester = throwIfMissing(),
} = {}) => {
  if (requester !== NULL_ADDRESS) {
    const isInWhitelist = await checkAddressInWhitelist({
      chainId,
      iExecContract,
      address: requester,
    });
    if (!isInWhitelist) {
      throw new BusinessError(
        `Requester ${requester} is not authorized by eRLC`,
      );
    }
  }
};

const checkMatchableApporder = async ({
  chainId = throwIfMissing(),
  order = throwIfMissing(),
  strict = false,
} = {}) => {
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
    if (strict) {
      throw new BusinessError(
        `No ${teeRequired ? 'tee enabled ' : ''}apporder published for app ${
          order.app
        }`,
      );
    }
    return false;
  }
  const bestAppPrice = new BN(bestApporder.order.appprice);
  const appPrice = new BN(order.appmaxprice);
  if (appPrice.lt(bestAppPrice)) {
    if (strict) {
      throw new BusinessError(
        `appmaxprice for app ${order.app} is too low, actual best price is ${bestAppPrice} nRLC`,
      );
    }
    return false;
  }
  return true;
};

const checkMatchableDatasetorder = async ({
  chainId = throwIfMissing(),
  order = throwIfMissing(),
  strict = false,
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
    if (strict) {
      throw new BusinessError(
        `No datasetorder published for dataset ${order.dataset}`,
      );
    }
    return false;
  }
  const bestDatasetPrice = new BN(bestDatasetorder.order.datasetprice);
  const datasetPrice = new BN(order.datasetmaxprice);
  if (datasetPrice.lt(bestDatasetPrice)) {
    if (strict) {
      throw new BusinessError(
        `datasetmaxprice for dataset ${order.dataset} is too low, actual best price is ${bestDatasetPrice} nRLC`,
      );
    }
    return false;
  }
  return true;
};

const cleanApporderDependantOrders = async ({
  chainId = throwIfMissing(),
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
        checkMatchableApporder({ chainId, order: requestorder.order }),
      ),
    ).then((matchResults) =>
      toCheckOrders.filter((requestorder, index) => !matchResults[index]),
    );

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
      .filter((e) => !!e)
      .map((e) => e.toJSON())
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
  chainId = throwIfMissing(),
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
        checkMatchableDatasetorder({ chainId, order: requestorder.order }),
      ),
    ).then((matchResults) =>
      toCheckOrders.filter((requestorder, index) => !matchResults[index]),
    );

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
      .filter((e) => !!e)
      .map((e) => e.toJSON())
      .forEach((e) => {
        log('datasetorder dependant requestorder cleaned', e.orderHash);
        eventEmitter.emit('requestorder_cleaned', e);
      });
  } catch (e) {
    log('cleanDatasetorderDependantOrders() error', e);
    throw e;
  }
};

const countApporders = async ({ chainId = throwIfMissing() } = {}) => {
  try {
    const ApporderModel = await apporderModel.getModel(chainId);
    const count = await ApporderModel.find({
      status: STATUS_MAP.OPEN,
    }).countDocuments();
    return count;
  } catch (e) {
    log('countApporders() error', e);
    throw e;
  }
};

const countDatasetorders = async ({ chainId = throwIfMissing() } = {}) => {
  try {
    const DatasetorderModel = await datasetorderModel.getModel(chainId);
    const count = await DatasetorderModel.find({
      status: STATUS_MAP.OPEN,
    }).countDocuments();
    return count;
  } catch (e) {
    log('countDatasetorders() error', e);
    throw e;
  }
};

const countWorkerpoolorders = async ({ chainId = throwIfMissing() } = {}) => {
  try {
    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const count = await WorkerpoolorderModel.find({
      status: STATUS_MAP.OPEN,
    }).countDocuments();
    return count;
  } catch (e) {
    log('countWorkerpoolorders() error', e);
    throw e;
  }
};

const countRequestorders = async ({ chainId = throwIfMissing() } = {}) => {
  try {
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const count = await RequestorderModel.find({
      status: STATUS_MAP.OPEN,
    }).countDocuments();
    return count;
  } catch (e) {
    log('countRequestorders() error', e);
    throw e;
  }
};

const getApporder = async ({
  chainId = throwIfMissing(),
  orderHash = throwIfMissing(),
} = {}) => {
  try {
    const ApporderModel = await apporderModel.getModel(chainId);
    const request = { orderHash };
    const order = await ApporderModel.findOne(request);
    if (!order) {
      throw new ObjectNotFoundError('apporder not found');
    }
    return order.toJSON();
  } catch (e) {
    log('getApporder() error', e);
    throw e;
  }
};

const getApporders = async ({
  chainId = throwIfMissing(),
  app,
  dataset,
  workerpool,
  requester,
  appOwner,
  minTag,
  maxTag,
  minVolume,
  page,
} = {}) => {
  try {
    const ApporderModel = await apporderModel.getModel(chainId);
    const request = {
      status: STATUS_MAP.OPEN,
      ...(app && { 'order.app': app }),
      ...(appOwner && { signer: appOwner }),
      'order.datasetrestrict': dataset
        ? { $in: [NULL_ADDRESS, dataset] }
        : NULL_ADDRESS,
      'order.workerpoolrestrict': workerpool
        ? { $in: [NULL_ADDRESS, workerpool] }
        : NULL_ADDRESS,
      'order.requesterrestrict': requester
        ? { $in: [NULL_ADDRESS, requester] }
        : NULL_ADDRESS,
      ...minVolumeClause(minVolume),
      ...tagClause({ minTag, maxTag }),
    };
    const sort = {
      'order.appprice': 'asc',
      publicationTimestamp: 'asc',
      orderHash: 'asc', // make sort deterministic
    };
    const limit = PAGE_LENGHT;
    const skip = page || 0;

    const count = await ApporderModel.find(request).countDocuments();
    const orders = await ApporderModel.find(request)
      .sort(sort)
      .limit(limit)
      .skip(skip);

    const nextPage = orders.length === limit ? skip + limit : undefined;

    return {
      orders: orders.map((e) => e.toJSON()),
      count,
      nextPage,
    };
  } catch (e) {
    log('getApporders() error', e);
    throw e;
  }
};

const getDatasetorder = async ({
  chainId = throwIfMissing(),
  orderHash = throwIfMissing(),
} = {}) => {
  try {
    const DatasetorderModel = await datasetorderModel.getModel(chainId);
    const request = { orderHash };
    const order = await DatasetorderModel.findOne(request);
    if (!order) {
      throw new ObjectNotFoundError('datasetorder not found');
    }
    return order.toJSON();
  } catch (e) {
    log('getDatasetorder() error', e);
    throw e;
  }
};

const getDatasetorders = async ({
  chainId = throwIfMissing(),
  dataset,
  app,
  workerpool,
  requester,
  datasetOwner,
  minTag,
  maxTag,
  minVolume,
  page,
} = {}) => {
  try {
    const DatasetorderModel = await datasetorderModel.getModel(chainId);
    const request = {
      status: STATUS_MAP.OPEN,
      ...(dataset && { 'order.dataset': dataset }),
      ...(datasetOwner && { signer: datasetOwner }),
      'order.apprestrict': app ? { $in: [NULL_ADDRESS, app] } : NULL_ADDRESS,
      'order.workerpoolrestrict': workerpool
        ? { $in: [NULL_ADDRESS, workerpool] }
        : NULL_ADDRESS,
      'order.requesterrestrict': requester
        ? { $in: [NULL_ADDRESS, requester] }
        : NULL_ADDRESS,
      ...minVolumeClause(minVolume),
      ...tagClause({ minTag, maxTag }),
    };
    const sort = {
      'order.datasetprice': 'asc',
      publicationTimestamp: 'asc',
      orderHash: 'asc', // make sort deterministic
    };
    const limit = PAGE_LENGHT;
    const skip = page || 0;

    const count = await DatasetorderModel.find(request).countDocuments();
    const orders = await DatasetorderModel.find(request)
      .sort(sort)
      .limit(limit)
      .skip(skip);

    const nextPage = orders.length === limit ? skip + limit : undefined;

    return {
      orders: orders.map((e) => e.toJSON()),
      count,
      nextPage,
    };
  } catch (e) {
    log('getDatasetorders() error', e);
    throw e;
  }
};

const getWorkerpoolorder = async ({
  chainId = throwIfMissing(),
  orderHash = throwIfMissing(),
} = {}) => {
  try {
    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const request = { orderHash };
    const order = await WorkerpoolorderModel.findOne(request);
    if (!order) {
      throw new ObjectNotFoundError('workerpoolorder not found');
    }
    return order.toJSON();
  } catch (e) {
    log('getWorkerpoolorder() error', e);
    throw e;
  }
};

const getWorkerpoolorders = async ({
  chainId = throwIfMissing(),
  category,
  workerpool,
  app,
  dataset,
  requester,
  workerpoolOwner,
  minTag,
  maxTag,
  minTrust,
  minVolume,
  page,
} = {}) => {
  try {
    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const request = {
      status: STATUS_MAP.OPEN,
      ...(category !== undefined && { 'order.category': category }),
      ...(workerpool && { 'order.workerpool': workerpool }),
      ...(workerpoolOwner && { signer: workerpoolOwner }),
      'order.apprestrict': app ? { $in: [NULL_ADDRESS, app] } : NULL_ADDRESS,
      'order.datasetrestrict': dataset
        ? { $in: [NULL_ADDRESS, dataset] }
        : NULL_ADDRESS,
      'order.requesterrestrict': requester
        ? { $in: [NULL_ADDRESS, requester] }
        : NULL_ADDRESS,
      ...minTrustClause(minTrust),
      ...minVolumeClause(minVolume),
      ...tagClause({ minTag, maxTag }),
    };
    const sort = {
      'order.workerpoolprice': 'asc',
      publicationTimestamp: 'asc',
      orderHash: 'asc', // make sort deterministic
    };
    const limit = PAGE_LENGHT;
    const skip = page || 0;

    const count = await WorkerpoolorderModel.find(request).countDocuments();
    const orders = await WorkerpoolorderModel.find(request)
      .sort(sort)
      .limit(limit)
      .skip(skip);

    const nextPage = orders.length === limit ? skip + limit : undefined;

    return {
      orders: orders.map((e) => e.toJSON()),
      count,
      nextPage,
    };
  } catch (e) {
    log('getWorkerpoolorders() error', e);
    throw e;
  }
};

const getRequestorder = async ({
  chainId = throwIfMissing(),
  orderHash = throwIfMissing(),
} = {}) => {
  try {
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const request = { orderHash };
    const order = await RequestorderModel.findOne(request);
    if (!order) {
      throw new ObjectNotFoundError('requestorder not found');
    }
    return order.toJSON();
  } catch (e) {
    log('getRequestorder() error', e);
    throw e;
  }
};

const getRequestorders = async ({
  chainId = throwIfMissing(),
  app,
  dataset,
  requester,
  beneficiary,
  category,
  minTag,
  maxTag,
  maxTrust,
  minVolume,
  workerpool,
  page,
} = {}) => {
  try {
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const request = {
      status: STATUS_MAP.OPEN,
      ...(category !== undefined && { 'order.category': category }),
      ...(app && { 'order.app': app }),
      ...(dataset && { 'order.dataset': dataset }),
      ...(requester && { 'order.requester': requester }),
      ...(beneficiary && { 'order.beneficiary': beneficiary }),
      'order.workerpool': workerpool
        ? { $in: [NULL_ADDRESS, workerpool] }
        : NULL_ADDRESS,
      ...maxTrustClause(maxTrust),
      ...minVolumeClause(minVolume),
      ...tagClause({ minTag, maxTag }),
    };
    const sort = {
      'order.workerpoolmaxprice': 'desc',
      publicationTimestamp: 'asc',
      orderHash: 'asc', // make sort deterministic
    };
    const limit = PAGE_LENGHT;
    const skip = page || 0;

    const count = await RequestorderModel.find(request).countDocuments();
    const orders = await RequestorderModel.find(request)
      .sort(sort)
      .limit(limit)
      .skip(skip);

    const nextPage = orders.length === limit ? skip + limit : undefined;

    return {
      orders: orders.map((e) => e.toJSON()),
      count,
      nextPage,
    };
  } catch (e) {
    log('getRequestorders() error', e);
    throw e;
  }
};

const publishApporder = async ({
  chainId = throwIfMissing(),
  order = throwIfMissing(),
  authorized = throwIfMissing(),
} = {}) => {
  const orderName = 'apporder';
  try {
    // auth
    const authorizedAddress = authorized.address;
    const authorizedChain = authorized.chainId;
    if (!authorizedAddress && !authorizedChain)
      throw new AuthError('operation not authorized');
    if (chainId !== authorizedChain)
      throw new AuthError(`operation not authorized for chain ${chainId}`);

    const formatedSignedOrder = await signedApporderSchema().validate(order);
    const formatedOrder = await apporderSchema().validate(order);

    const tagArray = tagToArray(formatedSignedOrder.tag);

    const ApporderModel = await apporderModel.getModel(chainId);
    const iExecContract = getContract('hub', chainId);

    // get orderHash
    const domain = await fetchIExecDomain(iExecContract);
    const typedData = {
      types: {
        EIP712Domain: OBJ_MAP.EIP712Domain.structMembers,
        [OBJ_MAP[orderName].primaryType]: OBJ_MAP[orderName].structMembers,
      },
      domain,
      primaryType: OBJ_MAP[orderName].primaryType,
      message: formatedOrder,
    };
    const orderHash = hashEIP712(typedData);

    // check existing reccord
    const existing = await ApporderModel.findOne({ orderHash });
    if (existing && existing.status !== STATUS_MAP.DEAD)
      throw new BusinessError('order already published');

    // check sign
    const signer = await fetchContractOwner({
      chainId,
      iExecContract,
      deployedAddress: formatedSignedOrder.app,
      registryName: OBJ_MAP[orderName].registryName,
      contractName: OBJ_MAP[orderName].contractName,
    });
    if (signer !== authorizedAddress) {
      throw new BusinessError(
        `only order signer ${signer} can publish an order`,
      );
    }
    const verifySign = await wrapEthCall(
      iExecContract.verifySignature(
        signer,
        orderHash,
        formatedSignedOrder.sign,
      ),
    );
    if (!verifySign) throw new BusinessError('invalid sign');

    // check max order publication
    const nbPublished = await ApporderModel.find({
      signer,
      status: STATUS_MAP.OPEN,
    }).countDocuments();
    if (nbPublished >= maxOpenOrdersPerWallet) {
      throw new BusinessError(
        `maximun of ${maxOpenOrdersPerWallet} published open ${orderName} has been reached for wallet ${signer}`,
      );
    }

    if (isEnterpriseFlavour(flavour)) {
      // check whitelist
      await Promise.all([
        checkSignerInWhitelist({ chainId, iExecContract, signer }),
        checkDatasetownerInWhitelist({
          chainId,
          iExecContract,
          dataset: formatedSignedOrder.datasetrestrict,
        }),
        checkWorkerpoolownerInWhitelist({
          chainId,
          iExecContract,
          workerpool: formatedSignedOrder.workerpoolrestrict,
        }),
        checkRequesterInWhitelist({
          chainId,
          iExecContract,
          requester: formatedSignedOrder.requesterrestrict,
        }),
      ]);
    }

    // check remaining volume
    const consumedVolume = ethersBnToBn(
      await wrapEthCall(iExecContract.viewConsumed(orderHash)),
    );
    const remainingVolume = new BN(formatedOrder.volume).sub(consumedVolume);
    if (remainingVolume.isZero())
      throw new BusinessError('order already consumed');

    // publishing
    const status = STATUS_MAP.OPEN;
    const publicationTimestamp = new Date().toISOString();
    const toPublish =
      existing ||
      new ApporderModel({
        order,
        orderHash,
        chainId,
        signer,
        publicationTimestamp,
        tagArray,
      });
    toPublish.status = status;
    toPublish.remaining = remainingVolume.toString();
    const saved = await toPublish.save();
    const published = saved.toJSON();

    eventEmitter.emit('apporder_published', published);

    return published;
  } catch (e) {
    log('publishApporder() error', e);
    throw e;
  }
};

const publishDatasetorder = async ({
  chainId = throwIfMissing(),
  order = throwIfMissing(),
  authorized = throwIfMissing(),
} = {}) => {
  const orderName = 'datasetorder';
  try {
    // auth
    const authorizedAddress = authorized.address;
    const authorizedChain = authorized.chainId;
    if (!authorizedAddress && !authorizedChain)
      throw new AuthError('operation not authorized');
    if (chainId !== authorizedChain)
      throw new AuthError(`operation not authorized for chain ${chainId}`);

    const formatedSignedOrder = await signedDatasetorderSchema().validate(
      order,
    );
    const formatedOrder = await datasetorderSchema().validate(order);

    const tagArray = tagToArray(formatedSignedOrder.tag);

    const DatasetorderModel = await datasetorderModel.getModel(chainId);
    const iExecContract = getContract('hub', chainId);

    // get orderHash
    const domain = await fetchIExecDomain(iExecContract);
    const typedData = {
      types: {
        EIP712Domain: OBJ_MAP.EIP712Domain.structMembers,
        [OBJ_MAP[orderName].primaryType]: OBJ_MAP[orderName].structMembers,
      },
      domain,
      primaryType: OBJ_MAP[orderName].primaryType,
      message: formatedOrder,
    };
    const orderHash = hashEIP712(typedData);

    // check existing reccord
    const existing = await DatasetorderModel.findOne({ orderHash });
    if (existing && existing.status !== STATUS_MAP.DEAD)
      throw new BusinessError('order already published');

    // check sign
    const signer = await fetchContractOwner({
      chainId,
      iExecContract,
      deployedAddress: formatedSignedOrder.dataset,
      registryName: OBJ_MAP[orderName].registryName,
      contractName: OBJ_MAP[orderName].contractName,
    });
    if (signer !== authorizedAddress) {
      throw new BusinessError(
        `only order signer ${signer} can publish an order`,
      );
    }
    const verifySign = await wrapEthCall(
      iExecContract.verifySignature(
        signer,
        orderHash,
        formatedSignedOrder.sign,
      ),
    );
    if (!verifySign) throw new BusinessError('invalid sign');

    // check max order publication
    const nbPublished = await DatasetorderModel.find({
      signer,
      status: STATUS_MAP.OPEN,
    }).countDocuments();
    if (nbPublished >= maxOpenOrdersPerWallet) {
      throw new BusinessError(
        `maximun of ${maxOpenOrdersPerWallet} published open ${orderName} has been reached for wallet ${signer}`,
      );
    }

    if (isEnterpriseFlavour(flavour)) {
      // check whitelist
      await Promise.all([
        checkSignerInWhitelist({ chainId, iExecContract, signer }),
        checkAppownerInWhitelist({
          chainId,
          iExecContract,
          app: formatedSignedOrder.apprestrict,
        }),
        checkWorkerpoolownerInWhitelist({
          chainId,
          iExecContract,
          workerpool: formatedSignedOrder.workerpoolrestrict,
        }),
        checkRequesterInWhitelist({
          chainId,
          iExecContract,
          requester: formatedSignedOrder.requesterrestrict,
        }),
      ]);
    }

    // check remaining volume
    const consumedVolume = ethersBnToBn(
      await wrapEthCall(iExecContract.viewConsumed(orderHash)),
    );
    const remainingVolume = new BN(formatedOrder.volume).sub(consumedVolume);
    if (remainingVolume.isZero())
      throw new BusinessError('order already consumed');

    // publishing
    const status = STATUS_MAP.OPEN;
    const publicationTimestamp = new Date().toISOString();
    const toPublish =
      existing ||
      new DatasetorderModel({
        order,
        orderHash,
        chainId,
        signer,
        publicationTimestamp,
        tagArray,
      });
    toPublish.status = status;
    toPublish.remaining = remainingVolume.toString();
    const saved = await toPublish.save();
    const published = saved.toJSON();

    eventEmitter.emit('datasetorder_published', published);

    return published;
  } catch (e) {
    log('publishDatasetorder() error', e);
    throw e;
  }
};

const publishWorkerpoolorder = async ({
  chainId = throwIfMissing(),
  order = throwIfMissing(),
  authorized = throwIfMissing(),
} = {}) => {
  const orderName = 'workerpoolorder';
  try {
    // auth
    const authorizedAddress = authorized.address;
    const authorizedChain = authorized.chainId;
    if (!authorizedAddress && !authorizedChain)
      throw new AuthError('operation not authorized');
    if (chainId !== authorizedChain)
      throw new AuthError(`operation not authorized for chain ${chainId}`);

    const formatedSignedOrder = await signedWorkerpoolorderSchema().validate(
      order,
    );
    const formatedOrder = await workerpoolorderSchema().validate(order);

    const tagArray = tagToArray(formatedSignedOrder.tag);

    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const iExecContract = getContract('hub', chainId);

    // get orderHash
    const domain = await fetchIExecDomain(iExecContract);
    const typedData = {
      types: {
        EIP712Domain: OBJ_MAP.EIP712Domain.structMembers,
        [OBJ_MAP[orderName].primaryType]: OBJ_MAP[orderName].structMembers,
      },
      domain,
      primaryType: OBJ_MAP[orderName].primaryType,
      message: formatedOrder,
    };
    const orderHash = hashEIP712(typedData);

    // check existing reccord
    const existing = await WorkerpoolorderModel.findOne({ orderHash });
    if (existing && existing.status !== STATUS_MAP.DEAD)
      throw new BusinessError('order already published');

    // check sign
    const signer = await fetchContractOwner({
      chainId,
      iExecContract,
      deployedAddress: formatedSignedOrder.workerpool,
      registryName: OBJ_MAP[orderName].registryName,
      contractName: OBJ_MAP[orderName].contractName,
    });
    if (signer !== authorizedAddress) {
      throw new BusinessError(
        `only order signer ${signer} can publish an order`,
      );
    }
    const verifySign = await wrapEthCall(
      iExecContract.verifySignature(
        signer,
        orderHash,
        formatedSignedOrder.sign,
      ),
    );
    if (!verifySign) throw new BusinessError('invalid sign');

    // check max order publication
    const nbPublished = await WorkerpoolorderModel.find({
      signer,
      status: STATUS_MAP.OPEN,
    }).countDocuments();
    if (nbPublished >= maxOpenOrdersPerWallet) {
      throw new BusinessError(
        `maximun of ${maxOpenOrdersPerWallet} published open ${orderName} has been reached for wallet ${signer}`,
      );
    }

    if (isEnterpriseFlavour(flavour)) {
      // check whitelist
      await Promise.all([
        checkSignerInWhitelist({ chainId, iExecContract, signer }),
        checkAppownerInWhitelist({
          chainId,
          iExecContract,
          app: formatedSignedOrder.apprestrict,
        }),
        checkDatasetownerInWhitelist({
          chainId,
          iExecContract,
          dataset: formatedSignedOrder.datasetrestrict,
        }),
        checkRequesterInWhitelist({
          chainId,
          iExecContract,
          requester: formatedSignedOrder.requesterrestrict,
        }),
      ]);
    }

    // check remaining volume
    const consumedVolume = ethersBnToBn(
      await wrapEthCall(iExecContract.viewConsumed(orderHash)),
    );
    const remainingVolume = new BN(formatedOrder.volume).sub(consumedVolume);
    if (remainingVolume.isZero())
      throw new BusinessError('order already consumed');

    /** ---- ALLOW BID/ASK OVERLAP ----
    // check best price (workerpoolorder specific)
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const [bestRequestorder] = await RequestorderModel.find({
      status: STATUS_MAP.OPEN,
      'order.category': formatedOrder.category,
      ...maxTrustClause(formatedOrder.trust),
      ...maxTagClause(formatedOrder.tag),
    })
      .sort({ 'order.workerpoolmaxprice': -1 })
      .limit(1);
    if (
      bestRequestorder
      && bestRequestorder.order
      && new BN(bestRequestorder.order.workerpoolmaxprice).gte(
        new BN(formatedOrder.workerpoolprice),
      )
    ) {
      throw new BusinessError(
        `workerpoolprice (${formatedOrder.workerpoolprice}) is less than or equals best requestorder price (${bestRequestorder.order.workerpoolmaxprice}), you may want to fill it`,
      );
    }
    */

    // check workerpool owner stake (workerpoolorder specific)
    const workerpoolPrice = new BN(formatedOrder.workerpoolprice);
    const workerpoolAccount = await wrapEthCall(
      iExecContract.viewAccount(signer),
    );
    const workerpoolStake = ethersBnToBn(workerpoolAccount.stake);
    const currentOrderRequiredStake = workerpoolPrice
      .mul(new BN(30))
      .div(new BN(100))
      .mul(remainingVolume);
    if (workerpoolStake.lt(currentOrderRequiredStake)) {
      throw new BusinessError(
        "workerpool owner's stake is too low to cover required workerpool lock",
      );
    }

    // publishing
    const status = STATUS_MAP.OPEN;
    const publicationTimestamp = new Date().toISOString();
    const toPublish =
      existing ||
      new WorkerpoolorderModel({
        order,
        orderHash,
        chainId,
        signer,
        publicationTimestamp,
        tagArray,
      });
    toPublish.status = status;
    toPublish.remaining = remainingVolume.toString();
    const saved = await toPublish.save();
    const published = saved.toJSON();

    eventEmitter.emit('workerpoolorder_published', published);

    return published;
  } catch (e) {
    log('publishWorkerpoolorder() error', e);
    throw e;
  }
};

const publishRequestorder = async ({
  chainId = throwIfMissing(),
  order = throwIfMissing(),
  authorized = throwIfMissing(),
} = {}) => {
  const orderName = 'requestorder';
  try {
    // auth
    const authorizedAddress = authorized.address;
    const authorizedChain = authorized.chainId;
    if (!authorizedAddress && !authorizedChain)
      throw new AuthError('operation not authorized');
    if (chainId !== authorizedChain)
      throw new AuthError(`operation not authorized for chain ${chainId}`);

    const formatedSignedOrder = await signedRequestorderSchema().validate(
      order,
    );
    const formatedOrder = await requestorderSchema().validate(order);

    const tagArray = tagToArray(formatedSignedOrder.tag);

    const RequestorderModel = await requestorderModel.getModel(chainId);
    const iExecContract = getContract('hub', chainId);

    // get orderHash
    const domain = await fetchIExecDomain(iExecContract);
    const typedData = {
      types: {
        EIP712Domain: OBJ_MAP.EIP712Domain.structMembers,
        [OBJ_MAP[orderName].primaryType]: OBJ_MAP[orderName].structMembers,
      },
      domain,
      primaryType: OBJ_MAP[orderName].primaryType,
      message: formatedOrder,
    };
    const orderHash = hashEIP712(typedData);

    // check existing reccord
    const existing = await RequestorderModel.findOne({ orderHash });
    if (existing && existing.status !== STATUS_MAP.DEAD)
      throw new BusinessError('order already published');

    // check sign
    const signer = formatedSignedOrder.requester;
    if (signer !== authorizedAddress) {
      throw new BusinessError(
        `only order signer ${signer} can publish an order`,
      );
    }
    const verifySign = await wrapEthCall(
      iExecContract.verifySignature(
        signer,
        orderHash,
        formatedSignedOrder.sign,
      ),
    );
    if (!verifySign) throw new BusinessError('invalid sign');

    // check max order publication
    const nbPublished = await RequestorderModel.find({
      signer,
      status: STATUS_MAP.OPEN,
    }).countDocuments();
    if (nbPublished >= maxOpenOrdersPerWallet) {
      throw new BusinessError(
        `maximun of ${maxOpenOrdersPerWallet} published open ${orderName} has been reached for wallet ${signer}`,
      );
    }

    if (isEnterpriseFlavour(flavour)) {
      // check whitelist
      await Promise.all([
        checkSignerInWhitelist({ chainId, iExecContract, signer }),
        checkAppownerInWhitelist({
          chainId,
          iExecContract,
          app: formatedSignedOrder.app,
        }),
        checkDatasetownerInWhitelist({
          chainId,
          iExecContract,
          dataset: formatedSignedOrder.dataset,
        }),
        checkWorkerpoolownerInWhitelist({
          chainId,
          iExecContract,
          workerpool: formatedSignedOrder.workerpool,
        }),
      ]);
    }

    // check remaining volume
    const consumedVolume = ethersBnToBn(
      await wrapEthCall(iExecContract.viewConsumed(orderHash)),
    );
    const remainingVolume = new BN(formatedOrder.volume).sub(consumedVolume);
    if (remainingVolume.isZero())
      throw new BusinessError('order already consumed');

    // check requester stake (requestorder specific)
    const appPrice = new BN(formatedOrder.appmaxprice);
    const datasetPrice = new BN(formatedOrder.datasetmaxprice);
    const workerpoolPrice = new BN(formatedOrder.workerpoolmaxprice);
    const costPerWork = appPrice.add(datasetPrice).add(workerpoolPrice);
    const totalCost = costPerWork.mul(remainingVolume);
    const requesterAccount = await wrapEthCall(
      iExecContract.viewAccount(signer),
    );
    const requesterStake = ethersBnToBn(requesterAccount.stake);
    if (requesterStake.lt(totalCost)) {
      throw new BusinessError(
        `requester stake is too low to cover requestorder payment, minimum stake required is ${totalCost} nRLC`,
      );
    }

    /** ---- ALLOW BID/ASK OVERLAP ----
    // check best price (requestorder specific)
    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const [bestWorkerpoolOrder] = await WorkerpoolorderModel.find({
      status: STATUS_MAP.OPEN,
      'order.category': formatedOrder.category,
      ...minTrustClause(formatedOrder.trust),
      ...minTagClause(formatedOrder.tag),
    })
      .sort({ 'order.workerpoolprice': 1 })
      .limit(1);
    if (
      bestWorkerpoolOrder
      && bestWorkerpoolOrder.order
      && new BN(bestWorkerpoolOrder.order.workerpoolprice).lte(
        new BN(formatedOrder.workerpoolmaxprice),
      )
    ) {
      throw new BusinessError(
        `workerpoolmaxprice (${formatedOrder.workerpoolmaxprice}) is greather than or equals best workerpoolorder price (${bestWorkerpoolOrder.order.workerpoolprice}), you may want to fill it`,
      );
    }
    */

    // check matchable open apporder (requestorder specific)
    await checkMatchableApporder({
      chainId,
      order: formatedOrder,
      strict: true,
    });

    // check matchable open datasetorder (requestorder specific)
    if (formatedOrder.dataset !== NULL_ADDRESS) {
      await checkMatchableDatasetorder({
        chainId,
        order: formatedOrder,
        strict: true,
      });
    }

    // publishing
    const status = STATUS_MAP.OPEN;
    const publicationTimestamp = new Date().toISOString();
    const toPublish =
      existing ||
      new RequestorderModel({
        order,
        orderHash,
        chainId,
        signer,
        publicationTimestamp,
        tagArray,
      });
    toPublish.status = status;
    toPublish.remaining = remainingVolume.toString();
    const saved = await toPublish.save();
    const published = saved.toJSON();

    eventEmitter.emit('requestorder_published', published);

    return published;
  } catch (e) {
    log('publishRequestorder() error', e);
    throw e;
  }
};

const unpublishOrders = async ({
  model = throwIfMissing(),
  orderName = throwIfMissing(),
  target = throwIfMissing(),
  resourceId = throwIfMissing(),
  signer = throwIfMissing(),
} = {}) => {
  const { addressField } = OBJ_MAP[orderName];
  const ordersToUnpublish = [];
  switch (target) {
    case UNPUBLISH_TARGET_MAP.ORDERHASH: {
      const published = await model.findOne({
        orderHash: resourceId,
        status: STATUS_MAP.OPEN,
      });
      if (!published) {
        throw new BusinessError(
          `${orderName} with orderHash ${resourceId} is not published`,
        );
      }
      if (!published.signer || published.signer !== signer) {
        throw new BusinessError(
          `only order signer ${published.signer} can unpublish an order`,
        );
      }
      ordersToUnpublish.push(published);
      break;
    }
    case UNPUBLISH_TARGET_MAP.LAST: {
      const [published] = await model
        .find({
          [`order.${addressField}`]: resourceId,
          signer,
          status: STATUS_MAP.OPEN,
        })
        .sort({ publicationTimestamp: -1 })
        .limit(1);
      if (!published) {
        throw new BusinessError(
          `no open ${orderName} published by signer ${signer} for ${addressField} ${resourceId}`,
        );
      }
      ordersToUnpublish.push(published);
      break;
    }
    case UNPUBLISH_TARGET_MAP.ALL: {
      const published = await model
        .find({
          [`order.${addressField}`]: resourceId,
          signer,
          status: STATUS_MAP.OPEN,
        })
        .sort({ publicationTimestamp: -1 });
      if (published.length === 0) {
        throw new BusinessError(
          `no open ${orderName} published by signer ${signer} for ${addressField} ${resourceId}`,
        );
      }
      ordersToUnpublish.push(...published);
      break;
    }
    default:
      throw new InternalError('unsupported target');
  }
  await Promise.all(ordersToUnpublish.map((e) => e.delete()));
  return ordersToUnpublish.map((e) => e.toJSON());
};

const unpublishApporders = async ({
  chainId = throwIfMissing(),
  target = throwIfMissing(),
  resourceId = throwIfMissing(),
  authorized = throwIfMissing(),
} = {}) => {
  const orderName = 'apporder';
  try {
    const authorizedAddress = authorized.address;
    const authorizedChain = authorized.chainId;
    if (!authorizedAddress && !authorizedChain)
      throw new AuthError('operation not authorized');
    if (chainId !== authorizedChain)
      throw new AuthError(`operation not authorized for chain ${chainId}`);
    const ApporderModel = await apporderModel.getModel(chainId);
    const unpublishedOrders = await unpublishOrders({
      orderName,
      model: ApporderModel,
      target,
      resourceId,
      signer: authorizedAddress,
    });
    unpublishedOrders.forEach((e) =>
      eventEmitter.emit('apporder_unpublished', e),
    );
    return unpublishedOrders.map((e) => e.orderHash);
  } catch (e) {
    log('unpublishApporders() error', e);
    throw e;
  }
};

const unpublishDatasetorders = async ({
  chainId = throwIfMissing(),
  target = throwIfMissing(),
  resourceId = throwIfMissing(),
  authorized = throwIfMissing(),
} = {}) => {
  const orderName = 'datasetorder';
  try {
    const authorizedAddress = authorized.address;
    const authorizedChain = authorized.chainId;
    if (!authorizedAddress && !authorizedChain)
      throw new AuthError('operation not authorized');
    if (chainId !== authorizedChain)
      throw new AuthError(`operation not authorized for chain ${chainId}`);
    const DatasetorderModel = await datasetorderModel.getModel(chainId);
    const unpublishedOrders = await unpublishOrders({
      orderName,
      model: DatasetorderModel,
      target,
      resourceId,
      signer: authorizedAddress,
    });
    unpublishedOrders.forEach((e) =>
      eventEmitter.emit('datasetorder_unpublished', e),
    );
    return unpublishedOrders.map((e) => e.orderHash);
  } catch (e) {
    log('unpublishDatasetorders() error', e);
    throw e;
  }
};

const unpublishWorkerpoolorders = async ({
  chainId = throwIfMissing(),
  target = throwIfMissing(),
  resourceId = throwIfMissing(),
  authorized = throwIfMissing(),
} = {}) => {
  const orderName = 'workerpoolorder';
  try {
    const authorizedAddress = authorized.address;
    const authorizedChain = authorized.chainId;
    if (!authorizedAddress && !authorizedChain)
      throw new AuthError('operation not authorized');
    if (chainId !== authorizedChain)
      throw new AuthError(`operation not authorized for chain ${chainId}`);
    const WorkerpoolorderModel = await workerpoolorderModel.getModel(chainId);
    const unpublishedOrders = await unpublishOrders({
      orderName,
      model: WorkerpoolorderModel,
      target,
      resourceId,
      signer: authorizedAddress,
    });
    unpublishedOrders.forEach((e) =>
      eventEmitter.emit('workerpoolorder_unpublished', e),
    );
    return unpublishedOrders.map((e) => e.orderHash);
  } catch (e) {
    log('unpublishWorkerpoolorders() error', e);
    throw e;
  }
};

const unpublishRequestorders = async ({
  chainId = throwIfMissing(),
  target = throwIfMissing(),
  resourceId = throwIfMissing(),
  authorized = throwIfMissing(),
} = {}) => {
  const orderName = 'requestorder';
  try {
    const authorizedAddress = authorized.address;
    const authorizedChain = authorized.chainId;
    if (!authorizedAddress && !authorizedChain)
      throw new AuthError('operation not authorized');
    if (chainId !== authorizedChain)
      throw new AuthError(`operation not authorized for chain ${chainId}`);
    const RequestorderModel = await requestorderModel.getModel(chainId);
    const unpublishedOrders = await unpublishOrders({
      orderName,
      model: RequestorderModel,
      target,
      resourceId,
      signer: authorizedAddress,
    });
    unpublishedOrders.forEach((e) =>
      eventEmitter.emit('requestorder_unpublished', e),
    );
    return unpublishedOrders.map((e) => e.orderHash);
  } catch (e) {
    log('unpublishRequestorders() error', e);
    throw e;
  }
};

module.exports = {
  countApporders,
  countDatasetorders,
  countWorkerpoolorders,
  countRequestorders,
  getApporder,
  getApporders,
  publishApporder,
  unpublishApporders,
  cleanApporderDependantOrders,
  getDatasetorders,
  getDatasetorder,
  publishDatasetorder,
  unpublishDatasetorders,
  cleanDatasetorderDependantOrders,
  getWorkerpoolorder,
  getWorkerpoolorders,
  publishWorkerpoolorder,
  unpublishWorkerpoolorders,
  getRequestorder,
  getRequestorders,
  publishRequestorder,
  unpublishRequestorders,
};
