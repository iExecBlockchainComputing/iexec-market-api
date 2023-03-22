const { Schema } = require('mongoose');
const { getMongoose } = require('../loaders/mongoose');
const { getLogger } = require('../utils/logger');
const { traceAll } = require('../utils/trace');
const {
  AddressSchema,
  Bytes32Schema,
  ChainIdSchema,
  SafeUintSchema,
  OrderStatusSchema,
  OrderSignSchema,
  TagArraySchema,
  TimestampSchema,
} = require('./common').schema;
const { orderToJsonOption } = require('./common').option;

const logger = getLogger('models:apporderModel');

const connectedModels = {};

const apporderSchema = new Schema(
  {
    orderHash: { ...Bytes32Schema, unique: true, index: true },
    order: {
      app: { ...AddressSchema, index: true },
      appprice: SafeUintSchema,
      volume: SafeUintSchema,
      tag: Bytes32Schema,
      datasetrestrict: { ...AddressSchema, index: true },
      workerpoolrestrict: { ...AddressSchema, index: true },
      requesterrestrict: { ...AddressSchema, index: true },
      salt: Bytes32Schema,
      sign: OrderSignSchema,
    },
    chainId: ChainIdSchema,
    tagArray: TagArraySchema,
    remaining: SafeUintSchema,
    status: OrderStatusSchema,
    publicationTimestamp: TimestampSchema,
    signer: { ...AddressSchema, index: true },
  },
  {
    ...orderToJsonOption,
  },
);

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
          const ApporderModel = mongoose.model('Apporder', apporderSchema);
          ApporderModel.on('index', (err) => {
            if (err) {
              logger.log(`error creating index: ${err}`);
            } else {
              logger.log('index created');
            }
          });
          resolve(ApporderModel);
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
