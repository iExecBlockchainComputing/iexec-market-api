import { string, number, object, boolean } from 'yup';
import { getAddress } from 'ethers';
import { supportedChainsIds } from '../config.js';
import { ANY } from './keywords.js';

const chainIdSchema = () =>
  string().oneOf(supportedChainsIds, 'chainId ${value} is not supported');

const bytes32Regex = /^(0x)([0-9a-f]{2}){32}$/;

const integerSchema = () => number().integer();

const booleanSchema = () => boolean();

const positiveIntSchema = () =>
  integerSchema()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1);

const positiveStrictIntSchema = () =>
  integerSchema()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER - 1);

const timestampSchema = () =>
  string().match(
    /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T(2[0-3]|[01][0-9]):[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z$/,
    '${path} must be a timestamp (2019-09-11T10:03:38.068Z is a valid timestamp)',
  );

const transformAddress = (value) => {
  try {
    return getAddress(value.toLowerCase());
  } catch (e) {
    return value;
  }
};

const isAddress = (value) => {
  try {
    getAddress(value);
    return true;
  } catch (e) {
    return false;
  }
};

const addressSchema = () =>
  string()
    .transform(transformAddress)
    .test('is-address', '${path} is not a valid ethereum address', (value) => {
      if (value === undefined) return true;
      return isAddress(value);
    });

const isAny = (value) => value === ANY;

const addressOrAnySchema = () =>
  string()
    .transform((value) => {
      if (isAny(value)) {
        return value;
      }
      return transformAddress(value);
    })
    .test(
      'is-any-or-address',
      `\${path} is neither "${ANY}" nor a valid ethereum address`,
      (value) => {
        if (value === undefined) return true;
        return isAny(value) || isAddress(value);
      },
    );

const bytes32Schema = () =>
  string()
    .lowercase()
    .matches(bytes32Regex, '${path} must be a bytes32 hexstring');

const orderSignSchema = () =>
  string().matches(/^(0x)([0-9a-f]{2})*/, '${path} must be a valid signature');

const signed = () => ({
  salt: bytes32Schema().required(),
  sign: orderSignSchema().required(),
});

const paramsSchema = () => string();

const apporderSchema = () =>
  object(
    {
      app: addressSchema().required(),
      appprice: positiveIntSchema().required(),
      volume: positiveStrictIntSchema().required(),
      tag: bytes32Schema().required(),
      datasetrestrict: addressSchema().required(),
      workerpoolrestrict: addressSchema().required(),
      requesterrestrict: addressSchema().required(),
    },
    '${path} is not a valid signed apporder',
  );

const signedApporderSchema = () =>
  apporderSchema().shape(signed(), '${path} is not a valid signed apporder');

const datasetorderSchema = () =>
  object(
    {
      dataset: addressSchema().required(),
      datasetprice: positiveIntSchema().required(),
      volume: positiveStrictIntSchema().required(),
      tag: bytes32Schema().required(),
      apprestrict: addressSchema().required(),
      workerpoolrestrict: addressSchema().required(),
      requesterrestrict: addressSchema().required(),
    },
    '${path} is not a valid signed datasetorder',
  );

const signedDatasetorderSchema = () =>
  datasetorderSchema().shape(
    signed(),
    '${path} is not a valid signed datasetorder',
  );

const workerpoolorderSchema = () =>
  object(
    {
      workerpool: addressSchema().required(),
      workerpoolprice: positiveIntSchema().required(),
      volume: positiveStrictIntSchema().required(),
      tag: bytes32Schema().required(),
      category: positiveIntSchema().required(),
      trust: positiveIntSchema().required(),
      apprestrict: addressSchema().required(),
      datasetrestrict: addressSchema().required(),
      requesterrestrict: addressSchema().required(),
    },
    '${path} is not a valid signed workerpoolorder',
  );

const signedWorkerpoolorderSchema = () =>
  workerpoolorderSchema().shape(
    signed(),
    '${path} is not a valid signed workerpoolorder',
  );

const requestorderSchema = () =>
  object(
    {
      app: addressSchema().required(),
      appmaxprice: positiveIntSchema().required(),
      dataset: addressSchema().required(),
      datasetmaxprice: positiveIntSchema().required(),
      workerpool: addressSchema().required(),
      workerpoolmaxprice: positiveIntSchema().required(),
      requester: addressSchema().required(),
      volume: positiveStrictIntSchema().required(),
      tag: bytes32Schema().required(),
      category: positiveIntSchema().required(),
      trust: positiveIntSchema().required(),
      beneficiary: addressSchema().required(),
      callback: addressSchema().required(),
      params: paramsSchema(),
    },
    '${path} is not a valid signed requestorder',
  );

const signedRequestorderSchema = () =>
  requestorderSchema().shape(
    signed(),
    '${path} is not a valid signed requestorder',
  );

const stringSchema = string;

export {
  stringSchema,
  addressSchema,
  addressOrAnySchema,
  bytes32Schema,
  apporderSchema,
  signedApporderSchema,
  datasetorderSchema,
  signedDatasetorderSchema,
  workerpoolorderSchema,
  signedWorkerpoolorderSchema,
  requestorderSchema,
  signedRequestorderSchema,
  paramsSchema,
  chainIdSchema,
  positiveIntSchema,
  booleanSchema,
  positiveStrictIntSchema,
  timestampSchema,
  object,
  string,
};
