const Agenda = require('agenda');
const config = require('../config');
const { getMongoose } = require('./mongoose');
const { logger } = require('../utils/logger');

const { chainId } = config.chain;

const log = logger.extend('agenda');

let agendaPromise;

const getAgenda = async () => {
  if (agendaPromise) {
    return agendaPromise;
  }
  agendaPromise = new Promise((resolve, reject) => {
    log('connecting');
    getMongoose({ db: `${chainId}_jobs` })
      .then(async (mongooseConnection) => {
        const { db } = mongooseConnection;
        const agenda = new Agenda({ mongo: db });
        log('starting worker');
        agenda
          .start()
          .then(() => {
            log('running');
            resolve(agenda);
          })
          .catch((e) => {
            log('start failed', e);
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
