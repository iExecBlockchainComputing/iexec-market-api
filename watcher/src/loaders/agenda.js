const Agenda = require('agenda');
const config = require('../config');
const { getMongoose } = require('../loaders/mongoose');
const { logger } = require('../utils/logger');

const { chainId } = config.chain;

const log = logger.extend('agenda');

let agendaPromise;

const getAgenda = async () => {
  if (agendaPromise) {
    return agendaPromise;
  }
  agendaPromise = new Promise(async (resolve, reject) => {
    try {
      log('connecting');
      const connection = await getMongoose({ db: `${chainId}_jobs` });
      const { db } = connection;
      const agenda = new Agenda({ mongo: db });
      log('starting worker');
      await agenda.start();
      log('running');
      resolve(agenda);
    } catch (e) {
      reject(e);
    }
  });
  return agendaPromise;
};

module.exports = {
  getAgenda,
};
