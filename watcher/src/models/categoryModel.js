const { Schema } = require('mongoose');
const { getMongoose } = require('../loaders/mongoose');
const { getLogger } = require('../utils/logger');
const { traceAll } = require('../utils/trace');
const { Bytes32Schema, SafeUintSchema, TimestampSchema, ChainIdSchema } =
  require('./common').schema;
const { toJsonOption } = require('./common').option;

// fix mongoose String required (https://github.com/Automattic/mongoose/issues/7150)
Schema.Types.String.checkRequired((v) => v != null);

const logger = getLogger('models:categoryModel');

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
      logger.debug('getting connection');
      getMongoose({ db })
        .then((mongoose) => {
          logger.debug('instantiating model');
          const CategoryModel = mongoose.model('Category', categorySchema);
          CategoryModel.on('index', (err) => {
            if (err) {
              logger.error(`error creating index: ${err}`);
            } else {
              logger.log('index created');
            }
          });
          resolve(CategoryModel);
        })
        .catch((e) => reject(e));
    });
    const model = await connectedModels[db];
    return model;
  } catch (e) {
    logger.warn('getModel() error', e);
    throw e;
  }
};

module.exports = {
  getModel: traceAll(getModel, { logger }),
};
