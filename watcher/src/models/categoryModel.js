import { Schema } from 'mongoose';
import { getMongoose } from '../loaders/mongoose.js';
import { getLogger } from '../utils/logger.js';
import { traceAll } from '../utils/trace.js';
import { schema, option } from './common.js';

const { Bytes32Schema, SafeUintSchema, TimestampSchema, ChainIdSchema } =
  schema;
const { toJsonOption } = option;

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
    return await connectedModels[db];
  } catch (e) {
    logger.warn('getModel() error', e);
    throw e;
  }
};

const getModel = traceAll(_getModel, { logger });

export { getModel };
