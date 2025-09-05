import * as config from '../config.js';
import { getQueue, getWorker } from '../loaders/bullmq.js';
import { getProvider, getRpcProvider } from '../loaders/ethereum.js';
import { getLogger } from '../utils/logger.js';
import { sleep } from '../utils/utils.js';
import { errorHandler } from '../utils/error.js';
import { getBlockNumber } from '../utils/eth-utils.js';

const { checkSyncInterval } = config.runtime;

const logger = getLogger('controllers:syncWatcher');

const SYNC_WATCHER_JOB = 'watch-eth-node';

const MAX_ERROR_COUNT = 3;

const checkSync = async () => {
  let errorCount = 0;
  let isSync = false;
  await sleep(config.runtime.syncWatcherInterval);
  while (!isSync && errorCount < MAX_ERROR_COUNT) {
    try {
      const wsProvider = getProvider();
      const rpcProvider = getRpcProvider();
      const [rpcBlock, wsBlock] = await Promise.all([
        getBlockNumber(wsProvider),
        getBlockNumber(rpcProvider),
      ]);
      logger.debug('Sync - RPC:', rpcBlock, 'WS:', wsBlock);
      if (
        rpcBlock > wsBlock + config.runtime.outOfSyncThreshold ||
        wsBlock > rpcBlock + config.runtime.outOfSyncThreshold
      ) {
        errorHandler(
          Error(
            `Ethereum node out of sync! (RPC blockNumber: ${rpcBlock} - WS blockNumber: ${wsBlock})`,
          ),
          { type: 'out-of-sync', critical: true },
        );
      }
      isSync = true;
    } catch (error) {
      errorCount += 1;
      logger.debug(`syncWatcher() (${errorCount} error)`, error);
      if (errorCount >= MAX_ERROR_COUNT) {
        logger.warn(`syncWatcher() max error reached (${MAX_ERROR_COUNT})`);
        errorHandler(error, {
          type: 'too-much-sync-error',
          errorCount,
          critical: true,
        });
      }
      await sleep(5000);
    }
  }
};

const startSyncWatcher = async () => {
  const queue = getQueue(SYNC_WATCHER_JOB);

  // Create worker to process jobs
  getWorker(SYNC_WATCHER_JOB, checkSync);

  // Schedule recurring job
  await queue.add(
    SYNC_WATCHER_JOB,
    {},
    {
      repeat: {
        every: checkSyncInterval * 1000, // Convert seconds to milliseconds
      },
    },
  );

  logger.log(
    `${SYNC_WATCHER_JOB} jobs added (run every ${checkSyncInterval} seconds)`,
  );
};

const stopSyncWatcher = async () => {
  // Clear the specific queue instead of obliterating
  const queue = getQueue(SYNC_WATCHER_JOB);
  await queue.obliterate({ force: true });
  logger.log(`Stopped ${SYNC_WATCHER_JOB} jobs`);
};

export { startSyncWatcher, stopSyncWatcher };
