const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const yamljs = require('yamljs');
const { koaSwagger } = require('koa2-swagger-ui');
const { authentify } = require('./auth');
const { getVersion } = require('../services/version');
const { getChallenge } = require('../services/auth');
const { getCategory, getCategories } = require('../services/category');
const { getDeal, getDeals, getOhlc } = require('../services/deal');
const { getMetrics } = require('../services/metrics');
const {
  getApporder,
  getDatasetorder,
  getWorkerpoolorder,
  getRequestorder,
  getApporders,
  getDatasetorders,
  getWorkerpoolorders,
  getRequestorders,
  publishApporder,
  publishDatasetorder,
  publishWorkerpoolorder,
  publishRequestorder,
  unpublishApporders,
  unpublishDatasetorders,
  unpublishWorkerpoolorders,
  unpublishRequestorders,
} = require('../services/order');
const { logger } = require('../utils/logger');
const {
  object,
  string,
  chainIdSchema,
  addressSchema,
  bytes32Schema,
  signedApporderSchema,
  signedDatasetorderSchema,
  signedWorkerpoolorderSchema,
  signedRequestorderSchema,
  positiveIntSchema,
  positiveStrictIntSchema,
  addressOrAnySchema,
  booleanSchema,
} = require('../utils/validator');
const { UNPUBLISH_TARGET_MAP } = require('../utils/order-utils');
const { maxPageSize, minPageSize } = require('../config').api;

const log = logger.extend('controllers:router');

const router = new Router();

// docs
router.get(
  '/docs',
  koaSwagger({
    routePrefix: false,
    swaggerOptions: { spec: yamljs.load('./openapi.yaml') },
  }),
);

// version
router.get('/version', async (ctx) => {
  log('GET /version');
  const version = await getVersion();
  ctx.body = { ok: true, version };
});

// auth
router.get('/challenge', bodyParser(), async (ctx) => {
  log('GET /challenge');
  const { chainId, address } = await object({
    chainId: chainIdSchema().required(),
    address: addressSchema().required(),
  }).validate(ctx.query);
  const data = await getChallenge({ chainId, address });
  ctx.body = { ok: true, data };
});

// categories
router.get('/categories/:catid', bodyParser(), async (ctx) => {
  log('GET /categories/:catid');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { catid } = await object({
    catid: positiveIntSchema().required(),
  }).validate(ctx.params);
  const {
    name,
    description,
    workClockTimeRef,
    transactionHash,
    blockNumber,
    blockTimestamp,
  } = await getCategory({
    chainId,
    catid,
  });
  ctx.body = {
    ok: true,
    catid,
    chainId,
    name,
    description,
    workClockTimeRef,
    transactionHash,
    blockNumber,
    blockTimestamp,
  };
});

router.get('/categories', bodyParser(), async (ctx) => {
  log('GET /categories');
  const {
    chainId,
    minWorkClockTimeRef,
    maxWorkClockTimeRef,
    page,
    pageIndex,
    pageSize,
  } = await object({
    chainId: chainIdSchema().required(),
    minWorkClockTimeRef: positiveIntSchema(),
    maxWorkClockTimeRef: positiveIntSchema(),
    page: positiveIntSchema(),
    pageIndex: positiveIntSchema(),
    pageSize: positiveIntSchema().max(maxPageSize).min(minPageSize),
  }).validate(ctx.query);
  const { categories, count, nextPage } = await getCategories({
    chainId,
    minWorkClockTimeRef,
    maxWorkClockTimeRef,
    page,
    pageIndex,
    pageSize,
  });
  ctx.body = {
    ok: true,
    categories,
    count,
    nextPage,
  };
});

// deals
router.get('/deals/:dealid', bodyParser(), async (ctx) => {
  log('GET /deals/:dealid');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { dealid } = await object({
    dealid: bytes32Schema().required(),
  }).validate(ctx.params);
  const res = await getDeal({
    chainId,
    dealid,
  });
  ctx.body = {
    ok: true,
    dealid,
    chainId,
    ...res,
  };
});

router.get('/deals', bodyParser(), async (ctx) => {
  log('GET /deals');
  const {
    chainId,
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
  } = await object({
    chainId: chainIdSchema().required(),
    category: positiveIntSchema(),
    requester: addressSchema(),
    beneficiary: addressSchema(),
    app: addressSchema(),
    dataset: addressSchema(),
    workerpool: addressSchema(),
    appOwner: addressSchema(),
    datasetOwner: addressSchema(),
    workerpoolOwner: addressSchema(),
    apporderHash: bytes32Schema(),
    datasetorderHash: bytes32Schema(),
    workerpoolorderHash: bytes32Schema(),
    requestorderHash: bytes32Schema(),
    page: positiveIntSchema(),
    pageIndex: positiveIntSchema(),
    pageSize: positiveIntSchema().max(maxPageSize).min(minPageSize),
  }).validate(ctx.query);
  const { deals, count, nextPage } = await getDeals({
    chainId,
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
  });
  ctx.body = {
    ok: true,
    deals,
    count,
    nextPage,
  };
});

router.get('/ohlc', bodyParser(), async (ctx) => {
  log('GET /ohlc');
  const { chainId, category } = await object({
    chainId: chainIdSchema().required(),
    category: positiveIntSchema().required(),
  }).validate(ctx.query);
  const ohlc = await getOhlc({ chainId, category });
  ctx.body = { ok: true, ohlc };
});

// orders
router.get('/apporders/:orderHash', bodyParser(), async (ctx) => {
  log('GET /apporders/:orderHash');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { orderHash } = await object({
    orderHash: bytes32Schema().required(),
  }).validate(ctx.params);
  const { order, remaining, status, count, publicationTimestamp, signer } =
    await getApporder({
      chainId,
      orderHash,
    });
  ctx.body = {
    ok: true,
    orderHash,
    chainId,
    order,
    remaining,
    status,
    count,
    publicationTimestamp,
    signer,
  };
});

router.get('/apporders', bodyParser(), async (ctx) => {
  log('GET /apporders');
  const {
    chainId,
    app,
    dataset,
    isDatasetStrict,
    workerpool,
    isWorkerpoolStrict,
    requester,
    isRequesterStrict,
    appOwner,
    minTag,
    maxTag,
    minVolume,
    page,
    pageIndex,
    pageSize,
  } = await object({
    chainId: chainIdSchema().required(),
    app: string().when('appOwner', {
      is: (value) => !!value,
      then: addressOrAnySchema().notRequired(),
      otherwise: addressOrAnySchema().required('app or appOwner is required'),
    }),
    appOwner: addressSchema(),
    dataset: addressOrAnySchema(),
    isDatasetStrict: booleanSchema(),
    workerpool: addressOrAnySchema(),
    isWorkerpoolStrict: booleanSchema(),
    requester: addressOrAnySchema(),
    isRequesterStrict: booleanSchema(),
    minTag: bytes32Schema(),
    maxTag: bytes32Schema(),
    minVolume: positiveStrictIntSchema(),
    page: positiveIntSchema(),
    pageIndex: positiveIntSchema(),
    pageSize: positiveIntSchema().max(maxPageSize).min(minPageSize),
  }).validate(ctx.query);
  const { orders, count, nextPage } = await getApporders({
    chainId,
    app,
    dataset,
    isDatasetStrict,
    workerpool,
    isWorkerpoolStrict,
    requester,
    isRequesterStrict,
    appOwner,
    minTag,
    maxTag,
    minVolume,
    page,
    pageIndex,
    pageSize,
  });
  ctx.body = {
    ok: true,
    orders,
    count,
    nextPage,
  };
});

router.get('/datasetorders/:orderHash', bodyParser(), async (ctx) => {
  log('GET /datasetorders/:orderHash');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { orderHash } = await object({
    orderHash: bytes32Schema().required(),
  }).validate(ctx.params);
  const { order, remaining, status, count, publicationTimestamp, signer } =
    await getDatasetorder({
      chainId,
      orderHash,
    });
  ctx.body = {
    ok: true,
    orderHash,
    chainId,
    order,
    remaining,
    status,
    count,
    publicationTimestamp,
    signer,
  };
});

router.get('/datasetorders', bodyParser(), async (ctx) => {
  log('GET /datasetorders');
  const {
    chainId,
    dataset,
    app,
    isAppStrict,
    workerpool,
    isWorkerpoolStrict,
    requester,
    isRequesterStrict,
    datasetOwner,
    minTag,
    maxTag,
    minVolume,
    page,
    pageIndex,
    pageSize,
  } = await object({
    chainId: chainIdSchema().required(),
    dataset: string().when('datasetOwner', {
      is: (value) => !!value,
      then: addressOrAnySchema().notRequired(),
      otherwise: addressOrAnySchema().required(
        'dataset or datasetOwner is required',
      ),
    }),
    datasetOwner: addressSchema(),
    app: addressOrAnySchema(),
    isAppStrict: booleanSchema(),
    workerpool: addressOrAnySchema(),
    isWorkerpoolStrict: booleanSchema(),
    requester: addressOrAnySchema(),
    isRequesterStrict: booleanSchema(),
    minTag: bytes32Schema(),
    maxTag: bytes32Schema(),
    minVolume: positiveStrictIntSchema(),
    page: positiveIntSchema(),
    pageIndex: positiveIntSchema(),
    pageSize: positiveIntSchema().max(maxPageSize).min(minPageSize),
  }).validate(ctx.query);
  const { orders, count, nextPage } = await getDatasetorders({
    chainId,
    dataset,
    app,
    isAppStrict,
    workerpool,
    isWorkerpoolStrict,
    requester,
    isRequesterStrict,
    datasetOwner,
    minTag,
    maxTag,
    minVolume,
    page,
    pageIndex,
    pageSize,
  });
  ctx.body = {
    ok: true,
    orders,
    count,
    nextPage,
  };
});

router.get('/workerpoolorders/:orderHash', bodyParser(), async (ctx) => {
  log('GET /workerpoolorders/:orderHash');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { orderHash } = await object({
    orderHash: bytes32Schema().required(),
  }).validate(ctx.params);
  const { order, remaining, status, count, publicationTimestamp, signer } =
    await getWorkerpoolorder({
      chainId,
      orderHash,
    });
  ctx.body = {
    ok: true,
    orderHash,
    chainId,
    order,
    remaining,
    status,
    count,
    publicationTimestamp,
    signer,
  };
});

router.get('/workerpoolorders', bodyParser(), async (ctx) => {
  log('GET /workerpoolorders');
  const {
    chainId,
    workerpool,
    category,
    app,
    dataset,
    requester,
    workerpoolOwner,
    minTag,
    maxTag,
    minTrust,
    minVolume,
    page,
    pageIndex,
    pageSize,
  } = await object({
    chainId: chainIdSchema().required(),
    workerpool: addressOrAnySchema(),
    workerpoolOwner: addressSchema(),
    app: addressOrAnySchema(),
    dataset: addressOrAnySchema(),
    requester: addressOrAnySchema(),
    category: positiveIntSchema(),
    minTag: bytes32Schema(),
    maxTag: bytes32Schema(),
    minVolume: positiveStrictIntSchema(),
    minTrust: positiveIntSchema(),
    page: positiveIntSchema(),
    pageIndex: positiveIntSchema(),
    pageSize: positiveIntSchema().max(maxPageSize).min(minPageSize),
  }).validate(ctx.query);
  const { orders, count, nextPage } = await getWorkerpoolorders({
    chainId,
    workerpool,
    category,
    app,
    dataset,
    requester,
    workerpoolOwner,
    minTag,
    maxTag,
    minTrust,
    minVolume,
    page,
    pageIndex,
    pageSize,
  });
  ctx.body = {
    ok: true,
    orders,
    count,
    nextPage,
  };
});

router.get('/requestorders/:orderHash', bodyParser(), async (ctx) => {
  log('GET /requestorders/:orderHash');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { orderHash } = await object({
    orderHash: bytes32Schema().required(),
  }).validate(ctx.params);
  const { order, remaining, status, count, publicationTimestamp, signer } =
    await getRequestorder({
      chainId,
      orderHash,
    });
  ctx.body = {
    ok: true,
    orderHash,
    chainId,
    order,
    remaining,
    status,
    count,
    publicationTimestamp,
    signer,
  };
});

router.get('/requestorders', bodyParser(), async (ctx) => {
  log('GET /requestorders');
  const {
    chainId,
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
    pageIndex,
    pageSize,
  } = await object({
    chainId: chainIdSchema().required(),
    app: addressOrAnySchema(),
    dataset: addressOrAnySchema(),
    requester: addressOrAnySchema(),
    beneficiary: addressOrAnySchema(),
    category: positiveIntSchema(),
    minTag: bytes32Schema(),
    maxTag: bytes32Schema(),
    maxTrust: positiveIntSchema(),
    minVolume: positiveStrictIntSchema(),
    workerpool: addressOrAnySchema(),
    page: positiveIntSchema(),
    pageIndex: positiveIntSchema(),
    pageSize: positiveIntSchema().max(maxPageSize).min(minPageSize),
  }).validate(ctx.query);
  const { orders, count, nextPage } = await getRequestorders({
    chainId,
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
    pageIndex,
    pageSize,
  });
  ctx.body = {
    ok: true,
    orders,
    count,
    nextPage,
  };
});

router.post('/apporders', bodyParser(), authentify, async (ctx) => {
  log('POST /apporders');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { order } = await object({
    order: signedApporderSchema().required(),
  }).validate(ctx.request.body);
  const saved = await publishApporder({
    chainId,
    order,
    authorized: ctx.authorized,
  });
  ctx.body = { ok: true, published: saved };
});

router.post('/datasetorders', bodyParser(), authentify, async (ctx) => {
  log('POST /datasetorders');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { order } = await object({
    order: signedDatasetorderSchema().required(),
  }).validate(ctx.request.body);
  const saved = await publishDatasetorder({
    chainId,
    order,
    authorized: ctx.authorized,
  });
  ctx.body = { ok: true, published: saved };
});

router.post('/workerpoolorders', bodyParser(), authentify, async (ctx) => {
  log('POST /workerpoolorders');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { order } = await object({
    order: signedWorkerpoolorderSchema().required(),
  }).validate(ctx.request.body);
  const saved = await publishWorkerpoolorder({
    chainId,
    order,
    authorized: ctx.authorized,
  });
  ctx.body = { ok: true, published: saved };
});

router.post('/requestorders', bodyParser(), authentify, async (ctx) => {
  log('POST /requestorders');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { order } = await object({
    order: signedRequestorderSchema().required(),
  }).validate(ctx.request.body);
  const saved = await publishRequestorder({
    chainId,
    order,
    authorized: ctx.authorized,
  });
  ctx.body = { ok: true, published: saved };
});

router.put('/apporders', bodyParser(), authentify, async (ctx) => {
  log('PUT /apporders');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { target, orderHash, app } = await object({
    target: string()
      .default(UNPUBLISH_TARGET_MAP.ORDERHASH)
      .oneOf(Object.values(UNPUBLISH_TARGET_MAP)),
    orderHash: string().when('target', {
      is: (value) =>
        [UNPUBLISH_TARGET_MAP.LAST, UNPUBLISH_TARGET_MAP.ALL].includes(value),
      then: string().notRequired(),
      otherwise: bytes32Schema().required(),
    }),
    app: string().when('target', {
      is: (value) =>
        [UNPUBLISH_TARGET_MAP.LAST, UNPUBLISH_TARGET_MAP.ALL].includes(value),
      then: addressSchema().required(),
    }),
  }).validate(ctx.request.body);
  const unpublished = await unpublishApporders({
    chainId,
    target,
    resourceId: target === UNPUBLISH_TARGET_MAP.ORDERHASH ? orderHash : app,
    authorized: ctx.authorized,
  });
  ctx.body = { ok: true, unpublished };
});

router.put('/datasetorders', bodyParser(), authentify, async (ctx) => {
  log('PUT /datasetorders');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { target, orderHash, dataset } = await object({
    target: string()
      .default(UNPUBLISH_TARGET_MAP.ORDERHASH)
      .oneOf(Object.values(UNPUBLISH_TARGET_MAP)),
    orderHash: string().when('target', {
      is: (value) =>
        [UNPUBLISH_TARGET_MAP.LAST, UNPUBLISH_TARGET_MAP.ALL].includes(value),
      then: string().notRequired(),
      otherwise: bytes32Schema().required(),
    }),
    dataset: string().when('target', {
      is: (value) =>
        [UNPUBLISH_TARGET_MAP.LAST, UNPUBLISH_TARGET_MAP.ALL].includes(value),
      then: addressSchema().required(),
    }),
  }).validate(ctx.request.body);
  const unpublished = await unpublishDatasetorders({
    chainId,
    target,
    resourceId: target === UNPUBLISH_TARGET_MAP.ORDERHASH ? orderHash : dataset,
    authorized: ctx.authorized,
  });
  ctx.body = { ok: true, unpublished };
});

router.put('/workerpoolorders', bodyParser(), authentify, async (ctx) => {
  log('PUT /workerpoolorders');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { target, orderHash, workerpool } = await object({
    target: string()
      .default(UNPUBLISH_TARGET_MAP.ORDERHASH)
      .oneOf(Object.values(UNPUBLISH_TARGET_MAP)),
    orderHash: string().when('target', {
      is: (value) =>
        [UNPUBLISH_TARGET_MAP.LAST, UNPUBLISH_TARGET_MAP.ALL].includes(value),
      then: string().notRequired(),
      otherwise: bytes32Schema().required(),
    }),
    workerpool: string().when('target', {
      is: (value) =>
        [UNPUBLISH_TARGET_MAP.LAST, UNPUBLISH_TARGET_MAP.ALL].includes(value),
      then: addressSchema().required(),
    }),
  }).validate(ctx.request.body);
  const unpublished = await unpublishWorkerpoolorders({
    chainId,
    target,
    resourceId:
      target === UNPUBLISH_TARGET_MAP.ORDERHASH ? orderHash : workerpool,
    authorized: ctx.authorized,
  });
  ctx.body = { ok: true, unpublished };
});

router.put('/requestorders', bodyParser(), authentify, async (ctx) => {
  log('PUT /requestorders');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const { target, orderHash, requester } = await object({
    target: string()
      .default(UNPUBLISH_TARGET_MAP.ORDERHASH)
      .oneOf(Object.values(UNPUBLISH_TARGET_MAP)),
    orderHash: string().when('target', {
      is: (value) =>
        [UNPUBLISH_TARGET_MAP.LAST, UNPUBLISH_TARGET_MAP.ALL].includes(value),
      then: string().notRequired(),
      otherwise: bytes32Schema().required(),
    }),
    requester: string().when('target', {
      is: (value) =>
        [UNPUBLISH_TARGET_MAP.LAST, UNPUBLISH_TARGET_MAP.ALL].includes(value),
      then: addressSchema().required(),
    }),
  }).validate(ctx.request.body);
  const unpublished = await unpublishRequestorders({
    chainId,
    target,
    resourceId:
      target === UNPUBLISH_TARGET_MAP.ORDERHASH ? orderHash : requester,
    authorized: ctx.authorized,
  });
  ctx.body = { ok: true, unpublished };
});

// monitoring metrics
router.get('/metrics', async (ctx) => {
  log('GET /metrics');
  const { chainId } = await object({
    chainId: chainIdSchema().required(),
  }).validate(ctx.query);
  const {
    lastBlock,
    checkpointBlock,
    apporders,
    datasetorders,
    workerpoolorders,
    requestorders,
  } = await getMetrics({ chainId });
  ctx.body = {
    ok: true,
    lastBlock,
    checkpointBlock,
    apporders,
    datasetorders,
    workerpoolorders,
    requestorders,
  };
});

module.exports = {
  router,
};
