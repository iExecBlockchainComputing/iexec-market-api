const config = require('../config');
const { getAgenda } = require('../loaders/agenda');
const ethereum = require('../loaders/ethereum');
const { replayPastEvents } = require('../controllers/ethEventsWatcher');
const {
  getCheckpointBlock,
  setCheckpointBlock,
} = require('../services/counter');
const { logger } = require('../utils/logger');
const { getBlockNumber } = require('../utils/eth-utils');
const { errorHandler } = require('../utils/error');

const { chainId } = config.chain;
const { replayInterval } = config.runtime;

const log = logger.extend('controllers:replayer');

const EVENT_REPLAY_JOB = 'replay-past-events';

const replayPastOnly = async ({ nbConfirmation = 10 } = {}) => {
  try {
    const [currentCheckpoint, currentBlock] = await Promise.all([
      getCheckpointBlock(),
      getBlockNumber(ethereum.getProvider()),
    ]);
    log(
      'current block:',
      currentBlock,
      'current checkpoint:',
      currentCheckpoint,
    );
    const nextCheckpoint = currentBlock - nbConfirmation;
    log('next checkpoint:', nextCheckpoint);
    if (nextCheckpoint > currentCheckpoint) {
      await replayPastEvents(currentCheckpoint, nextCheckpoint);
      await setCheckpointBlock(nextCheckpoint);
    } else {
      log('nothing to replay skipping');
    }
    return;
  } catch (error) {
    log('replayPastOnly()', error);
    throw error;
  }
};

const startReplayer = async () => {
  const agenda = await getAgenda(chainId);
  agenda.define(
    EVENT_REPLAY_JOB,
    { lockLifetime: 10 * 60 * 1000 },
    async () => {
      try {
        await replayPastOnly();
      } catch (error) {
        errorHandler(error, { type: 'replay-job' });
        throw error;
      }
    },
  );
  await agenda.every(`${replayInterval} seconds`, EVENT_REPLAY_JOB);
  log(`${EVENT_REPLAY_JOB} jobs added (run every ${replayInterval} seconds)`);
};

const stopReplayer = async () => {
  const agenda = await getAgenda(chainId);
  await agenda.cancel({ name: EVENT_REPLAY_JOB });
};

module.exports = { replayPastOnly, startReplayer, stopReplayer };
