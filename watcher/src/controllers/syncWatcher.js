import * as config from '../config.js';
import { getAgenda } from '../loaders/agenda.js';
import { getProvider, getRpcProvider } from '../loaders/ethereum.js';
import { getLogger } from '../utils/logger.js';
import { sleep } from '../utils/utils.js';
import { errorHandler } from '../utils/error.js';
import { getBlockNumber } from '../utils/eth-utils.js';

const { chainId } = config.chain;
const { checkSyncInterval } = config.runtime;

const logger = getLogger('controllers:syncWatcher');

const SYNC_WATCHER_JOB = 'watch-eth-node';

const MAX_ERROR_COUNT = 3;

const checkSync = () => async () => {
  let errorCount = 0;
  let isSync = false;
  await sleep(config.runtime.syncWatcherInterval);
  while (!isSync && errorCount < MAX_ERROR_COUNT) {
    try {
      const wsProvider = getProvider();
      const rpcProvider = getRpcProvider();
      // eslint-disable-next-line no-await-in-loop
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
      // eslint-disable-next-line no-await-in-loop
      await sleep(5000);
    }
  }
};

const startSyncWatcher = async () => {
  const agenda = await getAgenda(chainId);
  agenda.define(SYNC_WATCHER_JOB, { lockLifetime: 16000 }, checkSync());
  await agenda.every(`${checkSyncInterval} seconds`, SYNC_WATCHER_JOB);
  logger.log(
    `${SYNC_WATCHER_JOB} jobs added (run every ${checkSyncInterval} seconds)`,
  );
};

const stopSyncWatcher = async () => {
  const agenda = await getAgenda(chainId);
  await agenda.cancel({ name: SYNC_WATCHER_JOB });
};

export { startSyncWatcher, stopSyncWatcher };
