import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  test,
  jest,
} from '@jest/globals';
import supertest from 'supertest';
import { Wallet } from 'ethers';
import { IExec, utils } from 'iexec';
import { chains } from '../src/config.js';
import { STATUS_MAP } from '../src/utils/order-utils.js';
import {
  WALLETS,
  parseResult,
  buildQuery,
  setChallenge,
  dropDB,
  addWorkerpoolorders,
  getRandomAddress,
  deployWorkerpoolFor,
  deployAndGetApporder,
  deployAndGetWorkerpoolorder,
  getMatchableRequestorder,
  timestampRegex,
} from './test-utils.js';

// jest config
jest.setTimeout(2 * 60 * 1000);

const OK_STATUS = 200;
const VALIDATION_ERROR_STATUS = 400;
const AUTH_ERROR_STATUS = 403;
const BUSINESS_ERROR_STATUS = 403;
const NOT_FOUND_ERROR_STATUS = 404;

const AUTH_ERROR_MSG = 'invalid authorization';

const UNPUBLISH_TARGET_ALL_ORDERS = 'unpublish_all';
const UNPUBLISH_TARGET_LAST_ORDER = 'unpublish_last';

const [chainName] = Object.keys(chains);

const chainUrl = chains[chainName].host;
const chainId = chains[chainName].id;
const signer = utils.getSignerFromPrivateKey(
  chainUrl,
  WALLETS.DEFAULT.privateKey,
);

const iexec = new IExec(
  {
    ethProvider: signer,
    chainId,
  },
  {
    hubAddress: chains[chainName].hubAddress,
    isNative: chains[chainName].isNative,
    resultProxyURL: 'http://example.com/',
    smsURL: 'http://example.com/',
  },
);

const getIexecRandomSigner = () =>
  new IExec(
    {
      ethProvider: utils.getSignerFromPrivateKey(
        chainUrl,
        Wallet.createRandom().privateKey,
      ),
      chainId,
    },
    {
      hubAddress: chains[chainName].hubAddress,
      isNative: chains[chainName].isNative,
      resultProxyURL: 'http://example.com/',
      smsURL: 'http://example.com/',
    },
  );

let application;
let request;
const socketEmitSpy = jest.fn();

beforeAll(async () => {
  jest.unstable_mockModule('../src/loaders/socket.js', () => ({
    emit: socketEmitSpy,
    init: jest.fn(),
  }));
  application = (await import('../src/app.js')).default;
  application.listen();
  request = supertest(application);
});

afterAll(async () => {
  application.close();
});

describe('/workerpoolorders', () => {
  let apporderTemplate;
  let workerpoolorderTemplate;

  beforeAll(async () => {
    apporderTemplate = await deployAndGetApporder(iexec);
    workerpoolorderTemplate = await deployAndGetWorkerpoolorder(iexec);
  });

  describe('POST /workerpoolorders', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      await dropDB(chainId);
    });

    test('POST /workerpoolorders (standard)', async () => {
      const address = await iexec.wallet.getAddress();
      const order = await iexec.order.signWorkerpoolorder({
        ...workerpoolorderTemplate,
        tag: '0x1000000000000000000000000000000000000000000000000000000000000103',
      });
      const hash = await iexec.order.hashWorkerpoolorder(order);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.published).toBeDefined();
      expect(data.published.orderHash).toBe(hash);
      expect(data.published.signer).toBe(address);
      expect(data.published.remaining).toBe(1);
      expect(data.published.status).toBe('open');
      expect(data.published.publicationTimestamp).toMatch(timestampRegex);
      expect(data.published.order).toBeDefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(1);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        1,
        `${chainId}:orders`,
        'workerpoolorder_published',
        expect.objectContaining({ orderHash: hash }),
      );
    });

    test('POST /workerpoolorders (already published)', async () => {
      const order = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(BUSINESS_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('order already published');
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /workerpoolorders (missing chainId)', async () => {
      const order = await iexec.order.signWorkerpoolorder({
        ...workerpoolorderTemplate,
        tag: '0x1000000000000000000000000000000000000000000000000000000000000103',
      });
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(buildQuery('/workerpoolorders', {}))
        .send({
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('chainId is a required field');
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /workerpoolorders (challenge consumed)', async () => {
      const order = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const { data, status } = await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(AUTH_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe(AUTH_ERROR_MSG);
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /workerpoolorders (no authorization header)', async () => {
      const order = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order,
        })
        .then(parseResult);
      expect(status).toBe(AUTH_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe(AUTH_ERROR_MSG);
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /workerpoolorders (bad sign)', async () => {
      const order = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order: { ...order, sign: workerpoolorderTemplate.sign },
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(BUSINESS_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('invalid sign');
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /workerpoolorders (order already consumed)', async () => {
      const order = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
        { volume: 1 },
      );
      const apporder = await iexec.order.signApporder(apporderTemplate);
      const requestorder = await getMatchableRequestorder(iexec, {
        apporder,
        workerpoolorder: order,
      });
      await iexec.order.matchOrders(
        {
          apporder,
          workerpoolorder: order,
          requestorder,
        },
        { preflightCheck: false },
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(BUSINESS_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('order already consumed');
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /workerpoolorders (check enough stake)', async () => {
      const address = await iexec.wallet.getAddress();
      const { stake } = await iexec.account.checkBalance(address);
      await iexec.account.withdraw(stake);
      await iexec.account.deposit(10);
      const order11nRlc = await iexec.order.signWorkerpoolorder({
        ...workerpoolorderTemplate,
        workerpoolprice: 4,
        volume: 11,
      });
      const order10nRlc = await iexec.order.signWorkerpoolorder({
        ...workerpoolorderTemplate,
        workerpoolprice: 4,
        volume: 10,
      });
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const resKO = await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order: order11nRlc,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const resOK = await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order: order10nRlc,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(resOK.status).toBe(OK_STATUS);
      expect(resOK.data.ok).toBe(true);
      expect(resKO.status).toBe(BUSINESS_ERROR_STATUS);
      expect(resKO.data.ok).toBe(false);
      expect(resKO.data.error).toBe(
        "workerpool owner's stake is too low to cover required workerpool lock",
      );
      expect(resKO.data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(1);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        1,
        `${chainId}:orders`,
        'workerpoolorder_published',
        expect.objectContaining({
          orderHash: resOK.data.published.orderHash,
        }),
      );
    }, 15000);
  });

  describe('PUT /workerpoolorders', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      await dropDB(chainId);
    });

    test('PUT /workerpoolorders (standard)', async () => {
      const order = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const hash = await iexec.order.hashWorkerpoolorder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          orderHash: hash,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.unpublished).toEqual(expect.arrayContaining([hash]));
      expect(socketEmitSpy).toHaveBeenCalledTimes(1);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        1,
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        hash,
      );
    });

    test('PUT /workerpoolorders (not published)', async () => {
      const order = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const hash = await iexec.order.hashWorkerpoolorder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          orderHash: hash,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(BUSINESS_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe(
        `workerpoolorder with orderHash ${hash} is not published`,
      );
      expect(data.unpublished).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('PUT /workerpoolorders (last)', async () => {
      const order1 = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order: order1,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      const order2 = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const hash2 = await iexec.order.hashWorkerpoolorder(order2);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order: order2,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          target: UNPUBLISH_TARGET_LAST_ORDER,
          workerpool: order2.workerpool,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.unpublished).toEqual(expect.arrayContaining([hash2]));
      expect(socketEmitSpy).toHaveBeenCalledTimes(1);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        1,
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        hash2,
      );
    });

    test('PUT /workerpoolorders (all)', async () => {
      const order1 = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const hash1 = await iexec.order.hashWorkerpoolorder(order1);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order: order1,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      const order2 = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const hash2 = await iexec.order.hashWorkerpoolorder(order2);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order: order2,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          target: UNPUBLISH_TARGET_ALL_ORDERS,
          workerpool: order2.workerpool,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.unpublished).toEqual(expect.arrayContaining([hash1, hash2]));
      expect(data.unpublished.length).toBe(2);
      expect(socketEmitSpy).toHaveBeenCalledTimes(2);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        1,
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        expect.anything(),
      );
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        2,
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        expect.anything(),
      );
    });

    test('PUT /workerpoolorders (missing chainId)', async () => {
      const order = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const hash = await iexec.order.hashWorkerpoolorder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(buildQuery('/workerpoolorders', {}))
        .send({
          orderHash: hash,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('chainId is a required field');
      expect(data.unpublished).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('PUT /workerpoolorders (challenge consumed)', async () => {
      const order = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const hash = await iexec.order.hashWorkerpoolorder(order);
      const { data, status } = await request
        .put(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          orderHash: hash,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(AUTH_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe(AUTH_ERROR_MSG);
      expect(data.unpublished).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('PUT /workerpoolorders (no authorization header)', async () => {
      const order = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const hash = await iexec.order.hashWorkerpoolorder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .send({
          orderHash: hash,
        })
        .then(parseResult);
      expect(status).toBe(AUTH_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe(AUTH_ERROR_MSG);
      expect(data.unpublished).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('GET /workerpoolorders', () => {
    const iexecUser = getIexecRandomSigner();
    const iexecResourceOwner = getIexecRandomSigner();
    const allOrders = [];
    const publicOrders = [];
    const ownersOrders = [];
    const workerpoolSpecificOrders = [];
    const category1Orders = [];
    const appAllowedOrders = [];
    const datasetAllowedOrders = [];
    const requesterAllowedOrders = [];
    const anyAppAllowedOrders = [];
    const anyDatasetAllowedOrders = [];
    const anyRequesterAllowedOrders = [];
    const minTeeTagOrders = [];
    const maxGpuTagOrders = [];
    const minMaxTeeTagOrders = [];
    const minVolumeOrders = [];
    const minTrustOrders = [];
    let deadOrders;
    let consumedOrders;
    let workerpoolAddress;
    let otherAddress;
    let resourceOwnerAddress;
    const allowedDataset = getRandomAddress();
    const allowedApp = getRandomAddress();
    const allowedRequester = getRandomAddress();

    beforeAll(async () => {
      await dropDB(chainId);
      // prepare documents
      const ownerAddress = await iexecUser.wallet.getAddress();
      resourceOwnerAddress = await iexecResourceOwner.wallet.getAddress();

      workerpoolAddress = await deployWorkerpoolFor(iexec, ownerAddress);
      otherAddress = await deployWorkerpoolFor(iexec, ownerAddress);
      const resourceOwnerWorkerpoolAddress = await deployWorkerpoolFor(
        iexec,
        resourceOwnerAddress,
      );

      const noRestrictOrders = [];

      const workerpoolPrice0 = await Promise.all(
        Array(3)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      noRestrictOrders.push(...workerpoolPrice0);
      allOrders.push(...workerpoolPrice0);

      const workerpoolPrice20 = await Promise.all(
        Array(3)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 20,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      noRestrictOrders.push(...workerpoolPrice20);
      allOrders.push(...workerpoolPrice20);

      const workerpoolPrice10 = await Promise.all(
        Array(3)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 10,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      noRestrictOrders.push(...workerpoolPrice10);
      allOrders.push(...workerpoolPrice10);

      const volume1234 = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                volume: 1234,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      minVolumeOrders.push(...volume1234);
      noRestrictOrders.push(...volume1234);
      allOrders.push(...volume1234);

      const minTrust5 = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                trust: 5,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      minTrustOrders.push(...minTrust5);
      noRestrictOrders.push(...minTrust5);
      allOrders.push(...minTrust5);

      const category1 = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                category: 1,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      category1Orders.push(...category1);
      noRestrictOrders.push(...category1);
      allOrders.push(...category1);

      const workerpoolSpecific = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: workerpoolAddress,
                workerpoolprice: 0,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      workerpoolSpecificOrders.push(...workerpoolSpecific);
      noRestrictOrders.push(...workerpoolSpecific);
      allOrders.push(...workerpoolSpecific);

      const owners = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecResourceOwner.order
              .createWorkerpoolorder({
                workerpool: resourceOwnerWorkerpoolAddress,
                category: 0,
              })
              .then(iexecResourceOwner.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: resourceOwnerAddress,
            };
          }),
      );
      ownersOrders.push(...owners);
      noRestrictOrders.push(...owners);
      allOrders.push(...owners);

      publicOrders.push(...noRestrictOrders);

      const tagTee = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                tag: ['tee', 'scone'],
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      publicOrders.push(...tagTee);
      minTeeTagOrders.push(...tagTee);
      minMaxTeeTagOrders.push(...tagTee);
      allOrders.push(...tagTee);

      const tagGpu = await Promise.all(
        Array(3)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                tag: ['gpu'],
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      publicOrders.push(...tagGpu);
      maxGpuTagOrders.push(...tagGpu, ...noRestrictOrders); // max gpu accept empty tag
      allOrders.push(...tagGpu);

      const tagTeeGpu = await Promise.all(
        Array(4)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                tag: ['tee', 'scone', 'gpu'],
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      publicOrders.push(...tagTeeGpu);
      minTeeTagOrders.push(...tagTeeGpu);
      allOrders.push(...tagTeeGpu);

      const appAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                apprestrict: allowedApp,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      appAllowedOrders.push(...appAllowed, ...publicOrders);
      allOrders.push(...appAllowed);

      const appNotAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                apprestrict: getRandomAddress(),
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      anyAppAllowedOrders.push(
        ...appAllowed,
        ...appNotAllowed,
        ...publicOrders,
      );
      allOrders.push(...appNotAllowed);

      const datasetAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                datasetrestrict: allowedDataset,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      datasetAllowedOrders.push(...datasetAllowed, ...publicOrders);
      allOrders.push(...datasetAllowed);

      const datasetNotAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                datasetrestrict: getRandomAddress(),
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      anyDatasetAllowedOrders.push(
        ...datasetAllowed,
        ...datasetNotAllowed,
        ...publicOrders,
      );
      allOrders.push(...datasetNotAllowed);

      const requesterAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                requesterrestrict: allowedRequester,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      requesterAllowedOrders.push(...requesterAllowed, ...publicOrders);
      allOrders.push(...requesterAllowed);

      const requesterNotAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                requesterrestrict: getRandomAddress(),
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      anyRequesterAllowedOrders.push(
        ...requesterAllowed,
        ...requesterNotAllowed,
        ...publicOrders,
      );
      allOrders.push(...requesterNotAllowed);

      consumedOrders = await Promise.all(
        Array(10)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
              status: STATUS_MAP.FILLED,
            };
          }),
      );
      allOrders.push(...consumedOrders);

      deadOrders = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createWorkerpoolorder({
                workerpool: otherAddress,
                workerpoolprice: 0,
                category: 0,
              })
              .then(iexecUser.order.signWorkerpoolorder);
            const orderHash = await iexecUser.order.hashWorkerpoolorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
              status: STATUS_MAP.DEAD,
            };
          }),
      );
      allOrders.push(...deadOrders);

      await addWorkerpoolorders(chainId, allOrders);
    });

    test('GET /workerpoolorders/:orderHash (missing chainId)', async () => {
      const { orderHash } = allOrders[allOrders.length - 1];
      const { data, status } = await request
        .get(buildQuery(`/workerpoolorders/${orderHash}`, {}))
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('chainId is a required field');
      expect(data.order).toBeUndefined();
    });

    test('GET /workerpoolorders/:orderHash (standard)', async () => {
      const orderToFind = allOrders[allOrders.length - 1];
      const { orderHash } = orderToFind;
      const { data, status } = await request
        .get(buildQuery(`/workerpoolorders/${orderHash}`, { chainId }))
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.order).toBeDefined();
      expect(data.orderHash).toBe(orderHash);
      expect(data.order.workerpool).toBe(orderToFind.order.workerpool);
      expect(data.remaining).toBeDefined();
      expect(data.status).toBeDefined();
      expect(data.signer).toBeDefined();
      expect(data.publicationTimestamp).toBeDefined();
    });

    test('GET /workerpoolorders/:orderHash (not found)', async () => {
      const { data, status } = await request
        .get(
          buildQuery(
            '/workerpoolorders/0xbdcc296eb42dc4e99c46b90aa8f04cb4dad48eae836a0cea3adf4291508ee765',
            {
              chainId, // *
            },
          ),
        )
        .then(parseResult);
      expect(status).toBe(NOT_FOUND_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('workerpoolorder not found');
      expect(data.order).toBeUndefined();
    });

    test('GET /workerpoolorders (missing chainId)', async () => {
      const { data, status } = await request
        .get(buildQuery('/workerpoolorders', {}))
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('chainId is a required field');
      expect(data.count).toBeUndefined();
      expect(data.orders).toBeUndefined();
    });

    test('GET /workerpoolorders (invalid pageSize)', async () => {
      await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            pageSize: 1,
          }),
        )
        .then(parseResult)
        .then(({ data, status }) => {
          expect(status).toBe(VALIDATION_ERROR_STATUS);
          expect(data.ok).toBe(false);
          expect(data.error).toBe(
            'pageSize must be greater than or equal to 10',
          );
          expect(data.count).toBeUndefined();
          expect(data.orders).toBeUndefined();
        });

      await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            pageSize: 1001,
          }),
        )
        .then(parseResult)
        .then(({ data, status }) => {
          expect(status).toBe(VALIDATION_ERROR_STATUS);
          expect(data.ok).toBe(false);
          expect(data.error).toBe(
            'pageSize must be less than or equal to 1000',
          );
          expect(data.count).toBeUndefined();
          expect(data.orders).toBeUndefined();
        });
    });

    test('GET /workerpoolorders (invalid pageIndex)', async () => {
      await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            pageIndex: -1,
          }),
        )
        .then(parseResult)
        .then(({ data, status }) => {
          expect(status).toBe(VALIDATION_ERROR_STATUS);
          expect(data.ok).toBe(false);
          expect(data.error).toBe(
            'pageIndex must be greater than or equal to 0',
          );
          expect(data.count).toBeUndefined();
          expect(data.orders).toBeUndefined();
        });
    });

    test('GET /workerpoolorders (invalid isAppStrict): should return validation error for invalid isAppStrict value', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            isAppStrict: 'abc',
          }),
        )
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe(
        'isAppStrict must be a `boolean` type, but the final value was: `"abc"`.',
      );
      expect(data.count).toBeUndefined();
      expect(data.orders).toBeUndefined();
    });

    test('GET /workerpoolorders (invalid isDatasetStrict): should return validation error for invalid isWorkerpoolStrict value', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            isDatasetStrict: 'abc',
          }),
        )
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe(
        'isDatasetStrict must be a `boolean` type, but the final value was: `"abc"`.',
      );
      expect(data.count).toBeUndefined();
      expect(data.orders).toBeUndefined();
    });

    test('GET /workerpoolorders (invalid isRequesterStrict): should return validation error for invalid isRequesterStrict value', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            isRequesterStrict: 'abc',
          }),
        )
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe(
        'isRequesterStrict must be a `boolean` type, but the final value was: `"abc"`.',
      );
      expect(data.count).toBeUndefined();
      expect(data.orders).toBeUndefined();
    });

    test('GET /workerpoolorders (no match)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            workerpool: getRandomAddress(), // *
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(0);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(0);
      expect(data.nextPage).toBeUndefined();
    });

    test('GET /workerpoolorders (sort + pagination)', async () => {
      const res1 = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            pageSize: 25,
          }),
        )
        .then(parseResult);
      expect(res1.status).toBe(OK_STATUS);
      expect(res1.data.ok).toBe(true);
      expect(res1.data.count).toBe(publicOrders.length);
      expect(res1.data.orders).toBeDefined();
      expect(Array.isArray(res1.data.orders)).toBe(true);
      res1.data.orders.reduce((prev, curr) => {
        expect(typeof curr.orderHash).toBe('string');
        expect(typeof curr.chainId).toBe('number');
        expect(curr.tagArray).toBeUndefined();
        expect(typeof curr.remaining).toBe('number');
        expect(typeof curr.status).toBe('string');
        expect(typeof curr.publicationTimestamp).toBe('string');
        expect(typeof curr.signer).toBe('string');
        expect(typeof curr.order.workerpool).toBe('string');
        expect(typeof curr.order.workerpoolprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.datasetrestrict).toBe('string');
        expect(typeof curr.order.apprestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.workerpoolprice <= curr.order.workerpoolprice).toBe(
            true,
          );
          if (prev.order.workerpoolprice === curr.order.workerpoolprice) {
            expect(prev.publicationTimestamp <= curr.publicationTimestamp).toBe(
              true,
            );
            if (prev.publicationTimestamp === curr.publicationTimestamp) {
              expect(prev.orderHash <= curr.orderHash).toBe(true);
            }
          }
        }
        return curr;
      });
      expect(res1.data.orders.length).toBe(25);
      const res2 = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            pageSize: 25,
            pageIndex: 1,
          }),
        )
        .then(parseResult);
      expect(res2.status).toBe(OK_STATUS);
      expect(res2.data.ok).toBe(true);
      expect(res2.data.count).toBe(publicOrders.length);
      expect(res2.data.orders).toBeDefined();
      expect(Array.isArray(res2.data.orders)).toBe(true);
      res2.data.orders.reduce((prev, curr) => {
        expect(typeof curr.orderHash).toBe('string');
        expect(typeof curr.chainId).toBe('number');
        expect(curr.tagArray).toBeUndefined();
        expect(typeof curr.remaining).toBe('number');
        expect(typeof curr.status).toBe('string');
        expect(typeof curr.publicationTimestamp).toBe('string');
        expect(typeof curr.signer).toBe('string');
        expect(typeof curr.order.workerpool).toBe('string');
        expect(typeof curr.order.workerpoolprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.datasetrestrict).toBe('string');
        expect(typeof curr.order.apprestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.workerpoolprice <= curr.order.workerpoolprice).toBe(
            true,
          );
          if (prev.order.workerpoolprice === curr.order.workerpoolprice) {
            expect(prev.publicationTimestamp <= curr.publicationTimestamp).toBe(
              true,
            );
            if (prev.publicationTimestamp === curr.publicationTimestamp) {
              expect(prev.orderHash <= curr.orderHash).toBe(true);
            }
          }
        }
        return curr;
      });
      expect(res2.data.orders.length).toBe(res1.data.count - 25);
      const res3 = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            pageSize: 25,
            pageIndex: 100,
          }),
        )
        .then(parseResult);
      expect(res3.status).toBe(OK_STATUS);
      expect(res3.data.ok).toBe(true);
      expect(res3.data.count).toBe(publicOrders.length);
      expect(res3.data.orders).toBeDefined();
      expect(Array.isArray(res3.data.orders)).toBe(true);
      expect(res3.data.orders.length).toBe(0);
    });

    test('GET /workerpoolorders (sort + legacy pagination)', async () => {
      const res1 = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
          }),
        )
        .then(parseResult);
      expect(res1.status).toBe(OK_STATUS);
      expect(res1.data.ok).toBe(true);
      expect(res1.data.count).toBe(publicOrders.length);
      expect(res1.data.orders).toBeDefined();
      expect(Array.isArray(res1.data.orders)).toBe(true);
      res1.data.orders.reduce((prev, curr) => {
        expect(typeof curr.orderHash).toBe('string');
        expect(typeof curr.chainId).toBe('number');
        expect(curr.tagArray).toBeUndefined();
        expect(typeof curr.remaining).toBe('number');
        expect(typeof curr.status).toBe('string');
        expect(typeof curr.publicationTimestamp).toBe('string');
        expect(typeof curr.signer).toBe('string');
        expect(typeof curr.order.workerpool).toBe('string');
        expect(typeof curr.order.workerpoolprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.datasetrestrict).toBe('string');
        expect(typeof curr.order.apprestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.workerpoolprice <= curr.order.workerpoolprice).toBe(
            true,
          );
          if (prev.order.workerpoolprice === curr.order.workerpoolprice) {
            expect(prev.publicationTimestamp <= curr.publicationTimestamp).toBe(
              true,
            );
            if (prev.publicationTimestamp === curr.publicationTimestamp) {
              expect(prev.orderHash <= curr.orderHash).toBe(true);
            }
          }
        }
        return curr;
      });
      expect(res1.data.orders.length).toBe(20);
      expect(res1.data.nextPage).toBeDefined();
      const res2 = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            page: res1.data.nextPage,
          }),
        )
        .then(parseResult);
      expect(res2.status).toBe(OK_STATUS);
      expect(res2.data.ok).toBe(true);
      expect(res2.data.count).toBe(publicOrders.length);
      expect(res2.data.orders).toBeDefined();
      expect(Array.isArray(res2.data.orders)).toBe(true);
      res2.data.orders.reduce((prev, curr) => {
        expect(typeof curr.orderHash).toBe('string');
        expect(typeof curr.chainId).toBe('number');
        expect(curr.tagArray).toBeUndefined();
        expect(typeof curr.remaining).toBe('number');
        expect(typeof curr.status).toBe('string');
        expect(typeof curr.publicationTimestamp).toBe('string');
        expect(typeof curr.signer).toBe('string');
        expect(typeof curr.order.workerpool).toBe('string');
        expect(typeof curr.order.workerpoolprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.datasetrestrict).toBe('string');
        expect(typeof curr.order.apprestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.workerpoolprice <= curr.order.workerpoolprice).toBe(
            true,
          );
          if (prev.order.workerpoolprice === curr.order.workerpoolprice) {
            expect(prev.publicationTimestamp <= curr.publicationTimestamp).toBe(
              true,
            );
            if (prev.publicationTimestamp === curr.publicationTimestamp) {
              expect(prev.orderHash <= curr.orderHash).toBe(true);
            }
          }
        }
        return curr;
      });
      expect(res2.data.orders.length).toBe(publicOrders.length - 20);
      expect(res2.data.nextPage).toBeUndefined();
    });

    test('GET /workerpoolorders (any app, any dataset, any requester, any workerpool)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            dataset: 'any',
            app: 'any',
            requester: 'any',
            workerpool: 'any',
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(
        allOrders.length - consumedOrders.length - deadOrders.length,
      );
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
    });

    test('GET /workerpoolorders (workerpool filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            workerpool: workerpoolAddress,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(workerpoolSpecificOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(workerpoolSpecificOrders.length);
      data.orders.forEach((e) => {
        expect(e.order.workerpool).toBe(workerpoolAddress);
      });
    });

    test('GET /workerpoolorders (workerpoolOwner filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            workerpoolOwner: resourceOwnerAddress, // *
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(ownersOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(ownersOrders.length);
      data.orders.forEach((e) => {
        expect(e.signer).toBe(resourceOwnerAddress);
      });
    });

    test('GET /workerpoolorders (isAppStrict = true & app = undefined): should return public orders including "any" app', async () => {
      const result = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            isAppStrict: true,
          }),
        )
        .then(parseResult);
      expect(result.status).toBe(OK_STATUS);
      expect(result.data.ok).toBe(true);
      expect(result.data.count).toBe(publicOrders.length);
      expect(result.data.orders).toBeDefined();
      expect(Array.isArray(result.data.orders)).toBe(true);
      expect(result.data.orders.length).toBe(20);
      expect(result.data.nextPage).toBeDefined();
    });

    test('GET /workerpoolorders (isDatasetStrict = true & workerpool = undefined): should return public orders including "any" dataset', async () => {
      const result = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            isDatasetStrict: true,
          }),
        )
        .then(parseResult);
      expect(result.status).toBe(OK_STATUS);
      expect(result.data.ok).toBe(true);
      expect(result.data.count).toBe(publicOrders.length);
      expect(result.data.orders).toBeDefined();
      expect(Array.isArray(result.data.orders)).toBe(true);
      expect(result.data.orders.length).toBe(20);
      expect(result.data.nextPage).toBeDefined();
    });

    test('GET /workerpoolorders (isRequesterStrict = true & requester = undefined): should return public orders including "any" requester', async () => {
      const result = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            isRequesterStrict: true,
          }),
        )
        .then(parseResult);
      expect(result.status).toBe(OK_STATUS);
      expect(result.data.ok).toBe(true);
      expect(result.data.count).toBe(publicOrders.length);
      expect(result.data.orders).toBeDefined();
      expect(Array.isArray(result.data.orders)).toBe(true);
      expect(result.data.orders.length).toBe(20);
      expect(result.data.nextPage).toBeDefined();
    });

    test('GET /workerpoolorders (workerpool filter & isAppStrict): should exclude orders with "any" app authorized', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            app: allowedApp,
            isAppStrict: true,
          }),
        )
        .then(parseResult);

      const ordersExcludingAnyApp = appAllowedOrders.filter(
        (order) => order.order.apprestrict !== utils.NULL_ADDRESS,
      );
      expect(appAllowedOrders.length).toBeGreaterThan(
        ordersExcludingAnyApp.length,
      ); // ensure orders will be filtered
      expect(ordersExcludingAnyApp.length).toBeGreaterThan(0); // ensure the expected result is not empty

      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(ordersExcludingAnyApp.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(ordersExcludingAnyApp.length);
      data.orders.forEach((e) => expect(e.order.apprestrict).toBe(allowedApp));
    });

    test('GET /workerpoolorders (workerpool filter & isDatasetStrict): should exclude orders with "any" dataset authorized', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            dataset: allowedDataset,
            isDatasetStrict: true,
          }),
        )
        .then(parseResult);

      const ordersExcludingAnyDataset = datasetAllowedOrders.filter(
        (order) => order.order.datasetrestrict !== utils.NULL_ADDRESS,
      );
      expect(datasetAllowedOrders.length).toBeGreaterThan(
        ordersExcludingAnyDataset.length,
      ); // ensure orders will be filtered
      expect(ordersExcludingAnyDataset.length).toBeGreaterThan(0); // ensure the expected result is not empty

      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(ordersExcludingAnyDataset.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(ordersExcludingAnyDataset.length);
      data.orders.forEach((e) =>
        expect(e.order.datasetrestrict).toBe(allowedDataset),
      );
    });

    test('GET /workerpoolorders (requester filter & isRequesterStrict): should exclude orders with "any" requester authorized', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            requester: allowedRequester,
            isRequesterStrict: true,
          }),
        )
        .then(parseResult);

      const ordersExcludingAnyRequester = requesterAllowedOrders.filter(
        (order) => order.order.requesterrestrict !== utils.NULL_ADDRESS,
      );
      expect(requesterAllowedOrders.length).toBeGreaterThan(
        ordersExcludingAnyRequester.length,
      ); // ensure orders will be filtered
      expect(ordersExcludingAnyRequester.length).toBeGreaterThan(0); // ensure the expected result is not empty

      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(ordersExcludingAnyRequester.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(ordersExcludingAnyRequester.length);
      data.orders.forEach((e) =>
        expect(e.order.requesterrestrict).toBe(allowedRequester),
      );
    });

    test('GET /workerpoolorders (minVolume filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            minVolume: 1234,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(minVolumeOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(minVolumeOrders.length);
      data.orders.forEach((e) => {
        expect(e.remaining >= 1234).toBe(true);
      });
    });

    test('GET /workerpoolorders (minTrust filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            minTrust: 5,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(minTrustOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(minTrustOrders.length);
      data.orders.forEach((e) => {
        expect(e.order.trust >= 5).toBe(true);
      });
    });

    test('GET /workerpoolorders (category filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            category: 1,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(category1Orders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(category1Orders.length);
      data.orders.forEach((e) => {
        expect(e.order.category).toBe(1);
      });
    });

    test('GET /workerpoolorders (app filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            app: allowedApp,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(appAllowedOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(20);
      data.orders.forEach((e) => {
        expect(
          e.order.apprestrict === allowedApp ||
            e.order.apprestrict === utils.NULL_ADDRESS,
        ).toBe(true);
      });
    });

    test('GET /workerpoolorders (any app filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            app: 'any',
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(anyAppAllowedOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(20);
    });

    test('GET /workerpoolorders (dataset filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            dataset: allowedDataset,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(datasetAllowedOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(20);
      data.orders.forEach((e) => {
        expect(
          e.order.datasetrestrict === allowedDataset ||
            e.order.datasetrestrict === utils.NULL_ADDRESS,
        ).toBe(true);
      });
    });

    test('GET /workerpoolorders (any dataset filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            dataset: 'any',
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(anyDatasetAllowedOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(20);
    });

    test('GET /workerpoolorders (requester filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            requester: allowedRequester,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(requesterAllowedOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(20);
      data.orders.forEach((e) => {
        expect(
          e.order.requesterrestrict === allowedRequester ||
            e.order.requesterrestrict === utils.NULL_ADDRESS,
        ).toBe(true);
      });
    });

    test('GET /workerpoolorders (any requester filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            requester: 'any',
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(anyRequesterAllowedOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(20);
    });

    test('GET /workerpoolorders (minTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            minTag:
              '0x0000000000000000000000000000000000000000000000000000000000000003',
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(minTeeTagOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(minTeeTagOrders.length);
      data.orders.forEach((e) => {
        expect(
          e.order.tag ===
            '0x0000000000000000000000000000000000000000000000000000000000000003' ||
            e.order.tag ===
              '0x0000000000000000000000000000000000000000000000000000000000000103',
        ).toBe(true);
      });
    });

    test('GET /workerpoolorders (maxTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            maxTag:
              '0x0000000000000000000000000000000000000000000000000000000000000100',
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(maxGpuTagOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(20);
      data.orders.forEach((e) => {
        expect(
          e.order.tag ===
            '0x0000000000000000000000000000000000000000000000000000000000000000' ||
            e.order.tag ===
              '0x0000000000000000000000000000000000000000000000000000000000000100',
        ).toBe(true);
      });
    });

    test('GET /workerpoolorders (minTag & maxTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/workerpoolorders', {
            chainId, // *
            minTag:
              '0x0000000000000000000000000000000000000000000000000000000000000003',
            maxTag:
              '0xf000000000000000000000000000000000000000000000000000000000000003',
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(minMaxTeeTagOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(minMaxTeeTagOrders.length);
      data.orders.forEach((e) => {
        expect(
          e.order.tag ===
            '0x0000000000000000000000000000000000000000000000000000000000000003',
        ).toBe(true);
      });
    });
  });
});
