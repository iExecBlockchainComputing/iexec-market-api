import Agenda from 'agenda';
import { chain } from '../config.js';
import { getMongoose } from './mongoose.js';
import { getLogger } from '../utils/logger.js';

const { chainId } = chain;
const logger = getLogger('agenda');

let agendaPromise;

/**
 * Initializes and returns a singleton Agenda instance.
 * 
 * This uses a MongoDB URI extracted from a Mongoose v8 connection,
 * ensuring full compatibility with Agenda's expected configuration shape.
 * 
 * Notes on Mongoose v8 compatibility:
 * - Mongoose v8 removed global buffering; `bufferCommands: false` is used in the loader.
 * - `mongoose.createConnection()` returns a `Connection` instance.
 * - The native MongoClient URI is available at `connection.db.client.s.url`.
 * - This URI is passed directly to Agenda's `db.address` option.
 */
const getAgenda = async () => {
  if (agendaPromise) return agendaPromise;

  agendaPromise = new Promise((resolve, reject) => {
    logger.log('Connecting to Mongo...');
    getMongoose({ db: `${chainId}_jobs` })
      .then(async (mongooseConnection) => {
        // Passing Native db dosn't go through anymore preventing agenda from running and it is blocked at index creation level
        // Extract raw Mongo URI from Mongoose connection (v8-safe)
        const uri = mongooseConnection.db.client.s.url;

        // Create Agenda instance with URI and disable auto-indexing to avoid blocking on start
        const agenda = new Agenda({
          db: {
            address: uri,
            disableAutoIndex: true,
          }
        });

        logger.log('Starting Agenda worker...');
        try {
          await agenda.start();
          logger.log('Agenda is running ✅');
          resolve(agenda);
        } catch (e) {
          logger.warn('Agenda start failed', e);
          reject(e);
        }
      })
      .catch((e) => {
        logger.warn('getAgenda() failed', e);
        reject(e);
      });
  });

  return agendaPromise;
};

export { getAgenda };
