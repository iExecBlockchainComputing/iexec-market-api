const { Schema } = require('mongoose');
const { getMongoose } = require('../loaders/mongoose');
const { getLogger } = require('../utils/logger');
const { traceAll } = require('../utils/trace');

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

const getModel = async (db) => {
  try {
    if (connectedModels[db]) {
      const model = await connectedModels[db];
      return model;
    }
    connectedModels[db] = new Promise((resolve, reject) => {
      logger.log('getting connection');
      getMongoose({ db })
        .then((mongoose) => {
          logger.log('instantiating model');
          const CounterModel = mongoose.model('Counter', counterSchema);
          CounterModel.on('index', (err) => {
            if (err) {
              logger.log(`error creating index: ${err}`);
            } else {
              logger.log('index created');
            }
          });
          resolve(CounterModel);
        })
        .catch((e) => reject(e));
    });
    const model = await connectedModels[db];
    return model;
  } catch (e) {
    logger.log('getModel() error', e);
    throw e;
  }
};

module.exports = {
  getModel: traceAll(getModel, { logger }),
};
