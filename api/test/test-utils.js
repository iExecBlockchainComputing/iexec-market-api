const { utils } = require('iexec');
const ethers = require('ethers');
const queryString = require('query-string');
const { STATUS_MAP, tagToArray } = require('../src/utils/order-utils');
const { getMongoose } = require('../src/loaders/mongoose');
const categoryModel = require('../src/models/categoryModel');
const dealModel = require('../src/models/dealModel');
const apporderModel = require('../src/models/apporderModel');
const datasetorderModel = require('../src/models/datasetorderModel');
const workerpoolorderModel = require('../src/models/workerpoolorderModel');
const requestorderModel = require('../src/models/requestorderModel');

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const WALLETS = {
  DEFAULT: {
    address: '0x7bd4783FDCAD405A28052a0d1f11236A741da593',
    privateKey:
      '0x564a9db84969c8159f7aa3d5393c5ecd014fce6a375842a45b12af6677b12407',
    challenge: {
      hash: '0x7ff13783ecb384e98174335a8dd1d0bcda3809f5b2cec2e007a2f4aaa40ed6b0',
      value: 'ycY7boPtnwWuBhmvfId6gROtOFwuiInQ',
      address: '0x7bd4783FDCAD405A28052a0d1f11236A741da593',
    },
    authorization:
      '0x7ff13783ecb384e98174335a8dd1d0bcda3809f5b2cec2e007a2f4aaa40ed6b0_0x0ae7e415bc0021fe90df0f8f1a312501bc968772ec73ab39620b300b13d2b212607d1adc4741f771568ac52fbc5c042787a2bf7df2872f4a7fac93d3a46fe2341b_0x7bd4783FDCAD405A28052a0d1f11236A741da593',
  },
  NOT_KYC: {
    address: '0x2b5c3D5af9222E4ab413D3cf35d5B79da588b2f6',
    privateKey:
      '0x468b0125d362c26088645cec820da8520e1d48e57a55dd29427512f256a0105e',
    challenge: {
      hash: '0x7c46593ab14c9a80ca75f3600915943773214720d11d756f93ca3c6801cdd514',
      value: 'sih7Ir1dqZFOi5Qx7VH3A3SnRpkDLPKD',
      address: '0x2b5c3D5af9222E4ab413D3cf35d5B79da588b2f6',
    },
    authorization:
      '0x7c46593ab14c9a80ca75f3600915943773214720d11d756f93ca3c6801cdd514_0xc51a35a36de3cad994606c6e569dabc7ec879dec4cf36019a77a66f87dadc8197bc89c1579c40583c43042f571a13d9b4a86deb285c1648716a65f6760c7c8941b_0x2b5c3D5af9222E4ab413D3cf35d5B79da588b2f6',
  },
};

let sequenceId = Date.now();
const getId = () => {
  sequenceId += 1;
  return sequenceId;
};

const getRandomWallet = () => {
  const { privateKey, publicKey, address } = ethers.Wallet.createRandom();
  return { privateKey, publicKey, address };
};

const getRandomAddress = () =>
  ethers.utils.getAddress(
    ethers.utils.hexZeroPad(ethers.BigNumber.from(getId()), 20),
  );

const getBytes32 = (hexString) => ethers.utils.hexZeroPad(hexString, 32);

const deployAppFor = async (iexec, owner) => {
  const { address } = await iexec.app.deployApp({
    owner,
    name: `app${getId()}`,
    type: 'DOCKER',
    multiaddr: 'registry.hub.docker.com/iexechub/vanityeth:1.1.1',
    checksum:
      '0x00f51494d7a42a3c1c43464d9f09e06b2a99968e3b978f6cd11ab3410b7bcd14',
    mrenclave: 'abc|123|test',
  });
  return address;
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
  const app = await deployAppFor(iexec, address);
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

const deployDatasetFor = async (iexec, owner) => {
  const { address } = await iexec.dataset.deployDataset({
    owner,
    name: `dataset${getId()}`,
    multiaddr: '/p2p/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ',
    checksum:
      '0x0000000000000000000000000000000000000000000000000000000000000000',
  });
  return address;
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
  const dataset = await deployDatasetFor(iexec, address);
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

const deployWorkerpoolFor = async (iexec, owner) => {
  const { address } = await iexec.workerpool.deployWorkerpool({
    owner,
    description: `workerpool${getId()}`,
  });
  return address;
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
  const workerpool = await deployWorkerpoolFor(iexec, address);
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
  { apporder, datasetorder, workerpoolorder, volume } = {},
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
    })
    .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
  return requestorder;
};

const castOrderPrices = (order) => ({
  ...order,
  ...(order.appmaxprice !== undefined && {
    appmaxprice: parseInt(order.appmaxprice, 10),
  }),
  ...(order.datasetmaxprice !== undefined && {
    datasetmaxprice: parseInt(order.datasetmaxprice, 10),
  }),
  ...(order.workerpoolmaxprice !== undefined && {
    workerpoolmaxprice: parseInt(order.workerpoolmaxprice, 10),
  }),
  ...(order.appprice !== undefined && {
    appprice: parseInt(order.appprice, 10),
  }),
  ...(order.datasetprice !== undefined && {
    datasetprice: parseInt(order.datasetprice, 10),
  }),
  ...(order.workerpoolprice !== undefined && {
    workerpoolprice: parseInt(order.workerpoolprice, 10),
  }),
});

const initializeTask = async (wallet, hub, dealid, idx) => {
  const hubContract = new ethers.Contract(
    hub,
    [
      {
        constant: false,
        inputs: [
          {
            name: '_dealid',
            type: 'bytes32',
          },
          {
            name: 'idx',
            type: 'uint256',
          },
        ],
        name: 'initialize',
        outputs: [
          {
            name: '',
            type: 'bytes32',
          },
        ],
        payable: false,
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ],
    wallet,
  );
  const initTx = await hubContract.initialize(dealid, idx);
  await initTx.wait();
};

const timestampRegex =
  /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).(\d{3})Z/;
const bytes32Regex = /^(0x)([0-9a-f]{2}){32}$/;
const addressRegex = /^(0x)([0-9a-fA-F]{2}){20}$/;

const find = async (dbName, collection, findObject) => {
  const { db } = await getMongoose({ db: dbName });
  const docs = await db.collection(collection).find(findObject).toArray();
  return docs;
};

const dropDB = async (dbName) => {
  const { db } = await getMongoose({ db: dbName });
  // await db.dropDatabase();
  const collections = [
    'challenges',
    'apporders',
    'datasetorders',
    'workerpoolorders',
    'requestorders',
    'deals',
    'categories',
  ];
  await Promise.all(
    collections.map((e) =>
      db
        .collection(e)
        .deleteMany()
        .catch((err) => console.log(`${e}.deleteMany()`, err)),
    ),
  );
};

const setChallenge = async (dbName, challenge) => {
  const { db } = await getMongoose({ db: dbName });
  await db.collection('challenges').findOneAndUpdate(
    { hash: challenge.hash },
    { $set: challenge },
    {
      upsert: true,
    },
  );
};

const addDeals = async (dbName, deals) => {
  const DealModel = await dealModel.getModel(dbName);
  await Promise.all(
    deals.map(async (e, i) => {
      const deal = new DealModel();
      deal.chainId = dbName;
      deal.dealid = getBytes32(ethers.BigNumber.from(i));
      deal.app = {
        pointer: e.app || getRandomAddress(),
        owner: e.appOwner || getRandomAddress(),
        price: e.appPrice || 0,
      };
      deal.dataset = {
        pointer: e.dataset || getRandomAddress(),
        owner: e.datasetOwner || getRandomAddress(),
        price: e.datasetPrice || 0,
      };

      deal.workerpool = {
        pointer: e.workerpool || getRandomAddress(),
        owner: e.workerpoolOwner || getRandomAddress(),
        price: e.workerpoolPrice || 0,
      };
      deal.requester = e.requester || getRandomAddress();
      deal.beneficiary = e.beneficiary || getRandomAddress();
      deal.callback = e.callback || getRandomAddress();
      deal.appHash =
        e.apporderHash || getBytes32(ethers.BigNumber.from(i + 1000));
      deal.datasetHash =
        e.datasetorderHash || getBytes32(ethers.BigNumber.from(i + 2000));
      deal.workerpoolHash =
        e.workerpoolorderHash || getBytes32(ethers.BigNumber.from(i + 3000));
      deal.requestHash =
        e.requestorderHash || getBytes32(ethers.BigNumber.from(i + 4000));
      deal.category = e.category || 0;
      deal.params = '';
      deal.volume = e.volume || 1;
      deal.tag = e.tag || utils.NULL_BYTES32;
      deal.trust = e.trust || 0;
      deal.startTime = e.startTime || Math.floor(Date.now() / 1000);
      deal.botFirst = e.botFirst || 0;
      deal.botSize = deal.volume;
      deal.schedulerRewardRatio = e.schedulerRewardRatio || 0;
      deal.workerStake = e.workerStake || 0;
      deal.blockNumber = e.blockNumber || 0;
      deal.blockTimestamp = e.blockTimestamp || new Date().toISOString();
      deal.transactionHash =
        e.transactionHash || getBytes32(ethers.BigNumber.from(i + 10000));
      await deal.save();
    }),
  );
};

const addCategories = async (dbName, categories) => {
  const CategoryModel = await categoryModel.getModel(dbName);
  await Promise.all(
    categories.map(async (e) => {
      const category = new CategoryModel(e);
      category.chainId = dbName;
      category.description = '';
      category.transactionHash =
        '0x0000000000000000000000000000000000000000000000000000000000000000';
      category.blockNumber = 0;
      category.blockTimestamp = new Date().toISOString();
      await category.save();
    }),
  );
};

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

const parseResult = (res) => ({ ...res, data: JSON.parse(res.text) });

const buildQuery = (endpoint, params) => {
  const stringifiedParams = queryString.stringify(params, {
    arrayFormat: 'comma',
  });
  const query = stringifiedParams
    ? `${endpoint}?${stringifiedParams}`
    : `${endpoint}`;
  return query;
};

module.exports = {
  WALLETS,
  sleep,
  parseResult,
  buildQuery,
  setChallenge,
  addCategories,
  addDeals,
  addApporders,
  addDatasetorders,
  addWorkerpoolorders,
  addRequestorders,
  find,
  dropDB,
  getRandomWallet,
  getRandomAddress,
  getId,
  deployAppFor,
  deployDatasetFor,
  deployWorkerpoolFor,
  deployAndGetApporder,
  deployAndGetDatasetorder,
  deployAndGetWorkerpoolorder,
  getMatchableRequestorder,
  castOrderPrices,
  initializeTask,
  timestampRegex,
  bytes32Regex,
  addressRegex,
};
