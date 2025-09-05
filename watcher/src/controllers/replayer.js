import * as config from '../config.js';
import { getQueue, getWorker } from '../loaders/bullmq.js';
import * as ethereum from '../loaders/ethereum.js';
import { replayPastEvents } from './ethEventsWatcher.js';
import {
  getCheckpointBlock,
  setCheckpointBlock,
  getLastBlock,
} from '../services/counter.js';
import { getLogger } from '../utils/logger.js';
import { getBlockNumber } from '../utils/eth-utils.js';
import { errorHandler } from '../utils/error.js';
import { traceAll } from '../utils/trace.js';

const { replayInterval } = config.runtime;

const logger = getLogger('controllers:replayer');

const EVENT_REPLAY_JOB = 'replay-past-events';

const _replayPastOnly = async ({
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
  } catch (error) {
    logger.warn('replayPastOnly()', error);
    throw error;
  }
};

const startReplayer = async () => {
  const queue = getQueue(EVENT_REPLAY_JOB);

  // Create worker to process jobs
  getWorker(EVENT_REPLAY_JOB, async (job) => {
    try {
      await _replayPastOnly({
        handleIndexedBlock: async (blockNumber) => {
          await setCheckpointBlock(blockNumber);
        },
      });
    } catch (error) {
      errorHandler(error, { type: 'replay-job' });
      throw error;
    }
  });

  // Schedule recurring job
  await queue.add(
    EVENT_REPLAY_JOB,
    {},
    {
      repeat: {
        every: replayInterval * 1000, // Convert seconds to milliseconds
      },
    },
  );

  logger.log(
    `${EVENT_REPLAY_JOB} jobs added (run every ${replayInterval} seconds)`,
  );
};

const stopReplayer = async () => {
  // Clear the specific queue instead of obliterating
  const queue = getQueue(EVENT_REPLAY_JOB);
  await queue.obliterate({ force: true });
  logger.log(`Stopped ${EVENT_REPLAY_JOB} jobs`);
};

const replayPastOnly = traceAll(_replayPastOnly, { logger });

export { replayPastOnly, startReplayer, stopReplayer };
