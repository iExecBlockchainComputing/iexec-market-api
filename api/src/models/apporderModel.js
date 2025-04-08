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

const log = logger.extend('models:apporderModel');

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
      log('getting connection');
      getMongoose({ db })
        .then((mongoose) => {
          log('instantiating model');
          const ApporderModel = mongoose.model('Apporder', apporderSchema);
          ApporderModel.on('index', (err) => {
            if (err) {
              log(`error creating index: ${err}`);
            } else {
              log('index created');
            }
          });
          resolve(ApporderModel);
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
