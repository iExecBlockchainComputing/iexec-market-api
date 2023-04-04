const { setLastBlock } = require('../services/counter');
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
const { getLogger } = require('../utils/logger');
const { traceAll } = require('../utils/trace');

const logger = getLogger('controllers:ethEventsProcessor');

const processCreateCategory = async (event, { isReplay = false } = {}) => {
  try {
    const { transactionHash, blockNumber } = event;
    logger.debug(
      'processCreateCategory',
      isReplay ? 'replay' : '',
      transactionHash,
    );
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
    logger.debug(
      'processOrdersMatched',
      isReplay ? 'replay' : '',
      transactionHash,
    );
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
    logger.debug(
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
    logger.debug(
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
    logger.debug(
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
    logger.debug(
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
    logger.debug(
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
    logger.debug(
      'processTransferApp',
      isReplay ? 'replay' : '',
      event.transactionHash,
    );
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
    logger.debug(
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
    logger.debug(
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
    logger.debug(
      'processRoleRevoked',
      isReplay ? 'replay' : '',
      event.transactionHash,
    );
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
    logger.debug('Block', blockNumber);
    await setLastBlock(blockNumber);
  } catch (error) {
    errorHandler(error, {
      type: 'process-event',
      function: 'processNewBlock',
      blockNumber,
    });
  }
};

module.exports = {
  processStakeLoss: traceAll(processStakeLoss, { logger }),
  processCreateCategory: traceAll(processCreateCategory, { logger }),
  processTransferApp: traceAll(processTransferApp, { logger }),
  processTransferDataset: traceAll(processTransferDataset, { logger }),
  processTransferWorkerpool: traceAll(processTransferWorkerpool, { logger }),
  processOrdersMatched: traceAll(processOrdersMatched, { logger }),
  processClosedAppOrder: traceAll(processClosedAppOrder, { logger }),
  processClosedDatasetOrder: traceAll(processClosedDatasetOrder, { logger }),
  processClosedWorkerpoolOrder: traceAll(processClosedWorkerpoolOrder, {
    logger,
  }),
  processClosedRequestOrder: traceAll(processClosedRequestOrder, { logger }),
  processRoleRevoked: traceAll(processRoleRevoked, { logger }),
  processNewBlock: traceAll(processNewBlock, { logger }),
};
