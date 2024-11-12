import { setLastBlock } from '../services/counter.js';
import { addCategory } from '../services/category.js';
import { addDeal } from '../services/deal.js';
import {
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
} from '../services/order.js';
import { tokenIdToAddress } from '../utils/iexec-utils.js';
import { NULL_ADDRESS, cleanRPC } from '../utils/eth-utils.js';
import { errorHandler } from '../utils/error.js';
import { getLogger } from '../utils/logger.js';
import { traceAll } from '../utils/trace.js';

const logger = getLogger('controllers:ethEventsProcessor');

const _processCreateCategory = async (event, { isReplay = false } = {}) => {
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

const _processOrdersMatched = async (event, { isReplay = false } = {}) => {
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

const _processClosedAppOrder = async (event, { isReplay = false } = {}) => {
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

const _processClosedDatasetOrder = async (event, { isReplay = false } = {}) => {
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

const _processClosedWorkerpoolOrder = async (
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

const _processClosedRequestOrder = async (event, { isReplay = false } = {}) => {
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

const _processStakeLoss = async (event, { isReplay = false } = {}) => {
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

const _processTransferApp = async (event, { isReplay = false } = {}) => {
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

const _processTransferDataset = async (event, { isReplay = false } = {}) => {
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

const _processTransferWorkerpool = async (event, { isReplay = false } = {}) => {
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

const _processRoleRevoked = async (event, { isReplay = false } = {}) => {
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

const _processNewBlock = async (blockNumber) => {
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

const processStakeLoss = traceAll(_processStakeLoss, { logger });
const processCreateCategory = traceAll(_processCreateCategory, { logger });
const processTransferApp = traceAll(_processTransferApp, { logger });
const processTransferDataset = traceAll(_processTransferDataset, { logger });
const processTransferWorkerpool = traceAll(_processTransferWorkerpool, {
  logger,
});
const processOrdersMatched = traceAll(_processOrdersMatched, { logger });
const processClosedAppOrder = traceAll(_processClosedAppOrder, { logger });
const processClosedDatasetOrder = traceAll(_processClosedDatasetOrder, {
  logger,
});
const processClosedWorkerpoolOrder = traceAll(_processClosedWorkerpoolOrder, {
  logger,
});
const processClosedRequestOrder = traceAll(_processClosedRequestOrder, {
  logger,
});
const processRoleRevoked = traceAll(_processRoleRevoked, { logger });
const processNewBlock = traceAll(_processNewBlock, { logger });

export {
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
