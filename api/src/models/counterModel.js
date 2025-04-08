import { Schema } from 'mongoose';
import { getMongoose } from '../loaders/mongoose.js';
import { logger } from '../utils/logger.js';

const log = logger.extend('models:counterModel');

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

const getModel = async (db) => {
  try {
    if (connectedModels[db]) {
      const model = await connectedModels[db];
      return model;
    }
    connectedModels[db] = new Promise((resolve, reject) => {
      log('getting connection');
      getMongoose({ db })
        .then((mongoose) => {
          log('instantiating model');
          const CounterModel = mongoose.model('Counter', counterSchema);
          CounterModel.on('index', (err) => {
            if (err) {
              log(`error creating index: ${err}`);
            } else {
              log('index created');
            }
          });
          resolve(CounterModel);
        })
        .catch((e) => reject(e));
    });
    const model = await connectedModels[db];
    return model;
  } catch (e) {
    log('getModel() error', e);
    throw e;
  }
};

export { getModel };
