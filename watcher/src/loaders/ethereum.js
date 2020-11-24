const ethers = require('ethers');
const config = require('../config');
const { logger } = require('../utils/logger');
const { sleep } = require('../utils/utils');
const { errorHandler } = require('../utils/error');
const { isEnterpriseFlavour } = require('../utils/iexec-utils');

const log = logger.extend('ethereum');

const { wsHost, httpHost, hubAddress } = config.chain;

log('wsHost', wsHost);
log('httpHost', httpHost);

let wsProvider;

const rpcProvider = new ethers.providers.JsonRpcProvider(httpHost);

let initialized = false;

let hubContract;
let appRegistryContract;
let datasetRegistryContract;
let workerpoolRegistryContract;
let eRlcContract;

const init = async (wsClosedCallback) => {
  try {
    log('openning ws');
    wsProvider = new ethers.providers.WebSocketProvider(wsHost);
    wsProvider._websocket.on('open', () => log('ws open'));
    wsProvider._websocket.on('error', (e) => {
      errorHandler(e, {
        type: 'ethereum-ws-error',
        critical: true,
      });
    });
    wsProvider._websocket.on('close', async (code, reason) => {
      initialized = false;
      log('ws closed', code, reason);
      const tryRecover = wsClosedCallback && typeof wsClosedCallback === 'function';
      errorHandler(Error('ws closed'), {
        type: 'ethereum-ws-closed',
        code,
        reason,
        critical: !tryRecover,
      });
      if (tryRecover) {
        log('recovering');
        wsProvider._websocket.terminate();
        await sleep(3000);
        wsClosedCallback();
      }
    });

    log('hubAddress', hubAddress);
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
    log('appRegistryAddress', appRegistryAddress);
    log('datasetRegistryAddress', datasetRegistryAddress);
    log('workerpoolRegistryAddress', workerpoolRegistryAddress);
    log('tokenAddress', tokenAddress);

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
    log('init()', e);
    throw e;
  }
};

const thowIfNotReady = () => {
  if (!initialized) {
    throw Error('ethereum ws not ready');
  }
  return null;
};

const getRpcProvider = () => rpcProvider;
const getProvider = () => thowIfNotReady() || wsProvider;
const getHub = () => thowIfNotReady() || hubContract;
const getAppRegistry = () => thowIfNotReady() || appRegistryContract;
const getDatasetRegistry = () => thowIfNotReady() || datasetRegistryContract;
const getWorkerpoolRegistry = () => thowIfNotReady() || workerpoolRegistryContract;
const getERlc = () => thowIfNotReady() || eRlcContract;
const getApp = address => thowIfNotReady() || new ethers.Contract(address, config.abi.app, wsProvider);
const getDataset = address => thowIfNotReady()
  || new ethers.Contract(address, config.abi.dataset, wsProvider);
const getWorkerpool = address => thowIfNotReady()
  || new ethers.Contract(address, config.abi.workerpool, wsProvider);

module.exports = {
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
