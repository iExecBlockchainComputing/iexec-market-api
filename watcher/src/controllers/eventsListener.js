import { getLogger } from '../utils/logger.js';
import { emit } from '../loaders/socket.js';
import {
  cleanApporderDependantOrders,
  cleanDatasetorderDependantOrders,
} from '../services/order.js';
import { eventEmitter } from '../loaders/eventEmitter.js';
import { errorHandler } from '../utils/error.js';

const logger = getLogger('controllers:eventsListener');

const launchJob = async (fn, ...args) => {
  try {
    await fn(...args);
  } catch (e) {
    errorHandler(e, { type: 'job', function: fn.name, args });
  }
};

eventEmitter.on('error', (error) => {
  logger.error('error', error);
});

eventEmitter.on('apporder_updated', (updated) => {
  const { chainId, ...order } = updated;
  logger.debug('apporder_updated', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'apporder_updated', order);
});

eventEmitter.on('datasetorder_updated', (updated) => {
  const { chainId, ...order } = updated;
  logger.debug('datasetorder_updated', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'datasetorder_updated', order);
});

eventEmitter.on('workerpoolorder_updated', (updated) => {
  const { chainId, ...order } = updated;
  logger.debug('workerpoolorder_updated', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'workerpoolorder_updated', order);
});

eventEmitter.on('requestorder_updated', (updated) => {
  const { chainId, ...order } = updated;
  logger.debug('requestorder_updated', order.orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_updated', order);
});

eventEmitter.on('apporder_canceled', (canceled) => {
  const { chainId, ...order } = canceled;
  const { orderHash } = order;
  logger.debug('apporder_canceled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'apporder_unpublished', orderHash);
  launchJob(cleanApporderDependantOrders, { chainId, apporder: order });
});

eventEmitter.on('datasetorder_canceled', (canceled) => {
  const { chainId, ...order } = canceled;
  const { orderHash } = order;
  logger.debug('datasetorder_canceled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'datasetorder_unpublished', orderHash);
  launchJob(cleanDatasetorderDependantOrders, { chainId, datasetorder: order });
});

eventEmitter.on('workerpoolorder_canceled', (canceled) => {
  const { chainId, orderHash } = canceled;
  logger.debug('workerpoolorder_canceled', orderHash);
  launchJob(
    emit,
    `${chainId}:orders`,
    'workerpoolorder_unpublished',
    orderHash,
  );
});

eventEmitter.on('requestorder_canceled', (canceled) => {
  const { chainId, orderHash } = canceled;
  logger.debug('requestorder_canceled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_unpublished', orderHash);
});

eventEmitter.on('apporder_filled', (filled) => {
  const { chainId, ...order } = filled;
  const { orderHash } = order;
  logger.debug('apporder_filled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'apporder_unpublished', orderHash);
  launchJob(cleanApporderDependantOrders, { chainId, apporder: order });
});

eventEmitter.on('datasetorder_filled', (filled) => {
  const { chainId, ...order } = filled;
  const { orderHash } = order;
  logger.debug('datasetorder_filled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'datasetorder_unpublished', orderHash);
  launchJob(cleanDatasetorderDependantOrders, { chainId, datasetorder: order });
});

eventEmitter.on('workerpoolorder_filled', (filled) => {
  const { chainId, orderHash } = filled;
  logger.debug('workerpoolorder_filled', orderHash);
  launchJob(
    emit,
    `${chainId}:orders`,
    'workerpoolorder_unpublished',
    orderHash,
  );
});

eventEmitter.on('requestorder_filled', (filled) => {
  const { chainId, orderHash } = filled;
  logger.debug('requestorder_filled', orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_unpublished', orderHash);
});

eventEmitter.on('apporder_cleaned', (cleaned) => {
  const { chainId, ...order } = cleaned;
  const { orderHash } = order;
  logger.debug('apporder_cleaned', orderHash);
  launchJob(emit, `${chainId}:orders`, 'apporder_unpublished', orderHash);
  launchJob(cleanApporderDependantOrders, { chainId, apporder: order });
});

eventEmitter.on('datasetorder_cleaned', (cleaned) => {
  const { chainId, ...order } = cleaned;
  const { orderHash } = order;
  logger.debug('datasetorder_cleaned', orderHash);
  launchJob(emit, `${chainId}:orders`, 'datasetorder_unpublished', orderHash);
  launchJob(cleanDatasetorderDependantOrders, { chainId, datasetorder: order });
});

eventEmitter.on('workerpoolorder_cleaned', (cleaned) => {
  const { chainId, orderHash } = cleaned;
  logger.debug('workerpoolorder_cleaned', orderHash);
  launchJob(
    emit,
    `${chainId}:orders`,
    'workerpoolorder_unpublished',
    orderHash,
  );
});

eventEmitter.on('requestorder_cleaned', (cleaned) => {
  const { chainId, orderHash } = cleaned;
  logger.debug('requestorder_cleaned', orderHash);
  launchJob(emit, `${chainId}:orders`, 'requestorder_unpublished', orderHash);
});

eventEmitter.on('deal_created', (deal) => {
  const { chainId, dealid } = deal;
  logger.debug('deal_created', dealid);
  launchJob(emit, `${chainId}:deals`, 'deal_created', deal);
});
