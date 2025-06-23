import mongoose from 'mongoose';
import * as config from '../config.js';
import { getLogger } from '../utils/logger.js';
import { traceAll } from '../utils/trace.js';

const mongoConfig = config.mongo;
const logger = getLogger('mongoose');

const mongooseConnections = {};

/**
 * Connects to a MongoDB instance and returns a Mongoose connection.
 *
 * Mongoose v8 Notes:
 * - `bufferCommands: false` disables legacy buffering behavior.
 * - `createConnection()` is preferred over `connect()` for scoped, multi-db setups.
 * - This loader reuses existing connections per `server + db` pair.
 */
const _getMongoose = async ({ server = mongoConfig.host, db } = {}) => {
  try {
    if (!db) throw new Error('missing db name');

    if (mongooseConnections[server]?.[db]) {
      logger.debug(`reusing connection ${server}${db}`);
      return mongooseConnections[server][db];
    }

    logger.log(`creating connection ${server}${db}`);
    mongooseConnections[server] = mongooseConnections[server] || {};

    const uri = `${server}${db}`;
    const connection = mongoose.createConnection(uri, {
      autoIndex: mongoConfig.createIndex || false,
      bufferCommands: false, // ⛔ Disable buffering (required in Mongoose 8+)
    });

    mongooseConnections[server][db] = connection;

    await connection.asPromise();
    logger.log(`opened connection ${server}${db}`);

    return connection;
  } catch (error) {
    logger.warn('getMongoose() failed', error);
    throw error;
  }
};

const getMongoose = traceAll(_getMongoose, { logger });

export { getMongoose };
