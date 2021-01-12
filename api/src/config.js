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
  CHAINS,
  MONGO_HOST,
  REDIS_HOST,
  FLAVOUR,
  RATE_LIMIT_MAX,
  RATE_LIMIT_PERIOD,
  GOERLI_ETH_RPC_HOST,
  GOERLI_IEXEC_ADDRESS,
  VIVIANI_ETH_RPC_HOST,
  VIVIANI_IEXEC_ADDRESS,
  MAINNET_ETH_RPC_HOST,
  MAINNET_IEXEC_ADDRESS,
  BELLECOUR_ETH_RPC_HOST,
  BELLECOUR_IEXEC_ADDRESS,
  INFURA_PROJECT_ID,
  GOERLI_ALCHEMY_API_KEY,
  MAINNET_ALCHEMY_API_KEY,
  CREATE_INDEX,
} = process.env;

const chainsNames = CHAINS.split(',').map(e => e.toUpperCase());

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
  GOERLI: {
    id: '5',
    isNative: false,
    host:
      GOERLI_ETH_RPC_HOST
      || (INFURA_PROJECT_ID
        && `https://goerli.infura.io/v3/${INFURA_PROJECT_ID}`)
      || (GOERLI_ALCHEMY_API_KEY
        && `https://eth-goerli.alchemyapi.io/v2/${GOERLI_ALCHEMY_API_KEY}`),
    hubAddress:
      GOERLI_IEXEC_ADDRESS
      || (!isEnterpriseFlavour(flavour)
        ? '0x3eca1B216A7DF1C7689aEb259fFB83ADFB894E7f'
        : '0x0bf375A6238359CE14987C2285B8B099eE8e8709'),
  },
  VIVIANI: {
    id: '133',
    isNative: true,
    host: VIVIANI_ETH_RPC_HOST || 'https://viviani.iex.ec',
    hubAddress:
      VIVIANI_IEXEC_ADDRESS
      || (!isEnterpriseFlavour(flavour)
        ? '0x3eca1B216A7DF1C7689aEb259fFB83ADFB894E7f'
        : undefined),
  },
  MAINNET: {
    id: '1',
    isNative: false,
    host:
      MAINNET_ETH_RPC_HOST
      || (INFURA_PROJECT_ID
        && `https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}`)
      || (MAINNET_ALCHEMY_API_KEY
        && `https://eth-mainnet.alchemyapi.io/v2/${MAINNET_ALCHEMY_API_KEY}`),
    hubAddress:
      MAINNET_IEXEC_ADDRESS
      || (!isEnterpriseFlavour(flavour)
        ? '0x3eca1B216A7DF1C7689aEb259fFB83ADFB894E7f'
        : undefined),
  },
  BELLECOUR: {
    id: '134',
    isNative: true,
    host: BELLECOUR_ETH_RPC_HOST || 'https://bellecour.iex.ec',
    hubAddress:
      BELLECOUR_IEXEC_ADDRESS
      || (!isEnterpriseFlavour(flavour)
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
  const firstOccurence = Object.values(chains)
    .map(e => e.id)
    .indexOf(chain.id);
  if (firstOccurence !== index) {
    throw Error(
      `invalid duplicated CHAIN_ID ${chain.id} for chains ${
        Object.keys(chains)[firstOccurence]
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

const supportedChainsIds = Object.values(chains).map(e => e.id);

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
  host: REDIS_HOST || 'localhost',
};

log('redis', redis);

const rateLimit = {
  maxRequest: parseInt(RATE_LIMIT_MAX, 10) || 100,
  period: parseInt(RATE_LIMIT_PERIOD, 10) || 60 * 1000,
};

log('rateLimit', rateLimit);

module.exports = {
  chains,
  supportedChainsIds,
  flavour,
  mongo,
  redis,
  rateLimit,
};
