import { getAddress } from 'ethers';
import { STATUS_MAP } from '../utils/iexec-utils.js';

const addressValidator = {
  validator: (address) => {
    try {
      getAddress(address);
      return true;
    } catch (e) {
      return false;
    }
  },
  message: '{PATH} is not a valid address',
};

const bytes32validator = {
  validator: (str) => /^(0x)([0-9a-f]{2}){32}$/.test(str),
  message: '{PATH} is not a valid bytes32',
};

const timestampValidator = {
  validator: (str) =>
    /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T(2[0-3]|[01][0-9]):[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z$/.test(
      str,
    ),
  message: '{PATH} is not a valid timestamp',
};

const orderSignValidator = {
  validator: (str) => /^(0x)([0-9a-f]{2})*/.test(str),
  message: '{PATH} is not a valid sign',
};

const AddressSchema = {
  type: String,
  validate: addressValidator,
  required: true,
};

const Bytes32Schema = {
  type: String,
  validate: bytes32validator,
  required: true,
};

const ChainIdSchema = {
  type: Number,
  required: true,
};

const TimestampSchema = {
  type: String,
  validate: timestampValidator,
  required: true,
};

const OrderSignSchema = {
  type: String,
  validate: orderSignValidator,
  required: true,
};

const OrderStatusSchema = {
  type: String,
  enum: Object.values(STATUS_MAP),
  required: true,
};

const TagBitSchema = {
  type: Number,
  min: 0,
  max: 256,
  required: true,
};

const TagArraySchema = [TagBitSchema];

const SafeUintSchema = {
  type: Number,
  min: 0,
  max: Number.MAX_SAFE_INTEGER,
  required: true,
  set: (v) => (typeof v === 'bigint' ? Number(v) : v),
};

const PositiveStrictSafeUintSchema = {
  type: Number,
  min: 1,
  max: Number.MAX_SAFE_INTEGER,
  required: true,
};

const toJsonOption = {
  toJSON: {
    versionKey: false,
    transform(doc, ret) {
      // eslint-disable-next-line no-param-reassign
      delete ret._id;
    },
  },
};

const orderToJsonOption = {
  toJSON: {
    versionKey: false,
    transform(doc, ret) {
      // eslint-disable-next-line no-param-reassign
      delete ret._id;
      // eslint-disable-next-line no-param-reassign
      delete ret.tagArray;
    },
  },
};

const schema = {
  SafeUintSchema,
  PositiveStrictSafeUintSchema,
  TimestampSchema,
  AddressSchema,
  Bytes32Schema,
  ChainIdSchema,
  OrderSignSchema,
  OrderStatusSchema,
  TagArraySchema,
};
const option = { toJsonOption, orderToJsonOption };

export { schema, option };
