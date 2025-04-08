import { Schema } from 'mongoose';
import { getMongoose } from '../loaders/mongoose.js';
import { getLogger } from '../utils/logger.js';
import { traceAll } from '../utils/trace.js';

const logger = getLogger('models:counterModel');

const connectedModels = {};

const counterSchema = new Schema({
  name: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },
  value: { type: Number, required: true },
});

const _getModel = async (db) => {
  try {
    if (connectedModels[db]) {
      return await connectedModels[db];
    }
    connectedModels[db] = new Promise((resolve, reject) => {
      logger.debug('getting connection');
      getMongoose({ db })
        .then((mongoose) => {
          logger.debug('instantiating model');
          const CounterModel = mongoose.model('Counter', counterSchema);
          CounterModel.on('index', (err) => {
            if (err) {
              logger.error(`error creating index: ${err}`);
            } else {
              logger.log('index created');
            }
          });
          resolve(CounterModel);
        })
        .catch((e) => reject(e));
    });
    return await connectedModels[db];
  } catch (e) {
    logger.warn('getModel() error', e);
    throw e;
  }
};

const getModel = traceAll(_getModel, { logger });

export { getModel };
