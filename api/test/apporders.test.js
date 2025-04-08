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
  addApporders,
  getRandomAddress,
  deployAppFor,
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

describe('/apporders', () => {
  let apporderTemplate;
  let workerpoolorderTemplate;

  beforeAll(async () => {
    apporderTemplate = await deployAndGetApporder(iexec);
    workerpoolorderTemplate = await deployAndGetWorkerpoolorder(iexec);
  });

  describe('POST /apporders', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      await dropDB(chainId);
    });

    test('POST /apporders (standard)', async () => {
      const order = await iexec.order.signApporder(
        {
          ...apporderTemplate,
          tag: '0x1000000000000000000000000000000000000000000000000000000000000103',
        },
        { preflightCheck: false },
      );
      const hash = await iexec.order.hashApporder(order);
      const address = await iexec.wallet.getAddress();
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/apporders', {
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
        'apporder_published',
        expect.objectContaining({ orderHash: hash }),
      );
    });

    test('POST /apporders (already published)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
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
          buildQuery('/apporders', {
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

    test('POST /apporders (missing chainId)', async () => {
      const order = await iexec.order.signApporder(
        {
          ...apporderTemplate,
          tag: '0x1000000000000000000000000000000000000000000000000000000000000103',
        },
        { preflightCheck: false },
      );
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(buildQuery('/apporders', {}))
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

    test('POST /apporders (challenge consumed)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      const { data, status } = await request
        .post(
          buildQuery('/apporders', {
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

    test('POST /apporders (challenge address mismatch)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, {
        ...WALLETS.DEFAULT.challenge,
        address: getRandomAddress(),
      });
      const { data, status } = await request
        .post(
          buildQuery('/apporders', {
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

    test('POST /apporders (no authorization header)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/apporders', {
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

    test('POST /apporders (bad sign)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: {
            ...order,
            sign: apporderTemplate.sign,
          },
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      expect(status).toBe(BUSINESS_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('invalid sign');
      expect(data.published).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('POST /apporders (order already consumed)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      const workerpoolorder = await iexec.order.signWorkerpoolorder(
        workerpoolorderTemplate,
      );
      const requestorder = await getMatchableRequestorder(iexec, {
        apporder: order,
        workerpoolorder,
      });
      await iexec.order.matchOrders(
        {
          apporder: order,
          workerpoolorder,
          requestorder,
        },
        { preflightCheck: false },
      );
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .post(
          buildQuery('/apporders', {
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
  });

  describe('PUT /apporders', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      await dropDB(chainId);
    });

    test('PUT /apporders (standard)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      const hash = await iexec.order.hashApporder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
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
          buildQuery('/apporders', {
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
        'apporder_unpublished',
        hash,
      );
    });

    test('PUT /apporders (not published)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      const hash = await iexec.order.hashApporder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/apporders', {
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
        `apporder with orderHash ${hash} is not published`,
      );
      expect(data.unpublished).toBeUndefined();
      expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    });

    test('PUT /apporders (last)', async () => {
      const order1 = await iexec.order.signApporder(apporderTemplate);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: order1,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      const order2 = await iexec.order.signApporder(apporderTemplate);
      const hash2 = await iexec.order.hashApporder(order2);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
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
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          target: UNPUBLISH_TARGET_LAST_ORDER,
          app: order2.app,
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
        'apporder_unpublished',
        hash2,
      );
    });

    test('PUT /apporders (all)', async () => {
      const order1 = await iexec.order.signApporder(apporderTemplate);
      const hash1 = await iexec.order.hashApporder(order1);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: order1,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      const order2 = await iexec.order.signApporder(apporderTemplate);
      const hash2 = await iexec.order.hashApporder(order2);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
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
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          target: UNPUBLISH_TARGET_ALL_ORDERS,
          app: order2.app,
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
        'apporder_unpublished',
        expect.anything(),
      );
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        2,
        `${chainId}:orders`,
        'apporder_unpublished',
        expect.anything(),
      );
    });

    test('PUT /apporders (missing chainId)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      const hash = await iexec.order.hashApporder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
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
        .put(buildQuery('/apporders', {}))
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

    test('PUT /apporders (challenge consumed)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      const hash = await iexec.order.hashApporder(order);
      const { data, status } = await request
        .put(
          buildQuery('/apporders', {
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

    test('PUT /apporders (no authorization header)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      const hash = await iexec.order.hashApporder(order);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      const { data, status } = await request
        .put(
          buildQuery('/apporders', {
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

    test('PUT /apporders (clean dependant requestorders)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      const order1nRlc = await iexec.order.signApporder({
        ...apporderTemplate,
        appprice: 1,
      });
      const order5nRlc = await iexec.order.signApporder({
        ...apporderTemplate,
        appprice: 5,
      });
      const orderPrivate1 = await iexec.order.signApporder({
        ...apporderTemplate,
        requesterrestrict: await iexec.wallet.getAddress(),
      });
      const orderPrivate2 = await iexec.order.signApporder({
        ...apporderTemplate,
        requesterrestrict: await iexec.wallet.getAddress(),
      });
      const orderPrivateOtherUser = await iexec.order.signApporder({
        ...apporderTemplate,
        requesterrestrict: '0x500b6F7fF2817F85c8bBBe4D70Ae4E10809a54cF',
      });
      const order1nRlcHash = await iexec.order.hashApporder(order1nRlc);
      const orderPrivate1Hash = await iexec.order.hashApporder(orderPrivate1);
      const orderPrivate2Hash = await iexec.order.hashApporder(orderPrivate2);
      await iexec.account.deposit(5);
      const matchableRequestorder = await getMatchableRequestorder(iexec, {
        apporder: order,
        workerpoolorder: workerpoolorderTemplate,
      });
      const requestorderUsePrivate = await iexec.order.signRequestorder(
        {
          ...matchableRequestorder,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const requestorder2nRlc = await iexec.order.signRequestorder(
        {
          ...matchableRequestorder,
          appmaxprice: 2,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const requestorder5nRlc = await iexec.order.signRequestorder(
        {
          ...matchableRequestorder,
          appmaxprice: 5,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const requestUsePrivateHash = await iexec.order.hashRequestorder(
        requestorderUsePrivate,
      );
      const request2nRlcHash =
        await iexec.order.hashRequestorder(requestorder2nRlc);
      const request5nRlcHash =
        await iexec.order.hashRequestorder(requestorder5nRlc);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: order1nRlc,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: order5nRlc,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: orderPrivate1,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          order: orderPrivate2,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
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
          order: requestorder2nRlc,
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
          order: requestorderUsePrivate,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);

      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .put(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
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
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          orderHash: orderPrivate2Hash,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);

      await sleep(1000);
      const [[savedRequestorderUsePrivate]] = await Promise.all([
        find(chainId, 'requestorders', {
          orderHash: requestUsePrivateHash,
        }),
      ]);
      expect(savedRequestorderUsePrivate).toBeDefined();
      expect(savedRequestorderUsePrivate.status).toBe('dead');
      expect(socketEmitSpy).toHaveBeenCalledTimes(2);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        2,
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestUsePrivateHash,
      );

      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .put(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          orderHash: order1nRlcHash,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);

      await sleep(1000);
      const [[savedRequestorder2nRlc], [savedRequestorder5nRlc]] =
        await Promise.all([
          find(chainId, 'requestorders', {
            orderHash: request2nRlcHash,
          }),
          find(chainId, 'requestorders', {
            orderHash: request5nRlcHash,
          }),
        ]);
      expect(savedRequestorder2nRlc).toBeDefined();
      expect(savedRequestorder2nRlc.status).toBe('dead');
      expect(savedRequestorder5nRlc).toBeDefined();
      expect(savedRequestorder5nRlc.status).toBe('open');
      expect(socketEmitSpy).toHaveBeenCalledTimes(2);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        2,
        `${chainId}:orders`,
        'requestorder_unpublished',
        request2nRlcHash,
      );
    });

    test('PUT /apporders (clean dependant tee requestorders)', async () => {
      const order = await iexec.order.signApporder(apporderTemplate);
      const orderTee = await iexec.order.signApporder(
        {
          ...apporderTemplate,
          tag: ['tee', 'scone'],
        },
        { preflightCheck: false },
      );
      const appTeeHash = await iexec.order.hashApporder(orderTee);
      const matchableRequestorder = await getMatchableRequestorder(iexec, {
        apporder: orderTee,
        workerpoolorder: workerpoolorderTemplate,
      });
      const requestorder = await iexec.order.signRequestorder(
        {
          ...matchableRequestorder,
          appmaxprice: 0,
          workerpool: utils.NULL_ADDRESS,
        },
        { preflightCheck: false },
      );
      const requestorderTee = await iexec.order.signRequestorder(
        {
          ...matchableRequestorder,
          appmaxprice: 0,
          workerpool: utils.NULL_ADDRESS,
          tag: ['tee', 'scone'],
        },
        { preflightCheck: false },
      );

      const requestHash = await iexec.order.hashRequestorder(requestorder);
      const requestTeeHash =
        await iexec.order.hashRequestorder(requestorderTee);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          chainId,
          order,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .post(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          chainId,
          order: orderTee,
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
          order: requestorder,
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
          order: requestorderTee,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);
      jest.clearAllMocks();
      await setChallenge(chainId, WALLETS.DEFAULT.challenge);
      await request
        .put(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .send({
          chainId,
          orderHash: appTeeHash,
        })
        .set('authorization', WALLETS.DEFAULT.authorization)
        .then(parseResult);

      await sleep(1000);
      const [[savedRequestorder], [savedRequestorderTee]] = await Promise.all([
        find(chainId, 'requestorders', {
          orderHash: requestHash,
        }),
        find(chainId, 'requestorders', {
          orderHash: requestTeeHash,
        }),
      ]);
      expect(savedRequestorder).toBeDefined();
      expect(savedRequestorder.status).toBe('open');
      expect(savedRequestorderTee).toBeDefined();
      expect(savedRequestorderTee.status).toBe('dead');
      expect(socketEmitSpy).toHaveBeenCalledTimes(2);
      expect(socketEmitSpy).toHaveBeenNthCalledWith(
        2,
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestTeeHash,
      );
    });
  });

  describe('GET /apporders', () => {
    const iexecUser = getIexecRandomSigner();
    const iexecResourceOwner = getIexecRandomSigner();
    const allOrders = [];
    const publicOrders = [];
    const ownersOrders = [];
    const datasetAllowedOrders = [];
    const workerpoolAllowedOrders = [];
    const requesterAllowedOrders = [];
    const anyDatasetAllowedOrders = [];
    const anyWorkerpoolAllowedOrders = [];
    const anyRequesterAllowedOrders = [];
    const minTeeTagOrders = [];
    const maxGpuTagOrders = [];
    const minMaxTeeTagOrders = [];
    const minVolumeOrders = [];
    let consumedOrders;
    let deadOrders;
    let appAddress;
    let otherAddress;
    let resourceOwnerAddress;
    const allowedDataset = getRandomAddress();
    const allowedWorkerpool = getRandomAddress();
    const allowedRequester = getRandomAddress();

    beforeAll(async () => {
      await dropDB(chainId);
      // prepare documents
      const ownerAddress = await iexecUser.wallet.getAddress();
      resourceOwnerAddress = await iexecResourceOwner.wallet.getAddress();

      appAddress = await deployAppFor(iexec, ownerAddress);
      otherAddress = await deployAppFor(iexec, ownerAddress);
      const resourceOwnerAppAddress = await deployAppFor(
        iexec,
        resourceOwnerAddress,
      );

      const noRestrictOrders = [];

      const appPrice0 = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createApporder({ app: appAddress, appprice: 0 })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      noRestrictOrders.push(...appPrice0);
      allOrders.push(...appPrice0);

      const appPrice20 = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createApporder({ app: appAddress, appprice: 20 })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      noRestrictOrders.push(...appPrice20);
      allOrders.push(...appPrice20);

      const appPrice10 = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createApporder({ app: appAddress, appprice: 10 })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      noRestrictOrders.push(...appPrice10);
      allOrders.push(...appPrice10);

      const volume1234 = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createApporder({
                app: appAddress,
                appprice: 0,
                volume: 1234,
              })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
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
              .createApporder({
                app: resourceOwnerAppAddress,
                appprice: 50,
              })
              .then(iexecResourceOwner.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
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
              .createApporder({
                app: appAddress,
                appprice: 0,
                tag: ['tee', 'scone'],
              })
              .then((o) =>
                iexecUser.order.signApporder(o, {
                  preflightCheck: false,
                }),
              );
            const orderHash = await iexecUser.order.hashApporder(order);
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
              .createApporder({
                app: appAddress,
                appprice: 0,
                tag: ['gpu'],
              })
              .then((o) =>
                iexecUser.order.signApporder(o, { preflightCheck: false }),
              );
            const orderHash = await iexecUser.order.hashApporder(order);
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
              .createApporder({
                app: appAddress,
                appprice: 0,
                tag: ['tee', 'scone', 'gpu'],
              })
              .then((o) =>
                iexecUser.order.signApporder(o, { preflightCheck: false }),
              );
            const orderHash = await iexecUser.order.hashApporder(order);
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

      const datasetAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createApporder({
                app: appAddress,
                appprice: 0,
                datasetrestrict: allowedDataset,
              })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
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
              .createApporder({
                app: appAddress,
                appprice: 0,
                datasetrestrict: getRandomAddress(),
              })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
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

      const workerpoolAllowed = await Promise.all(
        Array(5)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createApporder({
                app: appAddress,
                appprice: 0,
                workerpoolrestrict: allowedWorkerpool,
              })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
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
              .createApporder({
                app: appAddress,
                appprice: 0,
                workerpoolrestrict: getRandomAddress(),
              })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
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
              .createApporder({
                app: appAddress,
                appprice: 0,
                requesterrestrict: allowedRequester,
              })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
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
              .createApporder({
                app: appAddress,
                appprice: 0,
                requesterrestrict: getRandomAddress(),
              })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
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
              .createApporder({ app: appAddress, appprice: 0 })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
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
              .createApporder({ app: appAddress, appprice: 0 })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
              status: STATUS_MAP.DEAD,
            };
          }),
      );
      allOrders.push(...deadOrders);

      const otherApp = await Promise.all(
        Array(10)
          .fill(null)
          .map(async () => {
            const order = await iexecUser.order
              .createApporder({ app: otherAddress, appprice: 0 })
              .then(iexecUser.order.signApporder);
            const orderHash = await iexecUser.order.hashApporder(order);
            return {
              order,
              orderHash,
              signer: ownerAddress,
            };
          }),
      );
      allOrders.push(...otherApp);

      await addApporders(chainId, allOrders);
    });

    test('GET /apporders/:orderHash (missing chainId)', async () => {
      const { orderHash } = allOrders[allOrders.length - 1];
      const { data, status } = await request
        .get(buildQuery(`/apporders/${orderHash}`, {}))
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('chainId is a required field');
      expect(data.order).toBeUndefined();
    });

    test('GET /apporders/:orderHash (standard)', async () => {
      const orderToFind = allOrders[allOrders.length - 1];
      const { orderHash } = orderToFind;
      const { data, status } = await request
        .get(buildQuery(`/apporders/${orderHash}`, { chainId }))
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.order).toBeDefined();
      expect(data.orderHash).toBe(orderHash);
      expect(data.order.app).toBe(orderToFind.order.app);
      expect(data.remaining).toBeDefined();
      expect(data.status).toBeDefined();
      expect(data.signer).toBeDefined();
      expect(data.publicationTimestamp).toBeDefined();
    });

    test('GET /apporders/:orderHash (not found)', async () => {
      const { data, status } = await request
        .get(
          buildQuery(
            '/apporders/0xbdcc296eb42dc4e99c46b90aa8f04cb4dad48eae836a0cea3adf4291508ee765',
            {
              chainId, // *
            },
          ),
        )
        .then(parseResult);
      expect(status).toBe(NOT_FOUND_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('apporder not found');
      expect(data.order).toBeUndefined();
    });

    test('GET /apporders (missing app or appOwner)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
          }),
        )
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('app or appOwner is required');
      expect(data.count).toBeUndefined();
      expect(data.orders).toBeUndefined();
    });

    test('GET /apporders (missing chainId)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            app: appAddress, // *
          }),
        )
        .then(parseResult);
      expect(status).toBe(VALIDATION_ERROR_STATUS);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('chainId is a required field');
      expect(data.count).toBeUndefined();
      expect(data.orders).toBeUndefined();
    });

    test('GET /apporders (invalid pageSize)', async () => {
      await request
        .get(
          buildQuery('/apporders', {
            app: appAddress, // *
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
          buildQuery('/apporders', {
            app: appAddress, // *
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

    test('GET /apporders (invalid pageIndex)', async () => {
      await request
        .get(
          buildQuery('/apporders', {
            app: appAddress, // *
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

    test('GET /apporders (no match)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: getRandomAddress(), // *
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

    test('GET /apporders (sort + pagination)', async () => {
      const res1 = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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
        expect(curr.order.app).toBe(appAddress);
        expect(typeof curr.order.appprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.datasetrestrict).toBe('string');
        expect(typeof curr.order.workerpoolrestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.appprice <= curr.order.appprice).toBe(true);
          if (prev.order.appprice === curr.order.appprice) {
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
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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
        expect(curr.order.app).toBe(appAddress);
        expect(typeof curr.order.appprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.datasetrestrict).toBe('string');
        expect(typeof curr.order.workerpoolrestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.appprice <= curr.order.appprice).toBe(true);
          if (prev.order.appprice === curr.order.appprice) {
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
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (sort + legacy pagination)', async () => {
      const res1 = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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
        expect(curr.order.app).toBe(appAddress);
        expect(typeof curr.order.appprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.datasetrestrict).toBe('string');
        expect(typeof curr.order.workerpoolrestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.appprice <= curr.order.appprice).toBe(true);
          if (prev.order.appprice === curr.order.appprice) {
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
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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
        expect(curr.order.app).toBe(appAddress);
        expect(typeof curr.order.appprice).toBe('number');
        expect(typeof curr.order.volume).toBe('number');
        expect(typeof curr.order.tag).toBe('string');
        expect(typeof curr.order.datasetrestrict).toBe('string');
        expect(typeof curr.order.workerpoolrestrict).toBe('string');
        expect(typeof curr.order.requesterrestrict).toBe('string');
        expect(typeof curr.order.salt).toBe('string');
        expect(typeof curr.order.sign).toBe('string');
        if (prev) {
          expect(prev.order.appprice <= curr.order.appprice).toBe(true);
          if (prev.order.appprice === curr.order.appprice) {
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

    test('GET /apporders (any app, any dataset, any requester, any workerpool)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: 'any', // *
            dataset: 'any',
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

    test('GET /apporders (appOwner filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            appOwner: resourceOwnerAddress, // *
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

    test('GET /apporders (invalid isDatasetStrict): should return validation error for invalid isDatasetStrict value', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            appOwner: resourceOwnerAddress, // *
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

    test('GET /apporders (invalid isWorkerpoolStrict): should return validation error for invalid isWorkerpoolStrict value', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            appOwner: resourceOwnerAddress, // *
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

    test('GET /apporders (invalid isRequesterStrict): should return validation error for invalid isRequesterStrict value', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            appOwner: resourceOwnerAddress, // *
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

    test('GET /apporders (isDatasetStrict = true & dataset = undefined): should return public orders including "any" dataset', async () => {
      const result = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (isWorkerpoolStrict = true & workerpool = undefined): should return public orders including "any" workerpool', async () => {
      const result = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (isRequesterStrict = true & requester = undefined): should return public orders including "any" requester', async () => {
      const result = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (minVolume filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (dataset filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (any dataset filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (workerpool filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (dataset filter & isDatasetStrict): should exclude orders with "any" dataset authorized', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (workerpool filter & isWorkerpoolStrict): should exclude orders with "any" dataset authorized', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (requester filter & isRequesterStrict): should exclude orders with "any" requester authorized', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (any workerpool filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (requester filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (any requester filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (minTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (maxTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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

    test('GET /apporders (minTag & maxTag filter)', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/apporders', {
            chainId, // *
            app: appAddress, // *
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
