import { Schema } from 'mongoose';
import { getMongoose } from '../loaders/mongoose.js';
import { getLogger } from '../utils/logger.js';
import { traceAll } from '../utils/trace.js';
import { schema, option } from './common.js';

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

const logger = getLogger('models:datasetorderModel');

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
    status: { ...OrderStatusSchema, index: true },
    publicationTimestamp: TimestampSchema,
    signer: { ...AddressSchema, index: true },
  },
  {
    ...orderToJsonOption,
  },
);

const _getModel = async (db) => {
  try {
    if (connectedModels[db]) {
      return await connectedModels[db];
    }
    connectedModels[db] = new Promise((resolve, reject) => {
      logger.debug('getting connection');
      getMongoose({ db })
        .then((mongoose) => {
          logger.debug('instantiating model');
          const DatasetorderModel = mongoose.model(
            'Datasetorder',
            datasetorderSchema,
          );
          DatasetorderModel.on('index', (err) => {
            if (err) {
              logger.error(`error creating index: ${err}`);
            } else {
              logger.log('index created');
            }
          });
          resolve(DatasetorderModel);
        })
        .catch((e) => reject(e));
    });
    return await connectedModels[db];
  } catch (e) {
    logger.warn('getModel() error', e);
    throw e;
  }
};

const getModel = traceAll(_getModel, { logger });

export { getModel };
