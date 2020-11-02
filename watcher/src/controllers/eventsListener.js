const { logger } = require('../utils/logger');
const { emit } = require('../loaders/socket');
const {
  cleanApporderDependantOrders,
  cleanDatasetorderDependantOrders,
} = require('../services/order');
const { eventEmitter } = require('../loaders/eventEmitter');
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

eventEmitter.on('apporder_updated', (updated) => {
  const { chainId, ...order } = updated;
  log('apporder_updated', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'apporder_updated', order);
});

eventEmitter.on('datasetorder_updated', (updated) => {
  const { chainId, ...order } = updated;
  log('datasetorder_updated', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'datasetorder_updated', order);
});

eventEmitter.on('workerpoolorder_updated', (updated) => {
  const { chainId, ...order } = updated;
  log('workerpoolorder_updated', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'workerpoolorder_updated', order);
});

eventEmitter.on('requestorder_updated', (updated) => {
  const { chainId, ...order } = updated;
  log('requestorder_updated', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_updated', order);
});

eventEmitter.on('apporder_canceled', (canceled) => {
  const { chainId, ...order } = canceled;
  const { orderHash } = order;
  log('apporder_canceled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'apporder_unpublished', orderHash);
  launchJob(cleanApporderDependantOrders, { chainId, apporder: order });
});

eventEmitter.on('datasetorder_canceled', (canceled) => {
  const { chainId, ...order } = canceled;
  const { orderHash } = order;
  log('datasetorder_canceled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'datasetorder_unpublished', orderHash);
  launchJob(cleanDatasetorderDependantOrders, { chainId, datasetorder: order });
});

eventEmitter.on('workerpoolorder_canceled', (canceled) => {
  const { chainId, orderHash } = canceled;
  log('workerpoolorder_canceled', orderHash);
  launchJob(
    emit,
    `${chainId}:orders`,
    'workerpoolorder_unpublished',
    orderHash,
  );
});

eventEmitter.on('requestorder_canceled', (canceled) => {
  const { chainId, orderHash } = canceled;
  log('requestorder_canceled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_unpublished', orderHash);
});

eventEmitter.on('apporder_filled', (filled) => {
  const { chainId, ...order } = filled;
  const { orderHash } = order;
  log('apporder_filled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'apporder_unpublished', orderHash);
  launchJob(cleanApporderDependantOrders, { chainId, apporder: order });
});

eventEmitter.on('datasetorder_filled', (filled) => {
  const { chainId, ...order } = filled;
  const { orderHash } = order;
  log('datasetorder_filled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'datasetorder_unpublished', orderHash);
  launchJob(cleanDatasetorderDependantOrders, { chainId, datasetorder: order });
});

eventEmitter.on('workerpoolorder_filled', (filled) => {
  const { chainId, orderHash } = filled;
  log('workerpoolorder_filled', orderHash);
  launchJob(
    emit,
    `${chainId}:orders`,
    'workerpoolorder_unpublished',
    orderHash,
  );
});

eventEmitter.on('requestorder_filled', (filled) => {
  const { chainId, orderHash } = filled;
  log('requestorder_filled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_unpublished', orderHash);
});

eventEmitter.on('apporder_cleaned', (cleaned) => {
  const { chainId, ...order } = cleaned;
  const { orderHash } = order;
  log('apporder_cleaned', orderHash);
  launchJob(emit, `${chainId}:orders`, 'apporder_unpublished', orderHash);
  launchJob(cleanApporderDependantOrders, { chainId, apporder: order });
});

eventEmitter.on('datasetorder_cleaned', (cleaned) => {
  const { chainId, ...order } = cleaned;
  const { orderHash } = order;
  log('datasetorder_cleaned', orderHash);
  launchJob(emit, `${chainId}:orders`, 'datasetorder_unpublished', orderHash);
  launchJob(cleanDatasetorderDependantOrders, { chainId, datasetorder: order });
});

eventEmitter.on('workerpoolorder_cleaned', (cleaned) => {
  const { chainId, orderHash } = cleaned;
  log('workerpoolorder_cleaned', orderHash);
  launchJob(
    emit,
    `${chainId}:orders`,
    'workerpoolorder_unpublished',
    orderHash,
  );
});

eventEmitter.on('requestorder_cleaned', (cleaned) => {
  const { chainId, orderHash } = cleaned;
  log('requestorder_cleaned', orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_unpublished', orderHash);
});

eventEmitter.on('deal_created', (deal) => {
  const { chainId, dealid } = deal;
  log('deal_created', dealid);
  launchJob(emit, `${chainId}:deals`, 'deal_created', deal);
});
