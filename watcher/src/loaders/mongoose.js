import mongoose from 'mongoose';
import * as config from '../config.js';
import { getLogger } from '../utils/logger.js';
import { traceAll } from '../utils/trace.js';

const mongoConfig = config.mongo;
const logger = getLogger('mongoose');

const mongooseConnections = {};

const _getMongoose = async ({ server = mongoConfig.host, db } = {}) => {
  try {
    if (db === undefined) {
      throw Error('missing db name');
    }
    if (mongooseConnections[server] && mongooseConnections[server][db]) {
      logger.debug(`reusing connection ${server}${db}`);
      return await mongooseConnections[server][db];
    }
    logger.log(`creating connection ${server}${db}`);
    mongooseConnections[server] = mongooseConnections[server] || {};
    mongooseConnections[server][db] = mongoose
      .createConnection(`${server}${db}`, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        autoIndex: mongoConfig.createIndex || false,
      })
      .asPromise();
    const connection = await mongooseConnections[server][db];
    logger.log(`opened connection ${server}${db}`);
    return connection;
  } catch (error) {
    logger.warn('getMongoose', error);
    throw error;
  }
};

const getMongoose = traceAll(_getMongoose, { logger });

export { getMongoose };
