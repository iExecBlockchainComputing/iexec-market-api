import { utils } from 'iexec';
/**
 * @typedef {import('iexec').IExec} IExec;
 */
import { Contract, toBeHex } from 'ethers';
import { STATUS_MAP, tagToArray } from '../src/utils/iexec-utils.js';
import { getMongoose } from '../src/loaders/mongoose.js';
import * as apporderModel from '../src/models/apporderModel.js';
import * as datasetorderModel from '../src/models/datasetorderModel.js';
import * as workerpoolorderModel from '../src/models/workerpoolorderModel.js';
import * as requestorderModel from '../src/models/requestorderModel.js';
import * as counterModel from '../src/models/counterModel.js';

const APPORDERS_COLLECTION = 'apporders';
const DATASETORDERS_COLLECTION = 'datasetorders';
const WORKERPOOLORDERS_COLLECTION = 'workerpoolorders';
const REQUESTORDERS_COLLECTION = 'requestorders';
const DEALS_COLLECTION = 'deals';
const CATEGORIES_COLLECTION = 'categories';
const COUNTERS_COLLECTION = 'counters';

let sequenceId = Date.now();
const getId = () => {
  sequenceId += 1;
  return sequenceId;
};

/**
 * @param {IExec} iexec
 */
const deployAndGetApporder = async (
  iexec,
  {
    appprice = 0,
    volume = 1,
    datasetrestrict,
    workerpoolrestrict,
    requesterrestrict,
    tag = [],
  } = {},
) => {
  const address = await iexec.wallet.getAddress();
  const appDeployRes = await iexec.app.deployApp({
    owner: address,
    name: `app${getId()}`,
    type: 'DOCKER',
    multiaddr:
      'docker.io/iexechub/python-hello-world:8.0.0-sconify-5.7.5-v14-production',
    checksum:
      '0xe89eb32fe956d44ed582123b2259dec6ccd60f4b0f680e9b6e262a4734f66486',
    mrenclave: tag.includes('tee')
      ? {
          framework: 'SCONE',
          version: 'v5',
          entrypoint: 'python /app/app.py',
          heapSize: 1073741824,
          fingerprint:
            'acf574009a4093846213a000039accaec90c8a242eb26a71063d967a74ac80ac',
        }
      : '',
  });
  const app = appDeployRes.address;
  return iexec.order
    .createApporder({
      app,
      appprice,
      volume,
      tag,
      datasetrestrict,
      workerpoolrestrict,
      requesterrestrict,
    })
    .then(iexec.order.signApporder);
};

/**
 * @param {IExec} iexec
 */
const deployAndGetDatasetorder = async (
  iexec,
  {
    datasetprice = 0,
    volume = 1,
    apprestrict,
    workerpoolrestrict,
    requesterrestrict,
    tag,
  } = {},
) => {
  const address = await iexec.wallet.getAddress();
  const datasetDeployRes = await iexec.dataset.deployDataset({
    owner: address,
    name: `dataset${getId()}`,
    multiaddr: '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
    checksum:
      '0x0000000000000000000000000000000000000000000000000000000000000000',
  });
  const dataset = datasetDeployRes.address;
  return iexec.order
    .createDatasetorder({
      dataset,
      datasetprice,
      volume,
      tag,
      apprestrict,
      workerpoolrestrict,
      requesterrestrict,
    })
    .then(iexec.order.signDatasetorder);
};

/**
 * @param {IExec} iexec
 */
const deployAndGetWorkerpoolorder = async (
  iexec,
  {
    category = 0,
    workerpoolprice = 0,
    volume = 1,
    trust,
    apprestrict,
    datasetrestrict,
    requesterrestrict,
    tag,
  } = {},
) => {
  const address = await iexec.wallet.getAddress();
  const workerpoolDeployRes = await iexec.workerpool.deployWorkerpool({
    owner: address,
    description: `workerpool${getId()}`,
  });
  const workerpool = workerpoolDeployRes.address;
  return iexec.order
    .createWorkerpoolorder({
      workerpool,
      workerpoolprice,
      volume,
      category,
      trust,
      tag,
      apprestrict,
      datasetrestrict,
      requesterrestrict,
    })
    .then(iexec.order.signWorkerpoolorder);
};

/**
 * @param {IExec} iexec
 */
const getMatchableRequestorder = async (
  iexec,
  { apporder, datasetorder, workerpoolorder, volume } = {},
) => {
  const address = await iexec.wallet.getAddress();
  return iexec.order
    .createRequestorder({
      requester: address,
      app: apporder.app,
      appmaxprice: apporder.appprice,
      dataset: datasetorder ? datasetorder.dataset : utils.NULL_ADDRESS,
      datasetmaxprice: datasetorder ? datasetorder.datasetprice : 0,
      workerpool: workerpoolorder.workerpool,
      workerpoolmaxprice: workerpoolorder.workerpoolprice,
      category: workerpoolorder.category,
      trust: workerpoolorder.trust,
      volume: volume || workerpoolorder.volume,
      tag: apporder.tag,
    })
    .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
};

const transferResourceERC721 = async (wallet, tokenAddress, to) => {
  const resourceContract = new Contract(
    tokenAddress,
    [
      {
        inputs: [],
        name: 'registry',
        outputs: [
          {
            internalType: 'contract IRegistry',
            name: '',
            type: 'address',
          },
        ],
        stateMutability: 'view',
        type: 'function',
      },
    ],
    wallet,
  );
  const registryAddress = await resourceContract.registry();
  const registryContract = new Contract(
    registryAddress,
    [
      {
        inputs: [
          {
            internalType: 'address',
            name: 'from',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'to',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: 'tokenId',
            type: 'uint256',
          },
        ],
        name: 'transferFrom',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
    wallet,
  );
  const tokenId = toBeHex(tokenAddress);
  const initTx = await registryContract.transferFrom(
    wallet.address,
    to,
    tokenId,
  );
  await initTx.wait();
};

const timestampRegex =
  /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).(\d{3})Z/;
const bytes32Regex = /^(0x)([0-9a-f]{2}){32}$/;
const addressRegex = /^(0x)([0-9a-fA-F]{2}){20}$/;

const addApporders = async (dbName, orders) => {
  const ApporderModel = await apporderModel.getModel(dbName);
  await Promise.all(
    orders.map(async (e) => {
      const order = new ApporderModel(e);
      order.chainId = dbName;
      order.tagArray = tagToArray(e.order.tag);
      order.remaining =
        order.remaining !== undefined ? order.remaining : e.order.volume;
      order.status =
        order.status !== undefined ? order.status : STATUS_MAP.OPEN;
      order.signer =
        order.signer !== undefined ? order.signer : utils.NULL_ADDRESS;
      order.publicationTimestamp = new Date().toISOString();
      await order.save();
    }),
  );
};

const addDatasetorders = async (dbName, orders) => {
  const DatasetorderModel = await datasetorderModel.getModel(dbName);
  await Promise.all(
    orders.map(async (e) => {
      const order = new DatasetorderModel(e);
      order.chainId = dbName;
      order.tagArray = tagToArray(e.order.tag);
      order.remaining =
        order.remaining !== undefined ? order.remaining : e.order.volume;
      order.status =
        order.status !== undefined ? order.status : STATUS_MAP.OPEN;
      order.signer =
        order.signer !== undefined ? order.signer : utils.NULL_ADDRESS;
      order.publicationTimestamp = new Date().toISOString();
      await order.save();
    }),
  );
};

const addWorkerpoolorders = async (dbName, orders) => {
  const WorkerpoolorderModel = await workerpoolorderModel.getModel(dbName);
  await Promise.all(
    orders.map(async (e) => {
      const order = new WorkerpoolorderModel(e);
      order.chainId = dbName;
      order.tagArray = tagToArray(e.order.tag);
      order.remaining =
        order.remaining !== undefined ? order.remaining : e.order.volume;
      order.status =
        order.status !== undefined ? order.status : STATUS_MAP.OPEN;
      order.signer =
        order.signer !== undefined ? order.signer : utils.NULL_ADDRESS;
      order.publicationTimestamp = new Date().toISOString();
      await order.save();
    }),
  );
};

const addRequestorders = async (dbName, orders) => {
  const RequestorderModel = await requestorderModel.getModel(dbName);
  await Promise.all(
    orders.map(async (e) => {
      const order = new RequestorderModel(e);
      order.chainId = dbName;
      order.tagArray = tagToArray(e.order.tag);
      order.remaining =
        order.remaining !== undefined ? order.remaining : e.order.volume;
      order.status =
        order.status !== undefined ? order.status : STATUS_MAP.OPEN;
      order.publicationTimestamp = new Date().toISOString();
      order.signer = e.order.requester;
      await order.save();
    }),
  );
};

const find = async (dbName, collection, findObject) => {
  const { db } = await getMongoose({ db: dbName });
  return db.collection(collection).find(findObject).toArray();
};

const dropDB = async (
  dbName,
  collectionsToDelete = [
    APPORDERS_COLLECTION,
    DATASETORDERS_COLLECTION,
    WORKERPOOLORDERS_COLLECTION,
    REQUESTORDERS_COLLECTION,
    DEALS_COLLECTION,
    CATEGORIES_COLLECTION,
    COUNTERS_COLLECTION,
  ],
) => {
  const { db } = await getMongoose({ db: dbName });
  await Promise.all(
    collectionsToDelete.map((e) =>
      db
        .collection(e)
        .deleteMany()
        .catch((err) => console.log(`${e}.deleteMany()`, err)),
    ),
  );
};

const fastForwardToLastBlock = async (dbName, provider) => {
  const CounterModel = await counterModel.getModel(dbName);
  const blockNumber = await provider.getBlockNumber();
  await CounterModel.findOneAndUpdate(
    { name: 'lastBlock' },
    { value: blockNumber },
    { new: true, upsert: true },
  );
};

const setCheckpointToLastBlock = async (dbName) => {
  const CounterModel = await counterModel.getModel(dbName);
  const lastBlock = await CounterModel.findOne({ name: 'lastBlock' });
  await CounterModel.findOneAndUpdate(
    { name: 'checkpointBlock' },
    { value: lastBlock.value },
    { new: true, upsert: true },
  );
};

export {
  addApporders,
  addDatasetorders,
  addWorkerpoolorders,
  addRequestorders,
  find,
  dropDB,
  fastForwardToLastBlock,
  setCheckpointToLastBlock,
  getId,
  deployAndGetApporder,
  deployAndGetDatasetorder,
  deployAndGetWorkerpoolorder,
  getMatchableRequestorder,
  transferResourceERC721,
  timestampRegex,
  bytes32Regex,
  addressRegex,
  APPORDERS_COLLECTION,
  DATASETORDERS_COLLECTION,
  WORKERPOOLORDERS_COLLECTION,
  REQUESTORDERS_COLLECTION,
  DEALS_COLLECTION,
  CATEGORIES_COLLECTION,
  COUNTERS_COLLECTION,
};
