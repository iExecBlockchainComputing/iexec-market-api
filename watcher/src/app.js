import './controllers/eventsListener.js';
import * as config from './config.js';
import * as ethereum from './loaders/ethereum.js';
import * as socket from './loaders/socket.js';
import {
  registerHubEvents,
  registerAppRegistryEvents,
  registerDatasetRegistryEvents,
  registerWorkerpoolRegistryEvents,
  registerERlcEvents,
  registerNewBlock,
  unsubscribeAllEvents,
  replayPastEvents,
} from './controllers/ethEventsWatcher.js';
import {
  startSyncWatcher,
  stopSyncWatcher,
} from './controllers/syncWatcher.js';
import { startReplayer, stopReplayer } from './controllers/replayer.js';
import { getNextBlockToProcess, setLastBlock } from './services/counter.js';
import { getLogger, APP_NAMESPACE } from './utils/logger.js';
import { errorHandler } from './utils/error.js';

const logger = getLogger(APP_NAMESPACE);

const { wsHost, httpHost, chainId, hubAddress } = config.chain;
if (!chainId) throw Error('missing chainId');
if (!wsHost) throw Error('missing wsHost');
if (!httpHost) throw Error('missing httpHost');
if (!hubAddress) throw Error('missing hubAddress');

socket.init();

const start = async ({ replayer = true, syncWatcher = true } = {}) => {
  try {
    logger.log('STARTING WATCHER...');
    await stopReplayer();
    await stopSyncWatcher();

    logger.log('connecting ethereum node');
    await ethereum.init();
    logger.log('ethereum node connected');

    if (replayer) {
      logger.log('starting event replayer...');
      await startReplayer();
      logger.log('event replayer started');
    } else {
      logger.log('skip starting replayer');
    }

    logger.log('checking last block seen...');
    const startBlock = await getNextBlockToProcess();
    logger.log('got last block');

    logger.log(
      `start replaying past events from block ${startBlock} to latest...`,
    );
    await replayPastEvents(startBlock, {
      handleIndexedBlock: setLastBlock,
    });
    logger.log(`replayed past events from block ${startBlock} to latest`);

    logger.log('starting new events listeners...');
    registerHubEvents();
    registerERlcEvents();
    registerAppRegistryEvents();
    registerDatasetRegistryEvents();
    registerWorkerpoolRegistryEvents();
    registerNewBlock();
    logger.log('listening to new events');

    if (syncWatcher) {
      logger.log('starting sync watcher...');
      await startSyncWatcher();
      logger.log('sync watcher started');
    } else {
      logger.log('skip starting sync watcher');
    }

    logger.log('WATCHER SUCCESSFULLY STARTED');
  } catch (error) {
    errorHandler(error, {
      type: 'start-watcher',
      replayer,
      syncWatcher,
      critical: true,
    });
  }
};

const stop = async () => {
  try {
    logger.log('STOPPING...');
    await Promise.all([stopSyncWatcher(), stopReplayer()]);
    unsubscribeAllEvents();
    logger.log('STOPPED');
  } catch (error) {
    errorHandler(error, {
      type: 'stop-watcher',
    });
    throw error;
  }
};

export { stop, start };
