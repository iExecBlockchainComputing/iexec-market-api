const Agenda = require('agenda');
const config = require('../config');
const { getMongoose } = require('./mongoose');
const { getLogger } = require('../utils/logger');

const { chainId } = config.chain;

const logger = getLogger('agenda');

let agendaPromise;

const getAgenda = async () => {
  if (agendaPromise) {
    return agendaPromise;
  }
  agendaPromise = new Promise((resolve, reject) => {
    logger.log('connecting');
    getMongoose({ db: `${chainId}_jobs` })
      .then(async (mongooseConnection) => {
        const { db } = mongooseConnection;
        const agenda = new Agenda({ mongo: db });
        logger.log('starting worker');
        agenda
          .start()
          .then(() => {
            logger.log('running');
            resolve(agenda);
          })
          .catch((e) => {
            logger.log('start failed', e);
            reject(e);
          });
      })
      .catch((e) => reject(e));
  });
  return agendaPromise;
};

module.exports = {
  getAgenda,
};
