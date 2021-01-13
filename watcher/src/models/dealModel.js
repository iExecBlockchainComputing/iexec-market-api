const { Schema } = require('mongoose');
const { getMongoose } = require('../loaders/mongoose');
const { logger } = require('../utils/logger');
const {
  AddressSchema,
  Bytes32Schema,
  SafeUintSchema,
  TimestampSchema,
  ChainIdSchema,
} = require('./common').schema;
const { toJsonOption } = require('./common').option;

const log = logger.extend('models:dealModel');

const connectedModels = {};

const ResourceSchema = {
  pointer: AddressSchema,
  price: SafeUintSchema,
  owner: AddressSchema,
};

const dealSchema = new Schema(
  {
    dealid: { ...Bytes32Schema, unique: true, index: true },
    chainId: ChainIdSchema,
    app: ResourceSchema,
    dataset: ResourceSchema,
    workerpool: ResourceSchema,
    requester: AddressSchema,
    beneficiary: AddressSchema,
    callback: AddressSchema,
    appHash: Bytes32Schema,
    datasetHash: Bytes32Schema,
    workerpoolHash: Bytes32Schema,
    requestHash: Bytes32Schema,
    params: { type: String, required: true },
    volume: SafeUintSchema,
    category: SafeUintSchema,
    tag: Bytes32Schema,
    trust: SafeUintSchema,
    startTime: SafeUintSchema,
    botFirst: SafeUintSchema,
    botSize: SafeUintSchema,
    schedulerRewardRatio: SafeUintSchema,
    workerStake: SafeUintSchema,
    blockNumber: SafeUintSchema,
    blockTimestamp: TimestampSchema,
    transactionHash: Bytes32Schema,
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
          log('instanciating model');
          const DealModel = mongoose.model('Deal', dealSchema);
          DealModel.on('index', (err) => {
            if (err) {
              log(`error creating index: ${err}`);
            } else {
              log('index created');
            }
          });
          resolve(DealModel);
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
