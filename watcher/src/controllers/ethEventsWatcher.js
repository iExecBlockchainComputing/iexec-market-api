import { getLogger } from '../utils/logger.js';
import {
  getProvider,
  getHub,
  getAppRegistry,
  getDatasetRegistry,
  getWorkerpoolRegistry,
} from '../loaders/ethereum.js';
import {
  processClosedAppOrder,
  processClosedDatasetOrder,
  processClosedRequestOrder,
  processClosedWorkerpoolOrder,
  processCreateCategory,
  processOrdersMatched,
  processTransferApp,
  processTransferDataset,
  processTransferWorkerpool,
  processStakeLoss,
  processNewBlock,
} from './ethEventsProcessor.js';
import {
  getBlockNumber,
  queryFilter,
  NULL_ADDRESS,
  formatEthersResult,
} from '../utils/eth-utils.js';
import * as config from '../config.js';
import { traceAll } from '../utils/trace.js';

const logger = getLogger('controllers:ethEventsWatcher');

const extractEvent =
  (processCallback) =>
  (...args) => {
    const contractEventPayload = args[args.length - 1];
    return processCallback(contractEventPayload.log);
  };

const _registerNewBlock = () => {
  logger.log('registering block events');
  const provider = getProvider();
  provider.on('block', processNewBlock);
};

const _registerHubEvents = () => {
  logger.log('registering Hub events');
  const hubContract = getHub();
  hubContract.on('CreateCategory', extractEvent(processCreateCategory));
  hubContract.on('OrdersMatched', extractEvent(processOrdersMatched));
  hubContract.on('ClosedAppOrder', extractEvent(processClosedAppOrder));
  hubContract.on('ClosedDatasetOrder', extractEvent(processClosedDatasetOrder));
  hubContract.on(
    'ClosedWorkerpoolOrder',
    extractEvent(processClosedWorkerpoolOrder),
  );
  hubContract.on('ClosedRequestOrder', extractEvent(processClosedRequestOrder));
  hubContract.on('Transfer', extractEvent(processStakeLoss));
};

const _registerAppRegistryEvents = () => {
  logger.log('registering AppRegistry events');
  const appRegistryContract = getAppRegistry();
  appRegistryContract.on('Transfer', extractEvent(processTransferApp));
};

const _registerDatasetRegistryEvents = () => {
  logger.log('registering DatasetRegistry events');
  const datasetRegistryContract = getDatasetRegistry();
  datasetRegistryContract.on('Transfer', extractEvent(processTransferDataset));
};

const _registerWorkerpoolRegistryEvents = () => {
  logger.log('registering WorkerpoolRegistry events');
  const workerpoolRegistryContract = getWorkerpoolRegistry();
  workerpoolRegistryContract.on(
    'Transfer',
    extractEvent(processTransferWorkerpool),
  );
};

const unsubscribeHubEvents = () => {
  logger.log('unsubscribe Hub events');
  getHub().removeAllListeners();
};

const unsubscribeAppRegistryEvents = () => {
  logger.log('unsubscribe AppRegistry events');
  getAppRegistry().removeAllListeners();
};

const unsubscribeDatasetRegistryEvents = () => {
  logger.log('unsubscribe DatasetRegistry events');
  getDatasetRegistry().removeAllListeners();
};

const unsubscribeWorkerpoolRegistryEvents = () => {
  logger.log('unsubscribe WorkerpoolRegistry events');
  getWorkerpoolRegistry().removeAllListeners();
};

const _unsubscribeAllEvents = () => {
  unsubscribeHubEvents();
  unsubscribeAppRegistryEvents();
  unsubscribeDatasetRegistryEvents();
  unsubscribeWorkerpoolRegistryEvents();
  getProvider().removeAllListeners();
};

const getContractPastEvent = async (
  contract,
  eventName,
  { fromBlock = config.runtime.startBlock, toBlock = 'latest' } = {},
) => {
  try {
    return await queryFilter(contract, [eventName, fromBlock, toBlock]);
  } catch (error) {
    logger.warn(`getContractPastEvent() ${eventName}`, error);
    throw error;
  }
};

const replayPastEventBatch = traceAll(
  // eslint-disable-next-line prefer-arrow-callback
  async function _replayPastEventBatch({
    fromBlock,
    toBlock,
    handleIndexedBlock,
  }) {
    logger.log('replay batch from block', fromBlock, 'to block', toBlock);

    const hubContract = getHub();
    const appRegistryContract = getAppRegistry();
    const datasetRegistryContract = getDatasetRegistry();
    const workerpoolRegistryContract = getWorkerpoolRegistry();

    const [
      transferAppEvents,
      transferDatasetEvents,
      transferWorkerpoolEvents,
      createCategoryEvents,
      transferStakeEvents,
      ordersMatchedEvents,
      closedAppOrderEvents,
      closedDatasetOrderEvents,
      closedWorkerpoolOrderEvents,
      closedRequestOrderEvents,
    ] = await Promise.all([
      getContractPastEvent(appRegistryContract, 'Transfer', {
        fromBlock,
        toBlock,
      }),
      getContractPastEvent(datasetRegistryContract, 'Transfer', {
        fromBlock,
        toBlock,
      }),
      getContractPastEvent(workerpoolRegistryContract, 'Transfer', {
        fromBlock,
        toBlock,
      }),
      getContractPastEvent(hubContract, 'CreateCategory', {
        fromBlock,
        toBlock,
      }),
      getContractPastEvent(hubContract, 'Transfer', {
        fromBlock,
        toBlock,
      }),
      getContractPastEvent(hubContract, 'OrdersMatched', {
        fromBlock,
        toBlock,
      }),
      getContractPastEvent(hubContract, 'ClosedAppOrder', {
        fromBlock,
        toBlock,
      }),
      getContractPastEvent(hubContract, 'ClosedDatasetOrder', {
        fromBlock,
        toBlock,
      }),
      getContractPastEvent(hubContract, 'ClosedWorkerpoolOrder', {
        fromBlock,
        toBlock,
      }),
      getContractPastEvent(hubContract, 'ClosedRequestOrder', {
        fromBlock,
        toBlock,
      }),
    ]);

    const eventsArray = transferAppEvents
      .map((e) => ({ event: e, process: processTransferApp }))
      .concat(
        transferDatasetEvents.map((e) => ({
          event: e,
          process: processTransferDataset,
        })),
      )
      .concat(
        transferWorkerpoolEvents.map((e) => ({
          event: e,
          process: processTransferWorkerpool,
        })),
      )
      .concat(
        createCategoryEvents.map((e) => ({
          event: e,
          process: processCreateCategory,
        })),
      )
      .concat(
        transferStakeEvents
          .filter((e) => {
            // filter mint & no value
            const { from, value } = formatEthersResult(e.args);
            return from !== NULL_ADDRESS && value !== 0n;
          })
          .reduce((acc, curr) => {
            // filter unique addresses
            const { from } = curr.args;
            const collectedEvent = acc.find((e) => e.args.from === from);
            if (!collectedEvent) acc.push(curr);
            return acc;
          }, [])
          .map((e) => ({
            event: e,
            process: processStakeLoss,
          })),
      )
      .concat(
        ordersMatchedEvents.map((e) => ({
          event: e,
          process: processOrdersMatched,
        })),
      )
      .concat(
        closedAppOrderEvents.map((e) => ({
          event: e,
          process: processClosedAppOrder,
        })),
      )
      .concat(
        closedDatasetOrderEvents.map((e) => ({
          event: e,
          process: processClosedDatasetOrder,
        })),
      )
      .concat(
        closedWorkerpoolOrderEvents.map((e) => ({
          event: e,
          process: processClosedWorkerpoolOrder,
        })),
      )
      .concat(
        closedRequestOrderEvents.map((e) => ({
          event: e,
          process: processClosedRequestOrder,
        })),
      );

    logger.log('batch events count', eventsArray.length);

    const EVENTS_BATCH_SIZE = 200;

    const processEvents = async (eventsToProcess, i = 0) => {
      await Promise.all(
        eventsToProcess
          .slice(0, EVENTS_BATCH_SIZE - 1)
          .map((e) => e.process(e.event, { isReplay: true })),
      );
      const remainingEvents = eventsToProcess.slice(EVENTS_BATCH_SIZE - 1);
      return (
        remainingEvents.length > 0 && processEvents(remainingEvents, i + 1)
      );
    };

    await processEvents(eventsArray);

    if (typeof handleIndexedBlock === 'function') {
      await handleIndexedBlock(toBlock);
    }
    return eventsArray.length;
  },
  { logger },
);

const recursiveReplayPastEventBatch = traceAll(
  async function _recursiveReplayPastEventBatch(
    firstBlock,
    lastBlock,
    { processedCount = 0, handleIndexedBlock } = {},
  ) {
    const fromBlock = firstBlock;
    const last =
      lastBlock === 'latest' ? await getBlockNumber(getProvider()) : lastBlock;

    let toBlock;
    let iterate;
    if (
      config.runtime.blocksBatchSize > 0 &&
      last - fromBlock > config.runtime.blocksBatchSize
    ) {
      toBlock = fromBlock + config.runtime.blocksBatchSize - 1;
      iterate = true;
    } else {
      toBlock = last;
      iterate = false;
    }

    const processedEvents = await replayPastEventBatch({
      fromBlock,
      toBlock,
      handleIndexedBlock,
    });
    const processed = processedCount + processedEvents;
    if (iterate) {
      return _recursiveReplayPastEventBatch(toBlock + 1, lastBlock, {
        processedCount: processed,
        handleIndexedBlock,
      });
    }
    return processed;
  },
  { logger },
);

const _replayPastEvents = async (
  startingBlockNumber,
  {
    lastBlockNumber = 'latest',
    handleIndexedBlock = () => Promise.resolve(),
  } = {},
) => {
  try {
    logger.log(
      'replaying events from block',
      startingBlockNumber,
      'to block',
      lastBlockNumber,
    );
    const currentBlock = await getBlockNumber(getProvider());
    if (startingBlockNumber > currentBlock) {
      logger.log('no new block');
      return;
    }
    const eventsCount = await recursiveReplayPastEventBatch(
      startingBlockNumber,
      lastBlockNumber,
      {
        handleIndexedBlock,
        batch: config.runtime.blocksBatchSize,
      },
    );
    logger.log(
      'replayed events from block',
      startingBlockNumber,
      'to block',
      lastBlockNumber,
      'events count',
      eventsCount,
    );
  } catch (error) {
    logger.warn('replayPastEvents()', error);
    throw error;
  }
};

const registerNewBlock = traceAll(_registerNewBlock, { logger });
const registerHubEvents = traceAll(_registerHubEvents, { logger });
const registerAppRegistryEvents = traceAll(_registerAppRegistryEvents, {
  logger,
});
const registerDatasetRegistryEvents = traceAll(_registerDatasetRegistryEvents, {
  logger,
});
const registerWorkerpoolRegistryEvents = traceAll(
  _registerWorkerpoolRegistryEvents,
  {
    logger,
  },
);
const unsubscribeAllEvents = traceAll(_unsubscribeAllEvents, { logger });
const replayPastEvents = traceAll(_replayPastEvents, { logger });

export {
  registerNewBlock,
  registerHubEvents,
  registerAppRegistryEvents,
  registerDatasetRegistryEvents,
  registerWorkerpoolRegistryEvents,
  unsubscribeAllEvents,
  replayPastEvents,
};
