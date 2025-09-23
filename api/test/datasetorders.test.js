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
  sleep,
  parseResult,
  buildQuery,
  setChallenge,
  find,
  dropDB,
  addDatasetorders,
  getRandomAddress,
  deployDatasetFor,
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

describe('Offchain marketplace', () => {
  let apporderTemplate;
  let datasetorderTemplate;
  let workerpoolorderTemplate;

  beforeAll(async () => {
    apporderTemplate = await deployAndGetApporder(iexec);
    datasetorderTemplate = await deployAndGetDatasetorder(iexec);
    workerpoolorderTemplate = await deployAndGetWorkerpoolorder(iexec);
  });

  describe('POST /datasetorders', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      await dropDB(chainId);
    });

    test('POST /datasetorders (standard)', async () => {
      const order = await iexec.order.signDatasetorder(
        {
          ...datasetorderTemplate,
          tag: '0x1000000000000000000000000000000000000000000000000000000000000103',
        },
        { preflightCheck: false },
      );
      const hash = await iexec.order.hashDatasetorder(order);
      const address = await iexec.wallet.getAddress();
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/datasetorders', {
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
        'datasetorder_published',
        expect.objectContaining({ orderHash: hash }),
      );
    });

    test('POST /datasetorders (already published)', async () => {
      const order = await iexec.order.signDatasetorder(datasetorderTemplate);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/datasetorders', {
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
          buildQuery('/datasetorders', {
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

    test('POST /datasetorders (missing chainId)', async () => {
      const order = await iexec.order.signDatasetorder(
        {
          ...datasetorderTemplate,
          tag: '0x1000000000000000000000000000000000000000000000000000000000000103',
        },
        { preflightCheck: false },
      );
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(buildQuery('/datasetorders', {}))
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

    test('POST /datasetorders (challenge consumed)', async () => {
      const order = await iexec.order.signDatasetorder(datasetorderTemplate);
      jest.clearAllMocks();
      const { data, status } = await request
        .post(
          buildQuery('/datasetorders', {
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

    test('POST /datasetorders (no authorization header)', async () => {
      const order = await iexec.order.signDatasetorder(datasetorderTemplate);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/datasetorders', {
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

    test('POST /datasetorders (bad sign)', async () => {
      const order = await iexec.order.signDatasetorder(datasetorderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          order: { ...order, sign: datasetorderTemplate.sign },
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(BUSINESS_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('invalid sign');
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /datasetorders (order already consumed)', async () => {
      const order = await iexec.order.signDatasetorder({
        ...datasetorderTemplate,
        volume: 1,
      });
      const apporder = await iexec.order.signApporder(apporderTemplate);
      const workerpoolorder = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const requestorder = await getMatchableRequestorder(iexec, {
        apporder,
        datasetorder: order,
        workerpoolorder,
      });
      await iexec.order.matchOrders(
        {
          apporder,
          datasetorder: order,
          workerpoolorder,
          requestorder,
        },
        { preflightCheck: false },
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/datasetorders', {
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

    test('POST /datasetorders (apprestrict is allowed)', async () => {
      const order = await iexec.order.signDatasetorder({
        ...datasetorderTemplate,
        apprestrict: apporderTemplate.app,
      });
      const hash = await iexec.order.hashDatasetorder(order);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/datasetorders', {
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
        'datasetorder_published',
        expect.objectContaining({ orderHash: hash }),
      );
    });
  });

  describe('PUT /datasetorders', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      await dropDB(chainId);
    });

    test('PUT /datasetorders (standard)', async () => {
      const order = await iexec.order.signDatasetorder(datasetorderTemplate);
      const hash = await iexec.order.hashDatasetorder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      jest.clearAllMocks();
      const { data, status } = await request
        .put(
          buildQuery('/datasetorders', {
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
        'datasetorder_unpublished',
        hash,
      );
    });

    test('PUT /datasetorders (not published)', async () => {
      const order = await iexec.order.signDatasetorder(datasetorderTemplate);
      const hash = await iexec.order.hashDatasetorder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/datasetorders', {
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
        `datasetorder with orderHash ${hash} is not published`,
      );
      expect(data.unpublished).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('PUT /datasetorders (last)', async () => {
      const order1 = await iexec.order.signDatasetorder(datasetorderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          order: order1,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      const order2 = await iexec.order.signDatasetorder(datasetorderTemplate);
      const hash2 = await iexec.order.hashDatasetorder(order2);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/datasetorders', {
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
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          target: UNPUBLISH_TARGET_LAST_ORDER,
          dataset: order2.dataset,
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
        'datasetorder_unpublished',
        hash2,
      );
    });

    test('PUT /datasetorders (all)', async () => {
      const order1 = await iexec.order.signDatasetorder(datasetorderTemplate);
      const hash1 = await iexec.order.hashDatasetorder(order1);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          order: order1,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      const order2 = await iexec.order.signDatasetorder(datasetorderTemplate);
      const hash2 = await iexec.order.hashDatasetorder(order2);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/datasetorders', {
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
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          target: UNPUBLISH_TARGET_ALL_ORDERS,
          dataset: order2.dataset,
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
        'datasetorder_unpublished',
        expect.anything(),
      );
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        2,
        `${chainId}:orders`,
        'datasetorder_unpublished',
        expect.anything(),
      );
    });

    test('PUT /datasetorders (missing chainId)', async () => {
      const order = await iexec.order.signDatasetorder(datasetorderTemplate);
      const hash = await iexec.order.hashDatasetorder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      jest.clearAllMocks();
      const { data, status } = await request
        .put(buildQuery('/datasetorders', {}))
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

    test('PUT /datasetorders (challenge consumed)', async () => {
      const order = await iexec.order.signDatasetorder(datasetorderTemplate);
      const hash = await iexec.order.hashDatasetorder(order);
      const { data, status } = await request
        .put(
          buildQuery('/datasetorders', {
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

    test('PUT /datasetorders (no authorization header)', async () => {
      const order = await iexec.order.signDatasetorder(datasetorderTemplate);
      const hash = await iexec.order.hashDatasetorder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/datasetorders', {
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

    test('PUT /datasetorders (clean dependant requestorders)', async () => {
      const order = await iexec.order.signDatasetorder(datasetorderTemplate);
      const order1nRlc = await iexec.order.signDatasetorder({
        ...datasetorderTemplate,
        datasetprice: 1,
      });
      const order5nRlc = await iexec.order.signDatasetorder({
        ...datasetorderTemplate,
        datasetprice: 5,
      });
      const orderPrivate1 = await iexec.order.signDatasetorder({
        ...datasetorderTemplate,
        requesterrestrict: await iexec.wallet.getAddress(),
      });
      const orderPrivate2 = await iexec.order.signDatasetorder({
        ...datasetorderTemplate,
        requesterrestrict: await iexec.wallet.getAddress(),
      });
      const orderPrivateOtherUser = await iexec.order.signDatasetorder({
        ...datasetorderTemplate,
        requesterrestrict: '0x500b6F7fF2817F85c8bBBe4D70Ae4E10809a54cF',
      });
      const order1nRlcHash = await iexec.order.hashDatasetorder(order1nRlc);
      const orderPrivate1Hash =
        await iexec.order.hashDatasetorder(orderPrivate1);
      const orderPrivate2Hash =
        await iexec.order.hashDatasetorder(orderPrivate2);
      await iexec.account.deposit(5);
      const apporder = await iexec.order.signApporder(apporderTemplate);
      const workerpoolorder = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const matchableRequestorder = await getMatchableRequestorder(iexec, {
        apporder,
        datasetorder: order,
        workerpoolorder,
      });
      const requestorder = await iexec.order.signRequestorder(
        {
          ...matchableRequestorder,
          datasetmaxprice: 0,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const requestorderUsePrivate = await iexec.order.signRequestorder(
        requestorder,
        { preflightCheck: false },
      );
      const requestorder1nRlc = await iexec.order.signRequestorder(
        {
          ...requestorder,
          datasetmaxprice: 1,
        },
        { preflightCheck: false },
      );
      const requestorder5nRlc = await iexec.order.signRequestorder(
        {
          ...requestorder,
          datasetmaxprice: 5,
        },
        { preflightCheck: false },
      );
      const requestorderUsePrivateHash = await iexec.order.hashRequestorder(
        requestorderUsePrivate,
      );
      const requestorder1nRlcHash =
        await iexec.order.hashRequestorder(requestorder1nRlc);
      const requestorder5nRlcHash =
        await iexec.order.hashRequestorder(requestorder5nRlc);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          chainId,
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
          chainId,
          order: order1nRlc,
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
          chainId,
          order: order5nRlc,
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
          chainId,
          order: orderPrivate1,
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
          chainId,
          order: orderPrivate2,
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
          chainId,
          order: orderPrivateOtherUser,
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
          chainId,
          order: requestorder1nRlc,
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
          chainId,
          order: requestorder5nRlc,
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
          chainId,
          order: requestorderUsePrivate,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);

      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .put(
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          chainId,
          orderHash: orderPrivate1Hash,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await sleep(1000);
      expect(socketEmitSpy).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .put(
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          chainId,
          orderHash: orderPrivate2Hash,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await sleep(1000);
      const [[savedRequestorderUsePrivate]] = await Promise.all([
        find(chainId, 'requestorders', {
          orderHash: requestorderUsePrivateHash,
        }),
      ]);
      expect(savedRequestorderUsePrivate).toBeDefined();
      expect(savedRequestorderUsePrivate.status).toBe('dead');
      expect(socketEmitSpy).toHaveBeenCalledTimes(2);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        2,
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestorderUsePrivateHash,
      );

      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .put(
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .send({
          chainId,
          orderHash: order1nRlcHash,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await sleep(1000);
      const [[savedRequestorder1nRlc], [savedRequestorder5nRlc]] =
        await Promise.all([
          find(chainId, 'requestorders', {
            orderHash: requestorder1nRlcHash,
          }),
          find(chainId, 'requestorders', {
            orderHash: requestorder5nRlcHash,
          }),
        ]);
      expect(savedRequestorder1nRlc).toBeDefined();
      expect(savedRequestorder1nRlc.status).toBe('dead');
      expect(savedRequestorder5nRlc).toBeDefined();
      expect(savedRequestorder5nRlc.status).toBe('open');
      expect(socketEmitSpy).toHaveBeenCalledTimes(2);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        2,
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestorder1nRlcHash,
      );
    });
  });

  describe('GET /datasetorders', () => {
    const iexecUser = getIexecRandomSigner();
    const iexecResourceOwner = getIexecRandomSigner();
    const allOrders = [];
    const publicOrders = [];
    const ownersOrders = [];
    const appAllowedOrders = [];
    const workerpoolAllowedOrders = [];
    const requesterAllowedOrders = [];
    const anyAppAllowedOrders = [];
    const anyRequesterAllowedOrders = [];
    const anyWorkerpoolAllowedOrders = [];
    const minTeeTagOrders = [];
    const maxGpuTagOrders = [];
    const minMaxTeeTagOrders = [];
    const minVolumeOrders = [];
    const bulkOrders = [];
    let consumedOrders;
    let deadOrders;
    let datasetAddress;
    let otherAddress;
    let resourceOwnerAddress;
    const allowedApp = getRandomAddress();
    const allowedWorkerpool = getRandomAddress();
    const allowedRequester = getRandomAddress();

    beforeAll(async () => {
      await dropDB(chainId);
      // prepare documents
      const ownerAddress = await iexecUser.wallet.getAddress();
      resourceOwnerAddress = await iexecResourceOwner.wallet.getAddress();

      datasetAddress = await deployDatasetFor(iexec, ownerAddress);
      otherAddress = await deployDatasetFor(iexec, ownerAddress);
      const resourceOwnerDatasetAddress = await deployDatasetFor(
        iexec,
        resourceOwnerAddress,
      );

      const noRestrictOrders = [];

      const datasetPrice0 = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      noRestrictOrders.push(...datasetPrice0);
      allOrders.push(...datasetPrice0);

      const bulk = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0, // bulk order must be free
                volume: Number.MAX_SAFE_INTEGER, // bulk order must have max volume
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      bulkOrders.push(...bulk);
      minVolumeOrders.push(...bulk);
      noRestrictOrders.push(...bulk);
      allOrders.push(...bulk);

      const datasetPrice20 = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 20,
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      noRestrictOrders.push(...datasetPrice20);
      allOrders.push(...datasetPrice20);

      const datasetPrice10 = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 10,
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      noRestrictOrders.push(...datasetPrice10);
      allOrders.push(...datasetPrice10);

      const volume1234 = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
                volume: 1234,
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
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

      publicOrders.push(...noRestrictOrders);

      const owners = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecResourceOwner.order
              .createDatasetorder({
                dataset: resourceOwnerDatasetAddress,
                datasetprice: 50,
              })
              .then(iexecResourceOwner.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
            return {
              order,
              orderHash,
              signer: resourceOwnerAddress,
            };
          }),
      );
      ownersOrders.push(...owners);
      allOrders.push(...owners);

      const tagTee = await Promise.all(
        Array(2)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
                tag: ['tee', 'scone'],
              })
              .then((o) =>
                iexecUser.order.signDatasetorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser.order.hashDatasetorder(order);
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
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
                tag: ['gpu'],
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
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
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
                tag: ['tee', 'scone', 'gpu'],
              })
              .then((o) =>
                iexecUser.order.signDatasetorder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser.order.hashDatasetorder(order);
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
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
                apprestrict: allowedApp,
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
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
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
                apprestrict: getRandomAddress(),
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
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

      const workerpoolAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
                workerpoolrestrict: allowedWorkerpool,
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      workerpoolAllowedOrders.push(...workerpoolAllowed, ...publicOrders);
      allOrders.push(...workerpoolAllowed);

      const workerpoolNotAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
                workerpoolrestrict: getRandomAddress(),
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      anyWorkerpoolAllowedOrders.push(
        ...workerpoolAllowed,
        ...workerpoolNotAllowed,
        ...publicOrders,
      );
      allOrders.push(...workerpoolNotAllowed);

      const requesterAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
                requesterrestrict: allowedRequester,
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
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
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
                requesterrestrict: getRandomAddress(),
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
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
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
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
              .createDatasetorder({
                dataset: datasetAddress,
                datasetprice: 0,
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
              status: STATUS_MAP.DEAD,
            };
          }),
      );
      allOrders.push(...deadOrders);

      const otherDataset = await Promise.all(
        Array(10)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createDatasetorder({
                dataset: otherAddress,
                datasetprice: 0,
              })
              .then(iexecUser.order.signDatasetorder);
            const orderHash = await iexecUser.order.hashDatasetorder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      allOrders.push(...otherDataset);

      await addDatasetorders(chainId, allOrders);
    });

    test('GET /datasetorders/:orderHash (missing chainId)', async () => {
      const { orderHash } = allOrders[allOrders.length - 1];
      const { data, status } = await request
        .get(buildQuery(`/datasetorders/${orderHash}`, {}))
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('chainId is a required field');
      expect(data.order).toBeUndefined();
    });

    test('GET /datasetorders/:orderHash (standard)', async () => {
      const orderToFind = allOrders[allOrders.length - 1];
      const { orderHash } = orderToFind;
      const { data, status } = await request
        .get(buildQuery(`/datasetorders/${orderHash}`, { chainId }))
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.order).toBeDefined();
      expect(data.orderHash).toBe(orderHash);
      expect(data.order.dataset).toBe(orderToFind.order.dataset);
      expect(data.remaining).toBeDefined();
      expect(data.publicationTimestamp).toBeDefined();
      expect(data.status).toBeDefined();
      expect(data.signer).toBeDefined();
    });

    test('GET /datasetorders/:orderHash (not found)', async () => {
      const { data, status } = await request
        .get(
          buildQuery(
            '/datasetorders/0xbdcc296eb42dc4e99c46b90aa8f04cb4dad48eae836a0cea3adf4291508ee765',
            {
              chainId, // *
            },
          ),
        )
        .then(parseResult);
      expect(status).toBe(NOT_FOUND_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('datasetorder not found');
      expect(data.order).toBeUndefined();
    });

    test('GET /datasetorders (missing dataset or datasetOwner)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
          }),
        )
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('dataset or datasetOwner is required');
      expect(data.count).toBeUndefined();
      expect(data.orders).toBeUndefined();
    });

    test('GET /datasetorders (missing chainId)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            dataset: datasetAddress, // *
          }),
        )
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('chainId is a required field');
      expect(data.count).toBeUndefined();
      expect(data.orders).toBeUndefined();
    });

    test('GET /datasetorders (invalid pageSize)', async () => {
      await request
        .get(
          buildQuery('/datasetorders', {
            dataset: datasetAddress, // *
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
          buildQuery('/datasetorders', {
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (invalid pageIndex)', async () => {
      await request
        .get(
          buildQuery('/datasetorders', {
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (invalid isAppStrict): should return validation error for invalid isAppStrict value', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (invalid isWorkerpoolStrict): should return validation error for invalid isWorkerpoolStrict value', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (invalid isRequesterStrict): should return validation error for invalid isRequesterStrict value', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (no match)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: getRandomAddress(), // *
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

    test('GET /datasetorders (sort + pagination)', async () => {
      const res1 = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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
        expect(curr.order.dataset).toBe(datasetAddress);
        expect(typeof curr.order.datasetprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.apprestrict).toBe('string');
        expect(typeof curr.order.workerpoolrestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.datasetprice <= curr.order.datasetprice).toBe(true);
          if (prev.order.datasetprice === curr.order.datasetprice) {
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
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
            pageIndex: 1,
            pageSize: 25,
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
        expect(curr.order.dataset).toBe(datasetAddress);
        expect(typeof curr.order.datasetprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.apprestrict).toBe('string');
        expect(typeof curr.order.workerpoolrestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.datasetprice <= curr.order.datasetprice).toBe(true);
          if (prev.order.datasetprice === curr.order.datasetprice) {
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
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
            pageIndex: 100,
            pageSize: 25,
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

    test('GET /datasetorders (sort + legacy pagination)', async () => {
      const res1 = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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
        expect(curr.order.dataset).toBe(datasetAddress);
        expect(typeof curr.order.datasetprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.apprestrict).toBe('string');
        expect(typeof curr.order.workerpoolrestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.datasetprice <= curr.order.datasetprice).toBe(true);
          if (prev.order.datasetprice === curr.order.datasetprice) {
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
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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
        expect(curr.order.dataset).toBe(datasetAddress);
        expect(typeof curr.order.datasetprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.apprestrict).toBe('string');
        expect(typeof curr.order.workerpoolrestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.datasetprice <= curr.order.datasetprice).toBe(true);
          if (prev.order.datasetprice === curr.order.datasetprice) {
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

    test('GET /datasetorders (any dataset, any app, any requester, any workerpool)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: 'any', // *
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

    test('GET /datasetorders (datasetOwner filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            datasetOwner: resourceOwnerAddress, // *
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

    test('GET /datasetorders (minVolume filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (bulkOnly filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
            bulkOnly: true,
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.count).toBe(bulkOrders.length);
      expect(data.orders).toBeDefined();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBe(bulkOrders.length);
    });

    test('GET /datasetorders (isAppStrict = true & app = undefined): should return public orders including "any" app', async () => {
      const result = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (isWorkerpoolStrict = true & workerpool = undefined): should return public orders including "any" workerpool', async () => {
      const result = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (isRequesterStrict = true & requester = undefined): should return public orders including "any" requester', async () => {
      const result = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (app filter & isAppStrict): should exclude orders with "any" app authorized', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (workerpool filter & isWorkerpoolStrict): should exclude orders with "any" workerpool authorized', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
            workerpool: allowedWorkerpool,
            isWorkerpoolStrict: true,
          }),
        )
        .then(parseResult);

      const ordersExcludingAnyWorkerpool = workerpoolAllowedOrders.filter(
        (order) => order.order.workerpoolrestrict !== utils.NULL_ADDRESS,
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
        expect(e.order.workerpoolrestrict).toBe(allowedWorkerpool),
      );
    });

    test('GET /datasetorders (requester filter & isRequesterStrict): should exclude orders with "any" requester authorized', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (app filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (any app filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (workerpool filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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
          e.order.workerpoolrestrict === allowedWorkerpool ||
            e.order.workerpoolrestrict === utils.NULL_ADDRESS,
        ).toBe(true);
      });
    });

    test('GET /datasetorders (any workerpool filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (requester filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (any requester filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (minTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (maxTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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

    test('GET /datasetorders (minTag & maxTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/datasetorders', {
            chainId, // *
            dataset: datasetAddress, // *
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
