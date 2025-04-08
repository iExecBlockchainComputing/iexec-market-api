import * as config from '../config.js';
import { getAgenda } from '../loaders/agenda.js';
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

const { chainId } = config.chain;
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
  const agenda = await getAgenda(chainId);
  agenda.define(
    EVENT_REPLAY_JOB,
    { lockLifetime: 10 * 60 * 1000 },
    async (job) => {
      try {
        await _replayPastOnly({
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

const replayPastOnly = traceAll(_replayPastOnly, { logger });

export { replayPastOnly, startReplayer, stopReplayer };
