const config = require('./config');
const ethereum = require('./loaders/ethereum');
const socket = require('./loaders/socket');
require('./controllers/eventsListener');
const {
  registerHubEvents,
  registerAppRegistryEvents,
  registerDatasetRegistryEvents,
  registerWorkerpoolRegistryEvents,
  registerERlcEvents,
  registerNewBlock,
  unsubscribeAllEvents,
  replayPastEvents,
} = require('./controllers/ethEventsWatcher');
const {
  startSyncWatcher,
  stopSyncWatcher,
} = require('./controllers/syncWatcher');
const { startReplayer, stopReplayer } = require('./controllers/replayer');
const { getNextBlockToProcess, setLastBlock } = require('./services/counter');
const { getLogger, APP_NAMESPACE } = require('./utils/logger');
const { errorHandler } = require('./utils/error');

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

    await ethereum.init(() => {
      logger.log('restarting on ethereum connection lost');
      start();
    });
    logger.log('done');

    if (replayer) {
      logger.log('starting event replayer...');
      await startReplayer();
      logger.log('done');
    }

    logger.log('checking last block seen');
    const startBlock = await getNextBlockToProcess();
    logger.log('done');

    logger.log(`replaying past events from block ${startBlock} to latest...`);
    await replayPastEvents(startBlock, {
      handleIndexedBlock: setLastBlock,
    });
    logger.log('done');

    logger.log('starting listening to new events...');
    registerHubEvents();
    registerERlcEvents();
    registerAppRegistryEvents();
    registerDatasetRegistryEvents();
    registerWorkerpoolRegistryEvents();
    registerNewBlock();
    logger.log('done');

    if (syncWatcher) {
      logger.log('starting sync watcher...');
      await startSyncWatcher();
      logger.log('done');
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

module.exports = {
  stop,
  start,
};
