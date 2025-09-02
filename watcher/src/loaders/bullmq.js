import { Queue, Worker } from 'bullmq';
import { redis as redisConfig } from '../config.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('bullmq');

// Cache for queues and workers
const queues = new Map();
const workers = new Map();

/**
 * Creates or returns a cached BullMQ Queue instance.
 * Uses Redis for job queuing instead of MongoDB.
 */
const getQueue = (name, options = {}) => {
  if (queues.has(name)) {
    return queues.get(name);
  }

  const queue = new Queue(name, {
    connection: redisConfig,
    defaultJobOptions: {
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 50, // Keep last 50 failed jobs
      attempts: 3, // Retry failed jobs up to 3 times
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    },
    ...options,
  });

  queues.set(name, queue);
  logger.log(`Created queue: ${name}`);
  return queue;
};

/**
 * Creates or returns a cached BullMQ Worker instance.
 */
const getWorker = (name, processor, options = {}) => {
  if (workers.has(name)) {
    return workers.get(name);
  }

  const worker = new Worker(name, processor, {
    connection: redisConfig,
    concurrency: 1, // Process one job at a time
    ...options,
  });

  // Handle worker events
  worker.on('completed', (job) => {
    logger.debug(`Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.warn(`Job ${job.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    logger.error(`Worker error:`, err);
  });

  workers.set(name, worker);
  logger.log(`Created worker: ${name}`);
  return worker;
};

/**
 * Gracefully closes all queues and workers.
 */
const closeAll = async () => {
  logger.log('Closing all BullMQ connections...');

  const closePromises = [];

  // Close all workers
  for (const worker of workers.values()) {
    closePromises.push(worker.close());
  }

  // Close all queues
  for (const queue of queues.values()) {
    closePromises.push(queue.close());
  }

  await Promise.all(closePromises);

  // Clear the caches
  queues.clear();
  workers.clear();

  logger.log('All BullMQ connections closed');
};

/**
 * Clears all jobs from all queues without closing connections.
 * This is useful for testing when you want to reset the state.
 */
const clearAllQueues = async () => {
  logger.log('Clearing all queues...');

  const clearPromises = [];

  for (const queue of queues.values()) {
    clearPromises.push(queue.obliterate({ force: true }));
  }

  await Promise.all(clearPromises);
  logger.log('All queues cleared');
};

export { getQueue, getWorker, closeAll, clearAllQueues };
