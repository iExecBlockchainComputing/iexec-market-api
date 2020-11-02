const { utils } = require('iexec');
const ethers = require('ethers');
const { STATUS_MAP, tagToArray } = require('../src/utils/order-utils');
const { getMongoose } = require('../src/loaders/mongoose');
const apporderModel = require('../src/models/apporderModel');
const datasetorderModel = require('../src/models/datasetorderModel');
const workerpoolorderModel = require('../src/models/workerpoolorderModel');
const requestorderModel = require('../src/models/requestorderModel');

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

const deployAndGetApporder = async (
  iexec,
  {
    appprice = 0,
    volume = 1,
    datasetrestrict,
    workerpoolrestrict,
    requesterrestrict,
    tag,
  } = {},
) => {
  const address = await iexec.wallet.getAddress();
  const appDeployRes = await iexec.app.deployApp({
    owner: address,
    name: `app${getId()}`,
    type: 'DOCKER',
    multiaddr: 'registry.hub.docker.com/iexechub/vanityeth:1.1.1',
    checksum:
      '0x00f51494d7a42a3c1c43464d9f09e06b2a99968e3b978f6cd11ab3410b7bcd14',
    mrenclave: 'abc|123|test',
  });
  const app = appDeployRes.address;
  const apporder = await iexec.order
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
  return apporder;
};

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
  const datasetorder = await iexec.order
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
  return datasetorder;
};

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
  const workerpoolorder = await iexec.order
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
  return workerpoolorder;
};

const getMatchableRequestorder = async (
  iexec,
  {
    apporder, datasetorder, workerpoolorder, volume,
  } = {},
) => {
  const address = await iexec.wallet.getAddress();
  const requestorder = await iexec.order
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
    .then(o => iexec.order.signRequestorder(o, { checkRequest: false }));
  return requestorder;
};

const transferResourceERC721 = async (wallet, tokenAddress, to) => {
  const resourceContract = new ethers.Contract(
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
  const registryContract = new ethers.Contract(
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
  const tokenId = ethers.BigNumber.from(tokenAddress).toString();
  const initTx = await registryContract.transferFrom(
    wallet.address,
    to,
    tokenId,
  );
  await initTx.wait();
};

const timestampRegex = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).(\d{3})Z/;
const bytes32Regex = /^(0x)([0-9a-f]{2}){32}$/;
const addressRegex = /^(0x)([0-9a-fA-F]{2}){20}$/;

const addApporders = async (dbName, orders) => {
  const ApporderModel = await apporderModel.getModel(dbName);
  await Promise.all(
    orders.map(async (e) => {
      const order = new ApporderModel(e);
      order.chainId = dbName;
      order.tagArray = tagToArray(e.order.tag);
      order.remaining = order.remaining !== undefined ? order.remaining : e.order.volume;
      order.status = order.status !== undefined ? order.status : STATUS_MAP.OPEN;
      order.signer = order.signer !== undefined ? order.signer : utils.NULL_ADDRESS;
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
      order.remaining = order.remaining !== undefined ? order.remaining : e.order.volume;
      order.status = order.status !== undefined ? order.status : STATUS_MAP.OPEN;
      order.signer = order.signer !== undefined ? order.signer : utils.NULL_ADDRESS;
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
      order.remaining = order.remaining !== undefined ? order.remaining : e.order.volume;
      order.status = order.status !== undefined ? order.status : STATUS_MAP.OPEN;
      order.signer = order.signer !== undefined ? order.signer : utils.NULL_ADDRESS;
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
      order.remaining = order.remaining !== undefined ? order.remaining : e.order.volume;
      order.status = order.status !== undefined ? order.status : STATUS_MAP.OPEN;
      order.publicationTimestamp = new Date().toISOString();
      order.signer = e.order.requester;
      await order.save();
    }),
  );
};

const find = async (dbName, collection, findObject) => {
  const { db } = await getMongoose({ db: dbName });
  const docs = await db
    .collection(collection)
    .find(findObject)
    .toArray();
  return docs;
};

const dropDB = async (dbName) => {
  const { db } = await getMongoose({ db: dbName });
  // await db.dropDatabase();
  const collections = [
    APPORDERS_COLLECTION,
    DATASETORDERS_COLLECTION,
    WORKERPOOLORDERS_COLLECTION,
    REQUESTORDERS_COLLECTION,
    DEALS_COLLECTION,
    CATEGORIES_COLLECTION,
    COUNTERS_COLLECTION,
  ];
  await Promise.all(
    collections.map(e => db
      .collection(e)
      .deleteMany()
      .catch(err => console.log(`${e}.deleteMany()`, err))),
  );
};

module.exports = {
  addApporders,
  addDatasetorders,
  addWorkerpoolorders,
  addRequestorders,
  find,
  dropDB,
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
