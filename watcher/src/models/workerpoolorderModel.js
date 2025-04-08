import { Schema } from 'mongoose';
import { getMongoose } from '../loaders/mongoose.js';
import { getLogger } from '../utils/logger.js';
import { traceAll } from '../utils/trace.js';
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

const logger = getLogger('models:workerpoolorderModel');

const connectedModels = {};

const workerpoolorderSchema = new Schema(
  {
    orderHash: { ...Bytes32Schema, unique: true, index: true },
    order: {
      workerpool: { ...AddressSchema, index: true },
      workerpoolprice: SafeUintSchema,
      volume: SafeUintSchema,
      tag: Bytes32Schema,
      category: SafeUintSchema,
      trust: SafeUintSchema,
      apprestrict: { ...AddressSchema, index: true },
      datasetrestrict: { ...AddressSchema, index: true },
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
          const WorkerpoolorderModel = mongoose.model(
            'Workerpoolorder',
            workerpoolorderSchema,
          );
          WorkerpoolorderModel.on('index', (err) => {
            if (err) {
              logger.error(`error creating index: ${err}`);
            } else {
              logger.log('index created');
            }
          });
          resolve(WorkerpoolorderModel);
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
