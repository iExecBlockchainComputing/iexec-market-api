const mongoose = require('mongoose');
const mongoConfig = require('../config').mongo;
const { getLogger } = require('../utils/logger');
const { traceAll } = require('../utils/trace');

const logger = getLogger('mongoose');

const mongooseConnections = {};

const getMongoose = async ({ server = mongoConfig.host, db } = {}) => {
  try {
    if (db === undefined) {
      throw Error('missing db name');
    }
    if (mongooseConnections[server] && mongooseConnections[server][db]) {
      logger.debug(`reusing connection ${server}${db}`);
      const connection = await mongooseConnections[server][db];
      return connection;
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
    logger.log('getMongoose', error);
    throw error;
  }
};

module.exports = {
  getMongoose: traceAll(getMongoose, { logger }),
};
