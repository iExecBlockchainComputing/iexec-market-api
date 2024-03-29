const config = require('../config');
const { getAgenda } = require('../loaders/agenda');
const ethereum = require('../loaders/ethereum');
const { replayPastEvents } = require('./ethEventsWatcher');
const {
  getCheckpointBlock,
  setCheckpointBlock,
  getLastBlock,
} = require('../services/counter');
const { getLogger } = require('../utils/logger');
const { getBlockNumber } = require('../utils/eth-utils');
const { errorHandler } = require('../utils/error');
const { traceAll } = require('../utils/trace');

const { chainId } = config.chain;
const { replayInterval } = config.runtime;

const logger = getLogger('controllers:replayer');

const EVENT_REPLAY_JOB = 'replay-past-events';

const replayPastOnly = async ({
  nbConfirmation = 10,
  handleIndexedBlock = setCheckpointBlock,
} = {}) => {
  try {
    const [currentCheckpoint, lastIndexedBlock, currentBlock] =
      await Promise.all([
        getCheckpointBlock(),
        getLastBlock(),
        getBlockNumber(ethereum.getProvider()),
      ]);
    logger.log(
      'current block:',
      currentBlock,
      'current checkpoint:',
      currentCheckpoint,
    );
    const nextCheckpoint = Math.min(
      currentBlock - nbConfirmation,
      lastIndexedBlock,
    );
    logger.log('next checkpoint:', nextCheckpoint);
    if (nextCheckpoint > currentCheckpoint) {
      logger.log(
        `checking past events from block ${currentCheckpoint} to ${nextCheckpoint}`,
      );
      await replayPastEvents(currentCheckpoint, {
        lastBlockNumber: nextCheckpoint,
        handleIndexedBlock,
      });
    } else {
      logger.log('nothing to replay skipping');
    }
    return;
  } catch (error) {
    logger.warn('replayPastOnly()', error);
    throw error;
  }
};

const startReplayer = async () => {
  const agenda = await getAgenda(chainId);
  agenda.define(
    EVENT_REPLAY_JOB,
    { lockLifetime: 10 * 60 * 1000 },
    async (job) => {
      try {
        await replayPastOnly({
          handleIndexedBlock: async (blockNumber) => {
            await setCheckpointBlock(blockNumber);
            // reset job lock after every iteration
            await job.touch();
          },
        });
      } catch (error) {
        errorHandler(error, { type: 'replay-job' });
        throw error;
      }
    },
  );
  await agenda.every(`${replayInterval} seconds`, EVENT_REPLAY_JOB);
  logger.log(
    `${EVENT_REPLAY_JOB} jobs added (run every ${replayInterval} seconds)`,
  );
};

const stopReplayer = async () => {
  const agenda = await getAgenda(chainId);
  await agenda.cancel({ name: EVENT_REPLAY_JOB });
};

module.exports = {
  replayPastOnly: traceAll(replayPastOnly, { logger }),
  startReplayer,
  stopReplayer,
};
