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
const { getNextBlockToProcess } = require('./services/counter');
const { logger } = require('./utils/logger');
const { errorHandler } = require('./utils/error');

const log = logger.extend('app');

const { wsHost, httpHost, chainId, hubAddress } = config.chain;
if (!chainId) throw Error('missing chainId');
if (!wsHost) throw Error('missing wsHost');
if (!httpHost) throw Error('missing httpHost');
if (!hubAddress) throw Error('missing hubAddress');

socket.init();

const start = async ({ replayer = true, syncWatcher = true } = {}) => {
  try {
    log('STARTING WATCHER...');
    await stopReplayer();
    await stopSyncWatcher();
    log('connecting ethereum node');

    await ethereum.init(() => {
      log('restarting on ethereum connection lost');
      start();
    });
    log('done');

    log('checking last block seen');
    const startBlock = await getNextBlockToProcess();
    log('done');

    log(`replaying past events from block ${startBlock} to latest...`);
    await replayPastEvents(startBlock);
    log('done');

    log('starting listening to new events...');
    registerHubEvents();
    registerERlcEvents();
    registerAppRegistryEvents();
    registerDatasetRegistryEvents();
    registerWorkerpoolRegistryEvents();
    registerNewBlock();
    log('done');

    if (syncWatcher) {
      log('starting sync watcher...');
      await startSyncWatcher();
      log('done');
    }
    if (replayer) {
      log('starting event replayer...');
      await startReplayer();
      log('done');
    }
    log('WATCHER SUCCESSFULLY STARTED');
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
    log('STOPPING...');
    await Promise.all([stopSyncWatcher(), stopReplayer()]);
    unsubscribeAllEvents();
    log('STOPPED');
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
