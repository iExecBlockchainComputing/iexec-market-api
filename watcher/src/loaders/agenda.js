import Agenda from 'agenda';
import { chain } from '../config.js';
import { getMongoose } from './mongoose.js';
import { getLogger } from '../utils/logger.js';

const { chainId } = chain;

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
            logger.warn('start failed', e);
            reject(e);
          });
      })
      .catch((e) => {
        logger.warn('getAgenda()', e);
        reject(e);
      });
  });
  return agendaPromise;
};

export { getAgenda };
