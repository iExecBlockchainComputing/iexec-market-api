import { Schema } from 'mongoose';
import { getMongoose } from '../loaders/mongoose.js';
import { getLogger } from '../utils/logger.js';
import { traceAll } from '../utils/trace.js';
import { schema, option } from './common.js';

const {
  AddressSchema,
  Bytes32Schema,
  SafeUintSchema,
  TimestampSchema,
  ChainIdSchema,
} = schema;
const { toJsonOption } = option;

const logger = getLogger('models:dealModel');

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
          const DealModel = mongoose.model('Deal', dealSchema);
          DealModel.on('index', (err) => {
            if (err) {
              logger.error(`error creating index: ${err}`);
            } else {
              logger.log('index created');
            }
          });
          resolve(DealModel);
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
