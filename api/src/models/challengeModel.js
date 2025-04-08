import { Schema } from 'mongoose';
import { getMongoose } from '../loaders/mongoose.js';
import { logger } from '../utils/logger.js';
import { schema } from './common.js';

const { AddressSchema } = schema;

const log = logger.extend('models:challengeModel');

const connectedModels = {};

const challengeSchema = new Schema({
  createdAt: { type: Date, expires: 5 * 60 }, // 5 min expiration
  hash: { type: String, required: true, index: true },
  value: { type: String, required: true },
  address: AddressSchema,
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
          const ChallengeModel = mongoose.model('Challenge', challengeSchema);
          ChallengeModel.on('index', (err) => {
            if (err) {
              log(`error creating index: ${err}`);
            } else {
              log('index created');
            }
          });
          resolve(ChallengeModel);
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
