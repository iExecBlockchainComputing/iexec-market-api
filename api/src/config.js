import { abi as iexecTokenAbi } from './generated/@iexec/poco/IexecInterfaceToken.js';
import { abi as iexecNativeAbi } from './generated/@iexec/poco/IexecInterfaceNative.js';
import { abi as appRegistryAbi } from './generated/@iexec/poco/AppRegistry.js';
import { abi as workerpoolRegistryAbi } from './generated/@iexec/poco/WorkerpoolRegistry.js';
import { abi as datasetRegistryAbi } from './generated/@iexec/poco/DatasetRegistry.js';
import { abi as appAbi } from './generated/@iexec/poco/App.js';
import { abi as workerpoolAbi } from './generated/@iexec/poco/Workerpool.js';
import { abi as datasetAbi } from './generated/@iexec/poco/Dataset.js';

import { logger } from './utils/logger.js';

const log = logger.extend('config');

const {
  PORT,
  CHAINS,
  MONGO_HOST,
  REDIS_HOST,
  MAX_OPEN_ORDERS_PER_WALLET,
  RATE_LIMIT_MAX,
  RATE_LIMIT_PERIOD,
  BELLECOUR_ETH_RPC_HOST,
  BELLECOUR_IEXEC_ADDRESS,
  CREATE_INDEX,
} = process.env;

const chainsNames = CHAINS.split(',').map((e) => e.toUpperCase());

const abis = {
  app: appAbi,
  dataset: datasetAbi,
  workerpool: workerpoolAbi,
  appregistry: appRegistryAbi,
  datasetregistry: datasetRegistryAbi,
  workerpoolregistry: workerpoolRegistryAbi,
};

const tokenAbis = {
  hub: iexecTokenAbi,
  ...abis,
};

const nativeAbis = {
  hub: iexecNativeAbi,
  ...abis,
};

const DEFAULT_CHAINS_CONFIG = {
  BELLECOUR: {
    id: '134',
    isNative: true,
    host: BELLECOUR_ETH_RPC_HOST || 'https://bellecour.iex.ec',
    hubAddress:
      BELLECOUR_IEXEC_ADDRESS || '0x3eca1B216A7DF1C7689aEb259fFB83ADFB894E7f',
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

export {
  chains,
  supportedChainsIds,
  mongo,
  redis,
  rateLimit,
  maxOpenOrdersPerWallet,
  serverPort,
  api,
};
