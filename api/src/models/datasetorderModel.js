const { Schema } = require('mongoose');
const { getMongoose } = require('../loaders/mongoose');
const { logger } = require('../utils/logger');
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

const log = logger.extend('models:datasetorderModel');

const connectedModels = {};

const datasetorderSchema = new Schema(
  {
    orderHash: { ...Bytes32Schema, unique: true, index: true },
    order: {
      dataset: { ...AddressSchema, index: true },
      datasetprice: SafeUintSchema,
      volume: SafeUintSchema,
      tag: Bytes32Schema,
      apprestrict: { ...AddressSchema, index: true },
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
    connectedModels[db] = new Promise(async (resolve, reject) => {
      try {
        log('getting connection');
        const mongoose = await getMongoose({ db });
        log('instanciating model');
        const DatasetorderModel = mongoose.model(
          'Datasetorder',
          datasetorderSchema,
        );
        DatasetorderModel.on('index', (err) => {
          if (err) {
            log(`error creating index: ${err}`);
          } else {
            log('index created');
          }
        });
        resolve(DatasetorderModel);
      } catch (e) {
        reject(e);
      }
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
