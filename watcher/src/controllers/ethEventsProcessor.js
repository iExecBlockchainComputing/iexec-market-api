const { updateLastBlock } = require('../services/counter');
const { addCategory } = require('../services/category');
const { addDeal } = require('../services/deal');
const {
  cancelApporder,
  cancelDatasetorder,
  cancelWorkerpoolorder,
  cancelRequestorder,
  updateApporder,
  updateDatasetorder,
  updateWorkerpoolorder,
  updateRequestorder,
  cleanBalanceDependantOrders,
  cleanTransferredAppOrders,
  cleanTransferredDatasetOrders,
  cleanTransferredWorkerpoolOrders,
  cleanRevokedUserOrders,
} = require('../services/order');
const { tokenIdToAddress } = require('../utils/iexec-utils');
const { NULL_ADDRESS, cleanRPC } = require('../utils/eth-utils');
const { errorHandler } = require('../utils/error');
const { logger } = require('../utils/logger');

const log = logger.extend('controllers:ethEventsProcessor');

const processCreateCategory = async (event, { isReplay = false } = {}) => {
  try {
    const { transactionHash, blockNumber } = event;
    log('processCreateCategory', isReplay ? 'replay' : '', transactionHash);
    const { catid } = cleanRPC(event.args);
    await addCategory({
      catid,
      transactionHash,
      blockNumber,
    });
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processCreateCategory',
      event,
      isReplay,
    });
  }
};

const processOrdersMatched = async (event, { isReplay = false } = {}) => {
  try {
    const { transactionHash, blockNumber } = event;
    log('processOrdersMatched', isReplay ? 'replay' : '', transactionHash);
    const {
      dealid,
      appHash,
      datasetHash,
      workerpoolHash,
      requestHash,
      volume,
    } = cleanRPC(event.args);

    await Promise.all([
      addDeal({
        dealid,
        volume,
        appHash,
        datasetHash,
        workerpoolHash,
        requestHash,
        transactionHash,
        blockNumber,
      }),
      updateApporder({
        orderHash: appHash,
        blockNumber: isReplay ? undefined : blockNumber,
      }),
      datasetHash !== NULL_ADDRESS
        ? updateDatasetorder({
            orderHash: datasetHash,
            blockNumber: isReplay ? undefined : blockNumber,
          })
        : undefined,
      updateWorkerpoolorder({
        orderHash: workerpoolHash,
        blockNumber: isReplay ? undefined : blockNumber,
      }),
      updateRequestorder({
        orderHash: requestHash,
        blockNumber: isReplay ? undefined : blockNumber,
      }),
    ]);
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processOrdersMatched',
      event,
      isReplay,
    });
  }
};

const processClosedAppOrder = async (event, { isReplay = false } = {}) => {
  try {
    log(
      'processClosedAppOrder',
      isReplay ? 'replay' : '',
      event.transactionHash,
    );
    const { appHash } = cleanRPC(event.args);
    await cancelApporder({ orderHash: appHash });
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processClosedAppOrder',
      event,
      isReplay,
    });
  }
};

const processClosedDatasetOrder = async (event, { isReplay = false } = {}) => {
  try {
    log(
      'processClosedDatasetOrder',
      isReplay ? 'replay' : '',
      event.transactionHash,
    );
    const { datasetHash } = cleanRPC(event.args);
    await cancelDatasetorder({ orderHash: datasetHash });
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processClosedDatasetOrder',
      event,
      isReplay,
    });
  }
};

const processClosedWorkerpoolOrder = async (
  event,
  { isReplay = false } = {},
) => {
  try {
    log(
      'processClosedWorkerpoolOrder',
      isReplay ? 'replay' : '',
      event.transactionHash,
    );
    const { workerpoolHash } = cleanRPC(event.args);
    await cancelWorkerpoolorder({ orderHash: workerpoolHash });
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processClosedWorkerpoolOrder',
      event,
      isReplay,
    });
  }
};

const processClosedRequestOrder = async (event, { isReplay = false } = {}) => {
  try {
    log(
      'processClosedRequestOrder',
      isReplay ? 'replay' : '',
      event.transactionHash,
    );
    const { requestHash } = cleanRPC(event.args);
    await cancelRequestorder({ orderHash: requestHash });
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processClosedRequestOrder',
      event,
      isReplay,
    });
  }
};

const processStakeLoss = async (event, { isReplay = false } = {}) => {
  // account withdraw & lock
  try {
    log(
      'processTransferStake',
      isReplay ? 'replay' : '',
      event.transactionHash,
    );
    const { from, value } = cleanRPC(event.args);
    if (from !== NULL_ADDRESS && value !== '0') {
      await cleanBalanceDependantOrders({
        address: from,
        blockNumber: isReplay ? undefined : event.blockNumber,
      });
    }
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processStakeLoss',
      event,
      isReplay,
    });
  }
};

const processTransferApp = async (event, { isReplay = false } = {}) => {
  try {
    log('processTransferApp', isReplay ? 'replay' : '', event.transactionHash);
    const { from, tokenId } = cleanRPC(event.args);
    if (from !== NULL_ADDRESS) {
      await cleanTransferredAppOrders({
        address: from,
        app: tokenIdToAddress(tokenId),
        blockNumber: isReplay ? undefined : event.blockNumber,
      });
    }
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processTransferApp',
      event,
      isReplay,
    });
  }
};

const processTransferDataset = async (event, { isReplay = false } = {}) => {
  try {
    log(
      'processTransferDataset',
      isReplay ? 'replay' : '',
      event.transactionHash,
    );
    const { from, tokenId } = cleanRPC(event.args);
    if (from !== NULL_ADDRESS) {
      await cleanTransferredDatasetOrders({
        address: from,
        dataset: tokenIdToAddress(tokenId),
        blockNumber: isReplay ? undefined : event.blockNumber,
      });
    }
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processTransferDataset',
      event,
      isReplay,
    });
  }
};

const processTransferWorkerpool = async (event, { isReplay = false } = {}) => {
  try {
    log(
      'processTransferWorkerpool',
      isReplay ? 'replay' : '',
      event.transactionHash,
    );
    const { from, tokenId } = cleanRPC(event.args);
    if (from !== NULL_ADDRESS) {
      await cleanTransferredWorkerpoolOrders({
        address: from,
        workerpool: tokenIdToAddress(tokenId),
        blockNumber: isReplay ? undefined : event.blockNumber,
      });
    }
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processTransferWorkerpool',
      event,
      isReplay,
    });
  }
};

const processRoleRevoked = async (event, { isReplay = false } = {}) => {
  try {
    log('processRoleRevoked', isReplay ? 'replay' : '', event.transactionHash);
    const { account, role } = cleanRPC(event.args);
    await cleanRevokedUserOrders({
      address: account,
      role,
      blockNumber: isReplay ? undefined : event.blockNumber,
    });
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processRoleRevoked',
      event,
      isReplay,
    });
  }
};

const processNewBlock = async (blockNumber) => {
  try {
    log('Block', blockNumber);
    await updateLastBlock(blockNumber);
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processNewBlock',
      blockNumber,
    });
  }
};

module.exports = {
  processStakeLoss,
  processCreateCategory,
  processTransferApp,
  processTransferDataset,
  processTransferWorkerpool,
  processOrdersMatched,
  processClosedAppOrder,
  processClosedDatasetOrder,
  processClosedWorkerpoolOrder,
  processClosedRequestOrder,
  processRoleRevoked,
  processNewBlock,
};
