const iexecTokenDesc = require('@iexec/poco/build/contracts-min/IexecInterfaceToken.json');
const iexecNativeDesc = require('@iexec/poco/build/contracts-min/IexecInterfaceNative.json');
const appRegistryDesc = require('@iexec/poco/build/contracts-min/AppRegistry.json');
const workerpoolRegistryDesc = require('@iexec/poco/build/contracts-min/WorkerpoolRegistry.json');
const datasetRegistryDesc = require('@iexec/poco/build/contracts-min/DatasetRegistry.json');
const appDesc = require('@iexec/poco/build/contracts-min/App.json');
const workerpoolDesc = require('@iexec/poco/build/contracts-min/Workerpool.json');
const datasetDesc = require('@iexec/poco/build/contracts-min/Dataset.json');
const eRlcDesc = require('@iexec/erlc/build/contracts-min/ERLCTokenSwap.json');
const {
  FLAVOURS,
  STANDARD_FLAVOUR,
  isEnterpriseFlavour,
} = require('./utils/iexec-utils');
const { logger } = require('./utils/logger');

const log = logger.extend('config');

const {
  PORT,
  CHAINS,
  MONGO_HOST,
  REDIS_HOST,
  FLAVOUR,
  MAX_OPEN_ORDERS_PER_WALLET,
  RATE_LIMIT_MAX,
  RATE_LIMIT_PERIOD,
  BELLECOUR_ETH_RPC_HOST,
  BELLECOUR_IEXEC_ADDRESS,
  CREATE_INDEX,
} = process.env;

const chainsNames = CHAINS.split(',').map((e) => e.toUpperCase());

const flavour = FLAVOUR !== undefined ? FLAVOUR : STANDARD_FLAVOUR;
if (!FLAVOURS.includes(flavour)) {
  throw Error(`invalid FLAVOUR ${flavour} must be one of ${FLAVOURS}`);
}

const abis = {
  app: appDesc.abi,
  dataset: datasetDesc.abi,
  workerpool: workerpoolDesc.abi,
  appregistry: appRegistryDesc.abi,
  datasetregistry: datasetRegistryDesc.abi,
  workerpoolregistry: workerpoolRegistryDesc.abi,
  erlc: eRlcDesc.abi,
};

const tokenAbis = {
  hub: iexecTokenDesc.abi,
  ...abis,
};

const nativeAbis = {
  hub: iexecNativeDesc.abi,
  ...abis,
};

const DEFAULT_CHAINS_CONFIG = {
  BELLECOUR: {
    id: '134',
    isNative: true,
    host: BELLECOUR_ETH_RPC_HOST || 'https://bellecour.iex.ec',
    hubAddress:
      BELLECOUR_IEXEC_ADDRESS ||
      (!isEnterpriseFlavour(flavour)
        ? '0x3eca1B216A7DF1C7689aEb259fFB83ADFB894E7f'
        : undefined),
  },
};

const getEnv = (chainName, varName, { strict = true } = {}) => {
  const env = process.env[`${chainName}_${varName}`];
  if (!env && strict) {
    throw Error(`missing env ${chainName}_${varName} for chain ${chainName}`);
  }
  return env;
};

const stringToBoolean = (string) => {
  if (!string) return false;
  switch (string.toLowerCase().trim()) {
    case 'true':
    case 'yes':
    case '1':
      return true;
    default:
      return false;
  }
};

const chains = {};
chainsNames.forEach((name) => {
  if (DEFAULT_CHAINS_CONFIG[name]) {
    chains[name] = DEFAULT_CHAINS_CONFIG[name];
  } else {
    chains[name] = {
      id: getEnv(name, 'CHAIN_ID'),
      isNative: stringToBoolean(getEnv(name, 'IS_NATIVE', { strict: false })),
      flavour: getEnv(name, 'FLAVOUR', { strict: false }) || 'standard',
      host: getEnv(name, 'ETH_RPC_HOST'),
      hubAddress: getEnv(name, 'IEXEC_ADDRESS'),
    };
  }
});

Object.entries(chains).forEach(([name, chain], index) => {
  const firstOccurrence = Object.values(chains)
    .map((e) => e.id)
    .indexOf(chain.id);
  if (firstOccurrence !== index) {
    throw Error(
      `invalid duplicated CHAIN_ID ${chain.id} for chains ${
        Object.keys(chains)[firstOccurrence]
      } and ${name}`,
    );
  }
});

Object.entries(chains).forEach(([name, { id }]) => {
  if (!id.match('^[0-9]*$')) {
    throw Error(`invalid CHAIN_ID ${id} for chain ${name}`);
  }
});

Object.entries(chains).forEach(([name, { host }]) => {
  if (!host) {
    throw Error(
      `missing ethereum RPC endpoint ${name}_ETH_RPC_HOST for chain ${name}`,
    );
  }
});

log('flavour', flavour);

log('chains', chains);

Object.entries(chains).forEach(([key, val]) => {
  chains[key].abi = val.isNative ? nativeAbis : tokenAbis;
});

const supportedChainsIds = Object.values(chains).map((e) => e.id);

Object.values(chains).forEach((item) => {
  chains[item.id] = item;
});

const mongo = {
  host: MONGO_HOST
    ? `mongodb://${MONGO_HOST}:27017/`
    : 'mongodb://localhost:27017/',
  createIndex: stringToBoolean(CREATE_INDEX),
};

log('mongo', mongo);

const redis = {
  url: REDIS_HOST ? `redis://${REDIS_HOST}` : 'redis://localhost',
};

log('redis', redis);

const rateLimit = {
  maxRequest: parseInt(RATE_LIMIT_MAX, 10) || 100,
  period: parseInt(RATE_LIMIT_PERIOD, 10) || 60 * 1000,
};

log('rateLimit', rateLimit);

const maxOpenOrdersPerWallet = parseInt(MAX_OPEN_ORDERS_PER_WALLET, 10) || 50;
log('maxOpenOrdersPerWallet', maxOpenOrdersPerWallet);

const serverPort = parseInt(PORT, 10) || 3000;
log('serverPort', serverPort);

const api = {
  defaultPageSize: 20,
  minPageSize: 10,
  maxPageSize: 1000,
};
log('api', api);

module.exports = {
  chains,
  supportedChainsIds,
  flavour,
  mongo,
  redis,
  rateLimit,
  maxOpenOrdersPerWallet,
  serverPort,
  api,
};
