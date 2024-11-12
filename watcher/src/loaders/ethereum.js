import ethers from 'ethers';
import * as config from '../config.js';
import { getLogger } from '../utils/logger.js';
import { errorHandler } from '../utils/error.js';
import { isEnterpriseFlavour } from '../utils/iexec-utils.js';

const logger = getLogger('ethereum');

const { wsHost, httpHost, hubAddress } = config.chain;

logger.log('wsHost', wsHost);
logger.log('httpHost', httpHost);

let wsProvider;

const rpcProvider = new ethers.providers.JsonRpcProvider(httpHost);

let initialized = false;

let hubContract;
let appRegistryContract;
let datasetRegistryContract;
let workerpoolRegistryContract;
let eRlcContract;

const init = async () => {
  try {
    logger.log('opening ws');
    wsProvider = new ethers.providers.WebSocketProvider(wsHost);
    wsProvider._websocket.on('open', () => logger.log('ws open'));
    wsProvider._websocket.on('error', (e) => {
      errorHandler(e, {
        type: 'ethereum-ws-error',
        error: e,
        critical: true,
      });
    });
    wsProvider._websocket.on('close', async (code, reason) => {
      initialized = false;
      errorHandler(Error('ws closed'), {
        type: 'ethereum-ws-closed',
        code,
        reason,
        critical: true,
      });
    });

    logger.debug('hubAddress', hubAddress);
    hubContract = new ethers.Contract(hubAddress, config.abi.hub, wsProvider);
    const [
      [appRegistryAddress],
      [datasetRegistryAddress],
      [workerpoolRegistryAddress],
      [tokenAddress],
    ] = await Promise.all([
      hubContract.functions.appregistry(),
      hubContract.functions.datasetregistry(),
      hubContract.functions.workerpoolregistry(),
      hubContract.functions.token(),
    ]);
    logger.debug('appRegistryAddress', appRegistryAddress);
    logger.debug('datasetRegistryAddress', datasetRegistryAddress);
    logger.debug('workerpoolRegistryAddress', workerpoolRegistryAddress);
    logger.debug('tokenAddress', tokenAddress);

    appRegistryContract = new ethers.Contract(
      appRegistryAddress,
      config.abi.appRegistry,
      wsProvider,
    );
    datasetRegistryContract = new ethers.Contract(
      datasetRegistryAddress,
      config.abi.datasetRegistry,
      wsProvider,
    );
    workerpoolRegistryContract = new ethers.Contract(
      workerpoolRegistryAddress,
      config.abi.workerpoolRegistry,
      wsProvider,
    );
    if (isEnterpriseFlavour(config.flavour)) {
      eRlcContract = new ethers.Contract(
        tokenAddress,
        config.abi.erlc,
        wsProvider,
      );
    }
    initialized = true;
  } catch (e) {
    logger.warn('init()', e);
    throw e;
  }
};

const throwIfNotReady = () => {
  if (!initialized) {
    throw Error('ethereum ws not ready');
  }
  return null;
};

const getRpcProvider = () => rpcProvider;
const getProvider = () => throwIfNotReady() || wsProvider;
const getHub = () => throwIfNotReady() || hubContract;
const getAppRegistry = () => throwIfNotReady() || appRegistryContract;
const getDatasetRegistry = () => throwIfNotReady() || datasetRegistryContract;
const getWorkerpoolRegistry = () =>
  throwIfNotReady() || workerpoolRegistryContract;
const getERlc = () => throwIfNotReady() || eRlcContract;
const getApp = (address) =>
  throwIfNotReady() || new ethers.Contract(address, config.abi.app, wsProvider);
const getDataset = (address) =>
  throwIfNotReady() ||
  new ethers.Contract(address, config.abi.dataset, wsProvider);
const getWorkerpool = (address) =>
  throwIfNotReady() ||
  new ethers.Contract(address, config.abi.workerpool, wsProvider);

export {
  init,
  getProvider,
  getRpcProvider,
  getHub,
  getAppRegistry,
  getDatasetRegistry,
  getWorkerpoolRegistry,
  getERlc,
  getApp,
  getDataset,
  getWorkerpool,
};
