import mongoose from 'mongoose';
import { mongo as mongoConfig } from '../config.js';
import { logger } from '../utils/logger.js';

const log = logger.extend('mongoose');

const mongooseConnections = {};

const getMongoose = async ({ server = mongoConfig.host, db } = {}) => {
  try {
    if (db === undefined) {
      throw Error('missing db name');
    }
    if (mongooseConnections[server] && mongooseConnections[server][db]) {
      log(`using connection ${server}${db}`);
      const connection = await mongooseConnections[server][db];
      return connection;
    }
    log(`creating connection ${server}${db}`);
    mongooseConnections[server] = mongooseConnections[server] || {};
    mongooseConnections[server][db] = mongoose
      .createConnection(`${server}${db}`, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        autoIndex: mongoConfig.createIndex || false,
      })
      .asPromise();
    const connection = await mongooseConnections[server][db];
    log(`opened connection ${server}${db}`);
    return connection;
  } catch (error) {
    log('getMongoose', error);
    throw error;
  }
};

export { getMongoose };
