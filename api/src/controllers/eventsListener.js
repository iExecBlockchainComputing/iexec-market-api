const { eventEmitter } = require('../loaders/eventEmitter');
const { emit } = require('../loaders/socket');
const {
  cleanApporderDependantOrders,
  cleanDatasetorderDependantOrders,
} = require('../services/order');
const { logger } = require('../utils/logger');
const { errorHandler } = require('../utils/error');

const log = logger.extend('controllers:eventsListener');

const launchJob = async (fn, ...args) => {
  try {
    await fn(...args);
  } catch (e) {
    errorHandler(e, { type: 'job', function: fn.name, args });
  }
};

eventEmitter.on('error', (error) => {
  log('error', error);
});

eventEmitter.on('apporder_published', (published) => {
  const { chainId, ...order } = published;
  log('apporder_published', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'apporder_published', order);
});

eventEmitter.on('apporder_unpublished', (unpublished) => {
  const { chainId, ...order } = unpublished;
  const { orderHash } = order;
  log('apporder_unpublished', orderHash);
  launchJob(emit, `${chainId}:orders`, 'apporder_unpublished', orderHash);
  launchJob(cleanApporderDependantOrders, { chainId, apporder: order });
});

eventEmitter.on('datasetorder_published', (published) => {
  const { chainId, ...order } = published;
  log('datasetorder_published', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'datasetorder_published', order);
});

eventEmitter.on('datasetorder_unpublished', (unpublished) => {
  const { chainId, ...order } = unpublished;
  const { orderHash } = order;
  log('datasetorder_unpublished', orderHash);
  launchJob(emit, `${chainId}:orders`, 'datasetorder_unpublished', orderHash);
  launchJob(cleanDatasetorderDependantOrders, { chainId, datasetorder: order });
});

eventEmitter.on('workerpoolorder_published', (published) => {
  const { chainId, ...order } = published;
  log('workerpoolorder_published', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'workerpoolorder_published', order);
});

eventEmitter.on('workerpoolorder_unpublished', (unpublished) => {
  const { chainId, orderHash } = unpublished;
  log('workerpoolorder_unpublished', orderHash);
  launchJob(
    emit,
    `${chainId}:orders`,
    'workerpoolorder_unpublished',
    orderHash,
  );
});

eventEmitter.on('requestorder_published', (published) => {
  const { chainId, ...order } = published;
  log('requestorder_published', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_published', order);
});

eventEmitter.on('requestorder_unpublished', (unpublished) => {
  const { chainId, orderHash } = unpublished;
  log('requestorder_unpublished', orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_unpublished', orderHash);
});

eventEmitter.on('requestorder_cleaned', (unpublished) => {
  const { chainId, orderHash } = unpublished;
  log('requestorder_cleaned', orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_unpublished', orderHash);
});
