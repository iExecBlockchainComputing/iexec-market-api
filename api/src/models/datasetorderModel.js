import { Schema } from 'mongoose';
import { getMongoose } from '../loaders/mongoose.js';
import { logger } from '../utils/logger.js';
import { option, schema } from './common.js';

const {
  AddressSchema,
  Bytes32Schema,
  ChainIdSchema,
  SafeUintSchema,
  OrderStatusSchema,
  OrderSignSchema,
  TagArraySchema,
  TimestampSchema,
} = schema;

const { orderToJsonOption } = option;

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
    connectedModels[db] = new Promise((resolve, reject) => {
      log('getting connection');
      getMongoose({ db })
        .then((mongoose) => {
          log('instantiating model');
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
