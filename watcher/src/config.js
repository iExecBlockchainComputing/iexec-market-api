const iexecTokenDesc = require('@iexec/poco/build/contracts-min/IexecInterfaceToken.json');
const iexecNativeDesc = require('@iexec/poco/build/contracts-min/IexecInterfaceNative.json');
const appRegistryDesc = require('@iexec/poco/build/contracts-min/AppRegistry.json');
const workerpoolRegistryDesc = require('@iexec/poco/build/contracts-min/WorkerpoolRegistry.json');
const datasetRegistryDesc = require('@iexec/poco/build/contracts-min/DatasetRegistry.json');
const appDesc = require('@iexec/poco/build/contracts-min/App.json');
const workerpoolDesc = require('@iexec/poco/build/contracts-min/Workerpool.json');
const datasetDesc = require('@iexec/poco/build/contracts-min/Dataset.json');
const eRlcDesc = require('@iexec/erlc/build/contracts-min/ERLCTokenSwap.json');
const { FLAVOURS, STANDARD_FLAVOUR } = require('./utils/iexec-utils');
const { getLogger } = require('./utils/logger');

const logger = getLogger('config');

const {
  PORT,
  MONGO_HOST,
  REDIS_HOST,
  FLAVOUR,
  ETH_WS_HOST,
  ETH_RPC_HOST,
  CHAIN,
  CHAIN_ID,
  IEXEC_ADDRESS,
  IS_NATIVE,
  START_BLOCK,
  SYNC_CHECK_INTERVAL,
  OUT_OF_SYNC_LIMIT,
  REPLAY_INTERVAL,
  BLOCKS_BATCH_SIZE = '1000', // default batch size is 1000
  RETRY_DELAY,
  CREATE_INDEX = 'true', // create db indexes by default
} = process.env;

if (!CHAIN) throw Error('missing env CHAIN');

const flavour = FLAVOUR !== undefined ? FLAVOUR : STANDARD_FLAVOUR;
if (!FLAVOURS.includes(flavour)) {
  throw Error(`invalid FLAVOUR ${flavour} must be one of ${FLAVOURS}`);
}

const name = CHAIN.toUpperCase();

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

const DEFAULT_CHAINS_CONFIG = {
  BELLECOUR: {
    httpHost: 'https://bellecour.iex.ec',
    wsHost: 'wss://bellecour-ws.iex.ec',
    chainId: '134',
    hubAddress: '0x3eca1B216A7DF1C7689aEb259fFB83ADFB894E7f',
    isNative: true,
  },
};

const chain = {
  ...{ name },
  ...(name in DEFAULT_CHAINS_CONFIG && DEFAULT_CHAINS_CONFIG[name]),
  ...(CHAIN_ID && { chainId: CHAIN_ID }),
  ...(ETH_WS_HOST && { wsHost: ETH_WS_HOST }),
  ...(ETH_RPC_HOST && { httpHost: ETH_RPC_HOST }),
  ...(IEXEC_ADDRESS && { hubAddress: IEXEC_ADDRESS }),
  ...(IS_NATIVE !== undefined && { isNative: stringToBoolean(IS_NATIVE) }),
};

const abi = {
  hub: chain.isNative ? iexecNativeDesc.abi : iexecTokenDesc.abi,
  appRegistry: appRegistryDesc.abi,
  datasetRegistry: datasetRegistryDesc.abi,
  workerpoolRegistry: workerpoolRegistryDesc.abi,
  app: appDesc.abi,
  dataset: datasetDesc.abi,
  workerpool: workerpoolDesc.abi,
  erlc: eRlcDesc.abi,
};

const runtime = {
  startBlock: (START_BLOCK && parseInt(START_BLOCK, 10)) || 0,
  retryDelay: (RETRY_DELAY && parseInt(RETRY_DELAY, 10) * 1000) || 5 * 1000,
  checkSyncInterval:
    (SYNC_CHECK_INTERVAL && parseInt(SYNC_CHECK_INTERVAL, 10)) || 30,
  replayInterval: (REPLAY_INTERVAL && parseInt(REPLAY_INTERVAL, 10)) || 2 * 60,
  outOfSyncThreshold:
    (OUT_OF_SYNC_LIMIT && parseInt(OUT_OF_SYNC_LIMIT, 10)) || 5,
  blocksBatchSize: (BLOCKS_BATCH_SIZE && parseInt(BLOCKS_BATCH_SIZE, 10)) || -1,
};

const mongo = {
  host: MONGO_HOST
    ? `mongodb://${MONGO_HOST}:27017/`
    : 'mongodb://localhost:27017/',
  createIndex: stringToBoolean(CREATE_INDEX),
};

const redis = {
  url: REDIS_HOST ? `redis://${REDIS_HOST}` : 'redis://localhost',
};

if (!chain.wsHost) {
  throw Error('missing ethereum websocket endpoint ETH_WS_HOST');
}

if (!chain.httpHost) {
  throw Error('missing ethereum RPC endpoint ETH_RPC_HOST');
}

const serverPort = parseInt(PORT, 10) || 3000;

logger.log('chain', chain);
logger.log('flavour', flavour);
logger.log('mongo', mongo);
logger.log('redis', redis);
logger.log('runtime', runtime);
logger.log('serverPort', serverPort);

module.exports = {
  abi,
  chain,
  flavour,
  mongo,
  redis,
  runtime,
  serverPort,
};
