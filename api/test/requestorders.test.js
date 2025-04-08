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
  addRequestorders,
  getRandomAddress,
  deployAndGetApporder,
  deployAndGetDatasetorder,
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

describe('/requestorders', () => {
  let apporderTemplate;
  let datasetorderTemplate;
  let workerpoolorderTemplate;
  let requestorderTemplate;

  beforeAll(async () => {
    apporderTemplate = await deployAndGetApporder(iexec);
    datasetorderTemplate = await deployAndGetDatasetorder(iexec);
    workerpoolorderTemplate = await deployAndGetWorkerpoolorder(iexec);
    requestorderTemplate = await getMatchableRequestorder(iexec, {
      apporder: apporderTemplate,
      workerpoolorder: workerpoolorderTemplate,
    });
  });

  describe('POST /requestorders', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      await dropDB(chainId);
    });

    test('POST /requestorders (missing apporder)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/requestorders', {
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
      expect(data.error).toBe(`No apporder published for app ${order.app}`);
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /requestorders (missing tee apporder)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
          tag: '0x0000000000000000000000000000000000000000000000000000000000000003',
        },
        { preflightCheck: false },
      );
      const apporder = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/requestorders', {
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
      expect(data.error).toBe(
        `No tee enabled apporder published for app ${order.app}`,
      );
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /requestorders (standard)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
          tag: '0xf000000000000000000000000000000000000000000000000000000000000003',
        },
        { preflightCheck: false },
      );
      const hash = await iexec.order.hashRequestorder(order);
      const apporder = await iexec.order.signApporder(
        {
          ...apporderTemplate,
          tag: '0x0000000000000000000000000000000000000000000000000000000000000003',
        },
        { preflightCheck: false },
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/requestorders', {
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
      expect(data.published.remaining).toBe(1);
      expect(data.published.status).toBe('open');
      expect(data.published.publicationTimestamp).toMatch(timestampRegex);
      expect(data.published.order).toBeDefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(1);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        1,
        `${chainId}:orders`,
        'requestorder_published',
        expect.objectContaining({ orderHash: hash }),
      );
    });

    test('POST /requestorders (already published)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const apporder = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/requestorders', {
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
          buildQuery('/requestorders', {
            chainId, // *
          }),
        )
        .send({
          chainId,
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

    test('POST /requestorders (missing chainId)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
          tag: '0xf000000000000000000000000000000000000000000000000000000000000003',
        },
        { preflightCheck: false },
      );
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(buildQuery('/requestorders', {}))
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

    test('POST /requestorders (challenge consumed)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const { data, status } = await request
        .post(
          buildQuery('/requestorders', {
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

    test('POST /requestorders (no authorization header)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/requestorders', {
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

    test('POST /requestorders (bad sign)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const apporder = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/requestorders', {
            chainId, // *
          }),
        )
        .send({
          chainId,
          order: { ...order, sign: requestorderTemplate.sign },
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(BUSINESS_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('invalid sign');
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /requestorders (order already consumed)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const apporder = await iexec.order.signApporder(apporderTemplate);
      const workerpoolorder = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      await iexec.order.matchOrders(
        {
          apporder,
          workerpoolorder,
          requestorder: order,
        },
        { preflightCheck: false },
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/requestorders', {
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

    test('POST /requestorders (missing dataset)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
          dataset: datasetorderTemplate.dataset,
        },
        { preflightCheck: false },
      );
      const apporder = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/requestorders', {
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
      expect(data.error).toBe(
        `No datasetorder published for dataset ${order.dataset}`,
      );
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /requestorders (dataset restricted is allowed)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
          dataset: datasetorderTemplate.dataset,
        },
        { preflightCheck: false },
      );
      const hash = await iexec.order.hashRequestorder(order);
      const apporder = await iexec.order.signApporder(apporderTemplate);
      const datasetorder =
        await iexec.order.signDatasetorder(datasetorderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          order: datasetorder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/requestorders', {
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
      expect(socketEmitSpy).toHaveBeenCalledTimes(1);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        1,
        `${chainId}:orders`,
        'requestorder_published',
        expect.objectContaining({ orderHash: hash }),
      );
    });

    test('POST /requestorders (check enough stake)', async () => {
      const address = await iexec.wallet.getAddress();
      const { stake } = await iexec.account.checkBalance(address);
      await iexec.account.withdraw(stake);
      await iexec.account.deposit(10);
      const order10nRlc = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
          workerpoolmaxprice: 1,
          volume: 10,
        },
        { preflightCheck: false },
      );
      const order11nRlc = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
          workerpoolmaxprice: 1,
          volume: 11,
        },
        { preflightCheck: false },
      );
      const apporder = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const resKO = await request
        .post(
          buildQuery('/requestorders', {
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
          buildQuery('/requestorders', {
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
        'requester stake is too low to cover requestorder payment, minimum stake required is 11 nRLC',
      );
      expect(resKO.data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(1);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        1,
        `${chainId}:orders`,
        'requestorder_published',
        expect.objectContaining({
          orderHash: resOK.data.published.orderHash,
        }),
      );
    }, 15000);
  });

  describe('PUT /requestorders', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      await dropDB(chainId);
    });

    test('PUT /requestorders (standard)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const hash = await iexec.order.hashRequestorder(order);
      const apporder = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/requestorders', {
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
          buildQuery('/requestorders', {
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
        'requestorder_unpublished',
        hash,
      );
    });

    test('PUT /requestorders (not published)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const hash = await iexec.order.hashRequestorder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/requestorders', {
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
        `requestorder with orderHash ${hash} is not published`,
      );
      expect(data.unpublished).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('PUT /requestorders (last)', async () => {
      const apporder = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      const order1 = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/requestorders', {
            chainId, // *
          }),
        )
        .send({
          order: order1,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      const order2 = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const hash2 = await iexec.order.hashRequestorder(order2);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/requestorders', {
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
          buildQuery('/requestorders', {
            chainId, // *
          }),
        )
        .send({
          target: UNPUBLISH_TARGET_LAST_ORDER,
          requester: order2.requester,
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
        'requestorder_unpublished',
        hash2,
      );
    });

    test('PUT /requestorders (all)', async () => {
      const apporder = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      const order1 = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const hash1 = await iexec.order.hashRequestorder(order1);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/requestorders', {
            chainId, // *
          }),
        )
        .send({
          order: order1,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      const order2 = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const hash2 = await iexec.order.hashRequestorder(order2);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/requestorders', {
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
          buildQuery('/requestorders', {
            chainId, // *
          }),
        )
        .send({
          target: UNPUBLISH_TARGET_ALL_ORDERS,
          requester: order2.requester,
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
        'requestorder_unpublished',
        expect.anything(),
      );
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        1,
        `${chainId}:orders`,
        'requestorder_unpublished',
        expect.anything(),
      );
    });

    test('PUT /requestorders (missing chainId)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const hash = await iexec.order.hashRequestorder(order);
      const apporder = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: apporder,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/requestorders', {
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
        .put(buildQuery('/requestorders', {}))
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

    test('PUT /requestorders (challenge consumed)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const hash = await iexec.order.hashRequestorder(order);
      const { data, status } = await request
        .put(
          buildQuery('/requestorders', {
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

    test('PUT /requestorders (no authorization header)', async () => {
      const order = await iexec.order.signRequestorder(
        {
          ...requestorderTemplate,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const hash = await iexec.order.hashRequestorder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/requestorders', {
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

  describe('GET /requestorders', () => {
    const iexecUser1 = getIexecRandomSigner();
    const iexecUser2 = getIexecRandomSigner();

    // order orders
    const allOrders = []; // all orders in DB
    let consumedOrders; // flagged as consumed
    let deadOrders; // flagged as dead (unmatchable)
    let publicOrders; // standard result
    let requesterSpecificOrders; // standard filtered by requester
    let beneficiarySpecificOrders; // standard filtered by beneficiary
    let appSpecificOrders; // standard filtered by app
    let datasetSpecificOrders; // standard filtered by dataset
    let category1Orders; // standard filtered by category
    let minTeeTagOrders; // standard filtered by minTag
    let maxGpuTagOrders; // standard filtered by maxTag
    let minMaxTeeTagOrders; // standard filtered by minTag & maxTag
    let minVolumeOrders; // standard filtered by minVolume
    let maxTrust5Orders; // standard filtered by maxTrust
    let workerpoolAllowedOrders; // standard extended with workerpool exclusive
    let anyWorkerpoolAllowedOrders; // standard extended with any workerpool

    // test addresses
    let requesterAddress;
    let otherAddress;
    const beneficiaryAddress = getRandomAddress();
    const appAddress = getRandomAddress();
    const datasetAddress = getRandomAddress();
    const allowedWorkerpool = getRandomAddress();

    beforeAll(async () => {
      await dropDB(chainId);

      // prepare documents

      const filterOrders = (orders, ordersToRemove) => {
        const hashesToRemove = ordersToRemove.map((o) => o.orderHash);
        return orders.filter((o) => !hashesToRemove.includes(o.orderHash));
      };

      otherAddress = await iexecUser1.wallet.getAddress();
      requesterAddress = await iexecUser2.wallet.getAddress();

      const workerpoolPrice0 = await Promise.all(
        Array(3)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...workerpoolPrice0);

      const workerpoolPrice20 = await Promise.all(
        Array(3)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 20,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...workerpoolPrice20);

      const workerpoolPrice10 = await Promise.all(
        Array(3)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 10,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...workerpoolPrice10);

      const volume1234 = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                volume: 1234,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...volume1234);

      const category1 = await Promise.all(
        Array(4)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                category: 1,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...category1);

      const requesterSpecific = await Promise.all(
        Array(1)
          .fill(null)
          .map(async () => {
            const order = await iexecUser2.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                category: 0,
              })
              .then((o) =>
                iexecUser2.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: requesterAddress,
            };
          }),
      );
      allOrders.push(...requesterSpecific);

      const beneficiarySpecific = await Promise.all(
        Array(1)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                category: 0,
                beneficiary: beneficiaryAddress,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...beneficiarySpecific);

      const appSpecific = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: appAddress,
                workerpoolmaxprice: 0,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...appSpecific);

      const datasetSpecific = await Promise.all(
        Array(3)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                dataset: datasetAddress,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...datasetSpecific);

      const tagTee = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                tag: ['tee', 'scone'],
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...tagTee);

      const tagGpu = await Promise.all(
        Array(3)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                tag: ['gpu'],
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...tagGpu);

      const tagTeeGpu = await Promise.all(
        Array(4)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                tag: ['tee', 'scone', 'gpu'],
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...tagTeeGpu);

      const workerpoolAllowed = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpool: allowedWorkerpool,
                workerpoolmaxprice: 0,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...workerpoolAllowed);

      const workerpoolNotAllowed = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpool: getRandomAddress(),
                workerpoolmaxprice: 0,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...workerpoolNotAllowed);

      const maxTrust5 = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                trust: 5,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...maxTrust5);

      const exceedMaxTrust5 = await Promise.all(
        Array(3)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                trust: 6,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
            };
          }),
      );
      allOrders.push(...exceedMaxTrust5);

      consumedOrders = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
              status: STATUS_MAP.FILLED,
            };
          }),
      );
      allOrders.push(...consumedOrders);

      deadOrders = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser1.order
              .createRequestorder({
                app: getRandomAddress(),
                workerpoolmaxprice: 0,
                category: 0,
              })
              .then((o) =>
                iexecUser1.order.signRequestorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser1.order.hashRequestorder(order);
            return {
              order,
              orderHash,
              signer: otherAddress,
              status: STATUS_MAP.DEAD,
            };
          }),
      );
      allOrders.push(...deadOrders);

      // standard result
      publicOrders = [
        ...workerpoolPrice0,
        ...workerpoolPrice20,
        ...workerpoolPrice10,
        ...volume1234,
        ...category1,
        ...requesterSpecific,
        ...beneficiarySpecific,
        ...appSpecific,
        ...datasetSpecific,
        ...tagTee,
        ...tagGpu,
        ...tagTeeGpu,
        ...maxTrust5,
        ...exceedMaxTrust5,
      ];

      // filtered result
      minVolumeOrders = volume1234;
      category1Orders = category1;
      requesterSpecificOrders = requesterSpecific;
      beneficiarySpecificOrders = beneficiarySpecific;
      appSpecificOrders = appSpecific;
      datasetSpecificOrders = datasetSpecific;
      minTeeTagOrders = [...tagTee, ...tagTeeGpu];
      minMaxTeeTagOrders = tagTee;
      maxGpuTagOrders = filterOrders(publicOrders, [...tagTee, ...tagTeeGpu]);
      maxTrust5Orders = filterOrders(publicOrders, exceedMaxTrust5);

      // extended result
      workerpoolAllowedOrders = [...publicOrders, ...workerpoolAllowed];
      anyWorkerpoolAllowedOrders = [
        ...publicOrders,
        ...workerpoolAllowed,
        ...workerpoolNotAllowed,
      ];

      await addRequestorders(chainId, allOrders);
    });

    test('GET /requestorders/:orderHash (missing chainId)', async () => {
      const { orderHash } = allOrders[allOrders.length - 1];
      const { data, status } = await request
        .get(buildQuery(`/requestorders/${orderHash}`, {}))
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('chainId is a required field');
      expect(data.order).toBeUndefined();
    });

    test('GET /requestorders/:orderHash (standard)', async () => {
      const orderToFind = allOrders[allOrders.length - 1];
      const { orderHash } = orderToFind;
      const { data, status } = await request
        .get(buildQuery(`/requestorders/${orderHash}`, { chainId }))
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

    test('GET /requestorders/:orderHash (not found)', async () => {
      const { data, status } = await request
        .get(
          buildQuery(
            '/requestorders/0xbdcc296eb42dc4e99c46b90aa8f04cb4dad48eae836a0cea3adf4291508ee765',
            {
              chainId, // *
            },
          ),
        )
        .then(parseResult);
      expect(status).toBe(NOT_FOUND_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('requestorder not found');
      expect(data.order).toBeUndefined();
    });

    test('GET /requestorders (missing chainId)', async () => {
      const { data, status } = await request
        .get(buildQuery('/requestorders', {}))
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('chainId is a required field');
      expect(data.count).toBeUndefined();
      expect(data.orders).toBeUndefined();
    });

    test('GET /requestorders (invalid pageSize)', async () => {
      await request
        .get(
          buildQuery('/requestorders', {
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
          buildQuery('/requestorders', {
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

    test('GET /requestorders (invalid pageIndex)', async () => {
      await request
        .get(
          buildQuery('/requestorders', {
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

    test('GET /requestorders (invalid isWorkerpoolStrict): should return validation error for invalid isRequesterStrict value', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            isWorkerpoolStrict: 'abc',
          }),
        )
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe(
        'isWorkerpoolStrict must be a `boolean` type, but the final value was: `"abc"`.',
      );
      expect(data.count).toBeUndefined();
      expect(data.orders).toBeUndefined();
    });

    test('GET /requestorders (no match)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            requester: getRandomAddress(), // *
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

    test('GET /requestorders (sort + pagination)', async () => {
      const res1 = await request
        .get(
          buildQuery('/requestorders', {
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
        expect(typeof curr.order.workerpoolmaxprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.dataset).toBe('string');
        expect(typeof curr.order.app).toBe('string');
        expect(curr.order.workerpool).toBe(utils.NULL_ADDRESS);
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(
            prev.order.workerpoolmaxprice >= curr.order.workerpoolmaxprice,
          ).toBe(true);
          if (prev.order.workerpoolmaxprice === curr.order.workerpoolmaxprice) {
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
          buildQuery('/requestorders', {
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
        expect(curr.order.workerpool).toBe(utils.NULL_ADDRESS);
        expect(typeof curr.order.workerpoolmaxprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.dataset).toBe('string');
        expect(typeof curr.order.app).toBe('string');
        expect(typeof curr.order.workerpool).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(
            prev.order.workerpoolmaxprice >= curr.order.workerpoolmaxprice,
          ).toBe(true);
          if (prev.order.workerpoolmaxprice === curr.order.workerpoolmaxprice) {
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
          buildQuery('/requestorders', {
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
      expect(res3.data.orders.length).toBe(0);
    });

    test('GET /requestorders (sort + legacy pagination)', async () => {
      const res1 = await request
        .get(
          buildQuery('/requestorders', {
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
        expect(typeof curr.order.workerpoolmaxprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.dataset).toBe('string');
        expect(typeof curr.order.app).toBe('string');
        expect(curr.order.workerpool).toBe(utils.NULL_ADDRESS);
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(
            prev.order.workerpoolmaxprice >= curr.order.workerpoolmaxprice,
          ).toBe(true);
          if (prev.order.workerpoolmaxprice === curr.order.workerpoolmaxprice) {
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
          buildQuery('/requestorders', {
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
        expect(curr.order.workerpool).toBe(utils.NULL_ADDRESS);
        expect(typeof curr.order.workerpoolmaxprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.dataset).toBe('string');
        expect(typeof curr.order.app).toBe('string');
        expect(typeof curr.order.workerpool).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(
            prev.order.workerpoolmaxprice >= curr.order.workerpoolmaxprice,
          ).toBe(true);
          if (prev.order.workerpoolmaxprice === curr.order.workerpoolmaxprice) {
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

    test('GET /requestorders (any app, any dataset, any requester, any workerpool)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
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

    test('GET /requestorders (isAppStrict = true & app = undefined): should return public orders including "any" app', async () => {
      const result = await request
        .get(
          buildQuery('/requestorders', {
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

    test('GET /requestorders (isDatasetStrict = true & dataset = undefined): should return public orders including "any" dataset', async () => {
      const result = await request
        .get(
          buildQuery('/requestorders', {
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

    test('GET /requestorders (isWorkerpoolStrict = true & workerpool = undefined): should return public orders including "any" workerpool', async () => {
      const result = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            isWorkerpoolStrict: true,
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

    test('GET /requestorders (workerpool filter & isWorkerpoolStrict): should exclude orders with "any" workerpool authorized', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            workerpool: allowedWorkerpool,
            isWorkerpoolStrict: true,
          }),
        )
        .then(parseResult);

      const ordersExcludingAnyWorkerpool = workerpoolAllowedOrders.filter(
        (order) => order.order.workerpool !== utils.NULL_ADDRESS,
      );
      expect(workerpoolAllowedOrders.length).toBeGreaterThan(
        ordersExcludingAnyWorkerpool.length,
      ); // ensure orders will be filtered
      expect(ordersExcludingAnyWorkerpool.length).toBeGreaterThan(0); // ensure the expected result is not empty

      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(ordersExcludingAnyWorkerpool.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(ordersExcludingAnyWorkerpool.length);
      data.orders.forEach((e) =>
        expect(e.order.workerpool).toBe(allowedWorkerpool),
      );
    });
    test('GET /requestorders (requester filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            requester: requesterAddress,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(requesterSpecificOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(requesterSpecificOrders.length);
      data.orders.forEach((e) => {
        expect(e.order.requester).toBe(requesterAddress);
        expect(e.signer).toBe(requesterAddress);
      });
    });

    test('GET /requestorders (beneficiary filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            beneficiary: beneficiaryAddress,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(beneficiarySpecificOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(beneficiarySpecificOrders.length);
      data.orders.forEach((e) => {
        expect(e.order.beneficiary).toBe(beneficiaryAddress);
      });
    });

    test('GET /requestorders (app filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            app: appAddress,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(appSpecificOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(appSpecificOrders.length);
      data.orders.forEach((e) => {
        expect(e.order.app === appAddress).toBe(true);
      });
    });

    test('GET /requestorders (dataset filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            dataset: datasetAddress,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(datasetSpecificOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(datasetSpecificOrders.length);
      data.orders.forEach((e) => {
        expect(e.order.dataset === datasetAddress).toBe(true);
      });
    });

    test('GET /requestorders (minVolume filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
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

    test('GET /requestorders (maxTrust filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            maxTrust: 5,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(maxTrust5Orders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(20);
      data.orders.forEach((e) => {
        expect(e.order.trust <= 5).toBe(true);
      });
    });

    test('GET /requestorders (category filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
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

    test('GET /requestorders (minTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
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

    test('GET /requestorders (maxTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
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

    test('GET /requestorders (minTag & maxTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
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

    test('GET /requestorders (workerpool exclusive orders)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            workerpool: allowedWorkerpool,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(workerpoolAllowedOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(20);
      data.orders.forEach((e) => {
        expect(
          e.order.workerpool === allowedWorkerpool ||
            e.order.workerpool === utils.NULL_ADDRESS,
        ).toBe(true);
      });
    });

    test('GET /requestorders (any workerpool orders)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/requestorders', {
            chainId, // *
            workerpool: 'any',
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(anyWorkerpoolAllowedOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(20);
    });
  });
});
