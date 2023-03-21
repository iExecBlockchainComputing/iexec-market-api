const { Schema } = require('mongoose');
const { getMongoose } = require('../loaders/mongoose');
const { getLogger } = require('../utils/logger');
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

const logger = getLogger('models:requestorderModel');

const connectedModels = {};

const requestorderSchema = new Schema(
  {
    orderHash: { ...Bytes32Schema, unique: true, index: true },
    order: {
      app: { ...AddressSchema, index: true },
      dataset: { ...AddressSchema, index: true },
      workerpool: { ...AddressSchema, index: true },
      params: { type: String, required: true },
      appmaxprice: SafeUintSchema,
      datasetmaxprice: SafeUintSchema,
      workerpoolmaxprice: SafeUintSchema,
      volume: SafeUintSchema,
      tag: Bytes32Schema,
      category: SafeUintSchema,
      trust: SafeUintSchema,
      requester: { ...AddressSchema, index: true },
      beneficiary: { ...AddressSchema, index: true },
      callback: AddressSchema,
      salt: Bytes32Schema,
      sign: OrderSignSchema,
    },
    chainId: ChainIdSchema,
    tagArray: TagArraySchema,
    remaining: SafeUintSchema,
    status: OrderStatusSchema,
    publicationTimestamp: TimestampSchema,
    signer: AddressSchema,
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
          const RequestorderModel = mongoose.model(
            'Requestorder',
            requestorderSchema,
          );
          RequestorderModel.on('index', (err) => {
            if (err) {
              logger.log(`error creating index: ${err}`);
            } else {
              logger.log('index created');
            }
          });
          resolve(RequestorderModel);
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
  getModel,
};
