const { Schema } = require('mongoose');
const { getMongoose } = require('../loaders/mongoose');
const { logger } = require('../utils/logger');
const { Bytes32Schema, SafeUintSchema, TimestampSchema, ChainIdSchema } =
  require('./common').schema;
const { toJsonOption } = require('./common').option;

// fix mongoose String required (https://github.com/Automattic/mongoose/issues/7150)
Schema.Types.String.checkRequired((v) => v != null);

const log = logger.extend('models:categoryModel');

const connectedModels = {};

const categorySchema = new Schema(
  {
    catid: { ...SafeUintSchema, unique: true, index: true },
    chainId: ChainIdSchema,
    name: { type: String, required: true },
    description: { type: String, required: true },
    workClockTimeRef: { ...SafeUintSchema, index: true },
    transactionHash: Bytes32Schema,
    blockNumber: SafeUintSchema,
    blockTimestamp: TimestampSchema,
  },
  { ...toJsonOption },
);

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
          const CategoryModel = mongoose.model('Category', categorySchema);
          CategoryModel.on('index', (err) => {
            if (err) {
              log(`error creating index: ${err}`);
            } else {
              log('index created');
            }
          });
          resolve(CategoryModel);
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

module.exports = {
  getModel,
};
