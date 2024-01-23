const supertest = require('supertest');
const { Wallet } = require('ethers');
const { IExec, utils } = require('iexec');
const socket = require('../src/loaders/socket');
// jest spies
const socketEmitSpy = jest.spyOn(socket, 'emit');

const application = require('../src/app');
const { chains } = require('../src/config');
const { STATUS_MAP } = require('../src/utils/order-utils');
const {
  WALLETS,
  sleep,
  parseResult,
  buildQuery,
  setChallenge,
  find,
  dropDB,
  addCategories,
  addDeals,
  addApporders,
  addDatasetorders,
  addWorkerpoolorders,
  addRequestorders,
  getRandomAddress,
  deployAppFor,
  deployDatasetFor,
  deployWorkerpoolFor,
  deployAndGetApporder,
  deployAndGetDatasetorder,
  deployAndGetWorkerpoolorder,
  getMatchableRequestorder,
  timestampRegex,
} = require('./test-utils');

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
    },
  );

let server;
let request;

beforeAll(async () => {
  server = application.listen();
  request = supertest(server);
});

afterAll(async () => {
  server.close();
});

describe('API', () => {
  describe('Common', () => {
    test('GET /version', async () => {
      const { data, status } = await request.get('/version').then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.version).toBeDefined();
    });

    test('GET /challenge', async () => {
      const { data, status } = await request
        .get(
          buildQuery('/challenge', {
            chainId,
            address: '0x0000000000000000000000000000000000000000',
          }),
        )
        .then(parseResult);
      expect(status).toBe(OK_STATUS);
      expect(data.ok).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.types).toBeDefined();
      expect(data.data.types.EIP712Domain).toBeDefined();
      expect(data.data.types.Challenge).toBeDefined();
      expect(Array.isArray(data.data.types.Challenge)).toBe(true);
      expect(data.data.types.Challenge.length).toBe(1);
      expect(data.data.types.Challenge[0].name).toBe('challenge');
      expect(data.data.types.Challenge[0].type).toBe('string');
      expect(data.data.domain).toBeDefined();
      expect(data.data.domain.name).toBe('iExec Gateway');
      expect(data.data.domain.version).toBe('1');
      expect(data.data.domain.chainId).toBe(chainId);
      expect(data.data.primaryType).toBe('Challenge');
      expect(data.data.message).toBeDefined();
      expect(data.data.message.challenge).toBeDefined();
    });
  });

  describe('Offchain marketplace', () => {
    describe('Order Management', () => {
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

      beforeEach(async () => {
        jest.clearAllMocks();
        await dropDB(chainId);
      });

      describe('/apporders', () => {
        describe('publish', () => {
          test('POST /apporders (standard)', async () => {
            const order = await iexec.order.signApporder({
              ...apporderTemplate,
              tag: '0x1000000000000000000000000000000000000000000000000000000000000101',
            });
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
            const order = await iexec.order.signApporder({
              ...apporderTemplate,
              tag: '0x1000000000000000000000000000000000000000000000000000000000000101',
            });
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
              { checkRequest: false },
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

          // test('POST /apporders (datasetrestrict is not allowed)', async () => {
          //   const order = await iexec.order.signApporder({
          //     ...apporderTemplate,
          //     datasetrestrict: datasetorderTemplate.dataset,
          //   });
          //   await setChallenge(chainId, WALLETS.DEFAULT.challenge);
          //   const { data, status } = await request
          //     .post(
          //       buildQuery('/apporders', {
          //         chainId, // *
          //       }),
          //     )
          //     .send({
          //       order,
          //     })
          //     .set('authorization', WALLETS.DEFAULT.authorization)
          //     .then(parseResult);
          //   expect(status).toBe(BUSINESS_ERROR_STATUS);
          //   expect(data.ok).toBe(false);
          //   expect(data.error).toBe(
          //     "apporder with datasetrestrict can't be published",
          //   );
          //   expect(data.published).toBeUndefined();
          //   expect(socketEmitSpy).toHaveBeenCalledTimes(0);
          // });
          //
          // test('POST /apporders (workerpoolrestrict is not allowed)', async () => {
          //   const order = await iexec.order.signApporder({
          //     ...apporderTemplate,
          //     workerpoolrestrict: workerpoolorderTemplate.workerpool,
          //   });
          //   await setChallenge(chainId, WALLETS.DEFAULT.challenge);
          //   const { data, status } = await request
          //     .post(
          //       buildQuery('/apporders', {
          //         chainId, // *
          //       }),
          //     )
          //     .send({
          //       order,
          //     })
          //     .set('authorization', WALLETS.DEFAULT.authorization)
          //     .then(parseResult);
          //   expect(status).toBe(BUSINESS_ERROR_STATUS);
          //   expect(data.ok).toBe(false);
          //   expect(data.error).toBe(
          //     "apporder with workerpoolrestrict can't be published",
          //   );
          //   expect(data.published).toBeUndefined();
          //   expect(socketEmitSpy).toHaveBeenCalledTimes(0);
          // });
          //
          // test('POST /apporders (requesterrestrict is not allowed)', async () => {
          //   const order = await iexec.order.signApporder({
          //     ...apporderTemplate,
          //     requesterrestrict: '0xA1162f07afC3e45Ae89D2252706eB355F6349641',
          //   });
          //   await setChallenge(chainId, WALLETS.DEFAULT.challenge);
          //   const { data, status } = await request
          //     .post(
          //       buildQuery('/apporders', {
          //         chainId, // *
          //       }),
          //     )
          //     .send({
          //       order,
          //     })
          //     .set('authorization', WALLETS.DEFAULT.authorization)
          //     .then(parseResult);
          //   expect(status).toBe(BUSINESS_ERROR_STATUS);
          //   expect(data.ok).toBe(false);
          //   expect(data.error).toBe(
          //     "apporder with requesterrestrict can't be published",
          //   );
          //   expect(data.published).toBeUndefined();
          //   expect(socketEmitSpy).toHaveBeenCalledTimes(0);
          // });
        });

        describe('unpublish', () => {
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
            expect(data.unpublished).toEqual(
              expect.arrayContaining([hash1, hash2]),
            );
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
            const orderPrivate1Hash = await iexec.order.hashApporder(
              orderPrivate1,
            );
            const orderPrivate2Hash = await iexec.order.hashApporder(
              orderPrivate2,
            );
            await iexec.account.deposit(5);
            const matchableRequestorder = await getMatchableRequestorder(
              iexec,
              {
                apporder: order,
                workerpoolorder: workerpoolorderTemplate,
              },
            );
            const requestorderUsePrivate = await iexec.order.signRequestorder(
              {
                ...matchableRequestorder,
                workerpool: utils.NULL_ADDRESS,
              },
              { checkRequest: false },
            );
            const requestorder2nRlc = await iexec.order.signRequestorder(
              {
                ...matchableRequestorder,
                appmaxprice: 2,
                workerpool: utils.NULL_ADDRESS,
              },
              { checkRequest: false },
            );
            const requestorder5nRlc = await iexec.order.signRequestorder(
              {
                ...matchableRequestorder,
                appmaxprice: 5,
                workerpool: utils.NULL_ADDRESS,
              },
              { checkRequest: false },
            );
            const requestUsePrivateHash = await iexec.order.hashRequestorder(
              requestorderUsePrivate,
            );
            const request2nRlcHash = await iexec.order.hashRequestorder(
              requestorder2nRlc,
            );
            const request5nRlcHash = await iexec.order.hashRequestorder(
              requestorder5nRlc,
            );
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
            const orderTee = await iexec.order.signApporder({
              ...apporderTemplate,
              tag: ['tee'],
            });
            const appTeeHash = await iexec.order.hashApporder(orderTee);
            const matchableRequestorder = await getMatchableRequestorder(
              iexec,
              {
                apporder: orderTee,
                workerpoolorder: workerpoolorderTemplate,
              },
            );
            const requestorder = await iexec.order.signRequestorder(
              {
                ...matchableRequestorder,
                appmaxprice: 0,
                workerpool: utils.NULL_ADDRESS,
              },
              { checkRequest: false },
            );
            const requestorderTee = await iexec.order.signRequestorder(
              {
                ...matchableRequestorder,
                appmaxprice: 0,
                workerpool: utils.NULL_ADDRESS,
                tag: ['tee'],
              },
              { checkRequest: false },
            );

            const requestHash = await iexec.order.hashRequestorder(
              requestorder,
            );
            const requestTeeHash = await iexec.order.hashRequestorder(
              requestorderTee,
            );
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
            const [[savedRequestorder], [savedRequestorderTee]] =
              await Promise.all([
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
      });

      describe('/datasetorders', () => {
        describe('publish', () => {
          test('POST /datasetorders (standard)', async () => {
            const order = await iexec.order.signDatasetorder({
              ...datasetorderTemplate,
              tag: '0x1000000000000000000000000000000000000000000000000000000000000101',
            });
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
            const order = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order = await iexec.order.signDatasetorder({
              ...datasetorderTemplate,
              tag: '0x1000000000000000000000000000000000000000000000000000000000000101',
            });
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
            const order = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
              { checkRequest: false },
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

          // test('POST /datasetorders (workerpoolrestrict is not allowed)', async () => {
          //   const order = await iexec.order.signDatasetorder({
          //     ...datasetorderTemplate,
          //     workerpoolrestrict: workerpoolorderTemplate.workerpool,
          //   });
          //   await setChallenge(chainId, WALLETS.DEFAULT.challenge);
          //   const { data, status } = await request
          //     .post(
          //       buildQuery('/datasetorders', {
          //         chainId, // *
          //       }),
          //     )
          //     .send({
          //       order,
          //     })
          //     .set('authorization', WALLETS.DEFAULT.authorization)
          //     .then(parseResult);
          //   expect(status).toBe(BUSINESS_ERROR_STATUS);
          //   expect(data.ok).toBe(false);
          //   expect(data.error).toBe(
          //     "datasetorder with workerpoolrestrict can't be published",
          //   );
          //   expect(data.published).toBeUndefined();
          //   expect(socketEmitSpy).toHaveBeenCalledTimes(0);
          // });
          //
          // test('POST /datasetorders (requesterrestrict is not allowed)', async () => {
          //   const order = await iexec.order.signDatasetorder({
          //     ...datasetorderTemplate,
          //     requesterrestrict: '0xA1162f07afC3e45Ae89D2252706eB355F6349641',
          //   });
          //   await setChallenge(chainId, WALLETS.DEFAULT.challenge);
          //   const { data, status } = await request
          //     .post(
          //       buildQuery('/datasetorders', {
          //         chainId, // *
          //       }),
          //     )
          //     .send({
          //       order,
          //     })
          //     .set('authorization', WALLETS.DEFAULT.authorization)
          //     .then(parseResult);
          //   expect(status).toBe(BUSINESS_ERROR_STATUS);
          //   expect(data.ok).toBe(false);
          //   expect(data.error).toBe(
          //     "datasetorder with requesterrestrict can't be published",
          //   );
          //   expect(data.published).toBeUndefined();
          //   expect(socketEmitSpy).toHaveBeenCalledTimes(0);
          // });
        });

        describe('unpublish', () => {
          test('PUT /datasetorders (standard)', async () => {
            const order = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order1 = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order2 = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order1 = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order2 = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            expect(data.unpublished).toEqual(
              expect.arrayContaining([hash1, hash2]),
            );
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
            const order = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order = await iexec.order.signDatasetorder(
              datasetorderTemplate,
            );
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
            const order1nRlcHash = await iexec.order.hashDatasetorder(
              order1nRlc,
            );
            const orderPrivate1Hash = await iexec.order.hashDatasetorder(
              orderPrivate1,
            );
            const orderPrivate2Hash = await iexec.order.hashDatasetorder(
              orderPrivate2,
            );
            await iexec.account.deposit(5);
            const apporder = await iexec.order.signApporder(apporderTemplate);
            const workerpoolorder = await iexec.order.signWorkerpoolorder(
              workerpoolorderTemplate,
            );
            const matchableRequestorder = await getMatchableRequestorder(
              iexec,
              {
                apporder,
                datasetorder: order,
                workerpoolorder,
              },
            );
            const requestorder = await iexec.order.signRequestorder(
              {
                ...matchableRequestorder,
                datasetmaxprice: 0,
                workerpool: utils.NULL_ADDRESS,
              },
              { checkRequest: false },
            );
            const requestorderUsePrivate = await iexec.order.signRequestorder(
              requestorder,
              { checkRequest: false },
            );
            const requestorder1nRlc = await iexec.order.signRequestorder(
              {
                ...requestorder,
                datasetmaxprice: 1,
              },
              { checkRequest: false },
            );
            const requestorder5nRlc = await iexec.order.signRequestorder(
              {
                ...requestorder,
                datasetmaxprice: 5,
              },
              { checkRequest: false },
            );
            const requestorderUsePrivateHash =
              await iexec.order.hashRequestorder(requestorderUsePrivate);
            const requestorder1nRlcHash = await iexec.order.hashRequestorder(
              requestorder1nRlc,
            );
            const requestorder5nRlcHash = await iexec.order.hashRequestorder(
              requestorder5nRlc,
            );
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
      });

      describe('/workerpoolorders', () => {
        describe('publish', () => {
          test('POST /workerpoolorders (standard)', async () => {
            const address = await iexec.wallet.getAddress();
            const order = await iexec.order.signWorkerpoolorder({
              ...workerpoolorderTemplate,
              tag: '0x1000000000000000000000000000000000000000000000000000000000000101',
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
              tag: '0x1000000000000000000000000000000000000000000000000000000000000101',
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
              { checkRequest: false },
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

          // test('POST /workerpoolorders (apprestrict is not allowed)', async () => {
          //   const order = await iexec.order.signWorkerpoolorder({
          //     ...workerpoolorderTemplate,
          //     apprestrict: apporderTemplate.app,
          //   });
          //   await setChallenge(chainId, WALLETS.DEFAULT.challenge);
          //   const { data, status } = await request
          //     .post(
          //       buildQuery('/workerpoolorders', {
          //         chainId, // *
          //       }),
          //     )
          //     .send({
          //       order,
          //     })
          //     .set('authorization', WALLETS.DEFAULT.authorization)
          //     .then(parseResult);
          //   expect(status).toBe(BUSINESS_ERROR_STATUS);
          //   expect(data.ok).toBe(false);
          //   expect(data.error).toBe(
          //     "workerpoolorder with apprestrict can't be published",
          //   );
          //   expect(data.published).toBeUndefined();
          //   expect(socketEmitSpy).toHaveBeenCalledTimes(0);
          // });
          //
          // test('POST /workerpoolorders (datasetrestrict is not allowed)', async () => {
          //   const order = await iexec.order.signWorkerpoolorder({
          //     ...workerpoolorderTemplate,
          //     datasetrestrict: datasetorderTemplate.dataset,
          //   });
          //   await setChallenge(chainId, WALLETS.DEFAULT.challenge);
          //   const { data, status } = await request
          //     .post(
          //       buildQuery('/workerpoolorders', {
          //         chainId, // *
          //       }),
          //     )
          //     .send({
          //       order,
          //     })
          //     .set('authorization', WALLETS.DEFAULT.authorization)
          //     .then(parseResult);
          //   expect(status).toBe(BUSINESS_ERROR_STATUS);
          //   expect(data.ok).toBe(false);
          //   expect(data.error).toBe(
          //     "workerpoolorder with datasetrestrict can't be published",
          //   );
          //   expect(data.published).toBeUndefined();
          //   expect(socketEmitSpy).toHaveBeenCalledTimes(0);
          // });
          //
          // test('POST /workerpoolorders (requesterrestrict is not allowed)', async () => {
          //   const order = await iexec.order.signWorkerpoolorder({
          //     ...workerpoolorderTemplate,
          //     requesterrestrict: '0xA1162f07afC3e45Ae89D2252706eB355F6349641',
          //   });
          //   await setChallenge(chainId, WALLETS.DEFAULT.challenge);
          //   const { data, status } = await request
          //     .post(
          //       buildQuery('/workerpoolorders', {
          //         chainId, // *
          //       }),
          //     )
          //     .send({
          //       order,
          //     })
          //     .set('authorization', WALLETS.DEFAULT.authorization)
          //     .then(parseResult);
          //   expect(status).toBe(BUSINESS_ERROR_STATUS);
          //   expect(data.ok).toBe(false);
          //   expect(data.error).toBe(
          //     "workerpoolorder with requesterrestrict can't be published",
          //   );
          //   expect(data.published).toBeUndefined();
          //   expect(socketEmitSpy).toHaveBeenCalledTimes(0);
          // });

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

          /** ---- ALLOW BID/ASK OVERLAP ----
          test('POST /workerpoolorders (best requestorder in same category is not allowed)', async () => {
            await iexec.account.deposit(100);
            await setChallenge(chainId, WALLETS.DEFAULT.challenge);
            const order11nRlc = await iexec.order.signWorkerpoolorder({
              ...workerpoolorderTemplate,
              workerpoolprice: 11,
              category: 3,
            });
            const order10nRlc = await iexec.order.signWorkerpoolorder({
              ...workerpoolorderTemplate,
              workerpoolprice: 10,
              category: 3,
            });
            const apporder = await iexec.order.signApporder(apporderTemplate);
            const requestOrder10nRlc = await iexec.order.signRequestorder(
              {
                ...requestorderTemplate,
                workerpool: utils.NULL_ADDRESS,
                workerpoolmaxprice: 10,
                category: 3,
              },
              { checkRequest: false },
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
            await setChallenge(chainId, WALLETS.DEFAULT.challenge);
            await request
              .post(
                buildQuery('/requestorders', {
                  chainId, // *
                }),
              )
              .send({
                order: requestOrder10nRlc,
              })
              .set('authorization', WALLETS.DEFAULT.authorization)
              .then(parseResult);
            jest.clearAllMocks();
            await setChallenge(chainId, WALLETS.DEFAULT.challenge);
            const resOK = await request
              .post(
                buildQuery('/workerpoolorders', {
                  chainId, // *
                }),
              )
              .send({
                chainId,
                order: order11nRlc,
              })
              .set('authorization', WALLETS.DEFAULT.authorization)
              .then(parseResult);
            await setChallenge(chainId, WALLETS.DEFAULT.challenge);
            const resKO = await request
              .post(
                buildQuery('/workerpoolorders', {
                  chainId, // *
                }),
              )
              .send({
                chainId,
                order: order10nRlc,
              })
              .set('authorization', WALLETS.DEFAULT.authorization)
              .then(parseResult);
            expect(resOK.status).toBe(OK_STATUS);
            expect(resOK.data.ok).toBe(true);
            expect(resKO.status).toBe(BUSINESS_ERROR_STATUS);
            expect(resKO.data.ok).toBe(false);
            expect(resKO.data.error).toBe(
              'workerpoolprice (10) is less than or equals best requestorder price (10), you may want to fill it',
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
          });

          test('POST /workerpoolorders (best requestorder in other category is allowed)', async () => {
            await iexec.account.deposit(100);
            await setChallenge(chainId, WALLETS.DEFAULT.challenge);
            const order = await iexec.order.signWorkerpoolorder({
              ...workerpoolorderTemplate,
              workerpoolprice: 10,
              category: 2,
            });
            const hash = await iexec.order.hashWorkerpoolorder(order);
            const apporder = await iexec.order.signApporder(apporderTemplate);
            const requestOrder10nRlc = await iexec.order.signRequestorder(
              {
                ...requestorderTemplate,
                workerpool: utils.NULL_ADDRESS,
                workerpoolmaxprice: 10,
                category: 3,
              },
              { checkRequest: false },
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
            await setChallenge(chainId, WALLETS.DEFAULT.challenge);
            await request
              .post(
                buildQuery('/requestorders', {
                  chainId, // *
                }),
              )
              .send({
                order: requestOrder10nRlc,
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
            expect(status).toBe(OK_STATUS);
            expect(data.ok).toBe(true);
            expect(data.published).toBeDefined();
            expect(data.published.orderHash).toBe(hash);
            expect(socketEmitSpy).toHaveBeenCalledTimes(1);
            expect(socketEmitSpy).toHaveBeenNthCalledWith(
              1,
              `${chainId}:orders`,
              'workerpoolorder_published',
              expect.objectContaining({ orderHash: data.published.orderHash }),
            );
          });
          */
        });

        describe('unpublish', () => {
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
            expect(data.unpublished).toEqual(
              expect.arrayContaining([hash1, hash2]),
            );
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
      });

      describe('/requestorders', () => {
        describe('publish', () => {
          test('POST /requestorders (missing apporder)', async () => {
            const order = await iexec.order.signRequestorder(
              {
                ...requestorderTemplate,
                workerpool: utils.NULL_ADDRESS,
              },
              { checkRequest: false },
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
            expect(data.error).toBe(
              `No apporder published for app ${order.app}`,
            );
            expect(data.published).toBeUndefined();
            expect(socketEmitSpy).toHaveBeenCalledTimes(0);
          });

          test('POST /requestorders (missing tee apporder)', async () => {
            const order = await iexec.order.signRequestorder(
              {
                ...requestorderTemplate,
                workerpool: utils.NULL_ADDRESS,
                tag: '0x0000000000000000000000000000000000000000000000000000000000000001',
              },
              { checkRequest: false },
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
                tag: '0xf000000000000000000000000000000000000000000000000000000000000001',
              },
              { checkRequest: false },
            );
            const hash = await iexec.order.hashRequestorder(order);
            const apporder = await iexec.order.signApporder({
              ...apporderTemplate,
              tag: '0x0000000000000000000000000000000000000000000000000000000000000001',
            });
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
              { checkRequest: false },
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
                tag: '0xf000000000000000000000000000000000000000000000000000000000000001',
              },
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
            );
            const hash = await iexec.order.hashRequestorder(order);
            const apporder = await iexec.order.signApporder(apporderTemplate);
            const datasetorder = await iexec.order.signDatasetorder(
              datasetorderTemplate,
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

          // test('POST /requestorders (workerpool restricted is not allowed)', async () => {
          //   const order = await iexec.order.signRequestorder(
          //     requestorderTemplate,
          //     { checkRequest: false },
          //   );
          //   const apporder = await iexec.order.signApporder(apporderTemplate);
          //   await setChallenge(chainId, WALLETS.DEFAULT.challenge);
          //   await request
          //     .post(
          //       buildQuery('/apporders', {
          //         chainId, // *
          //       }),
          //     )
          //     .send({
          //       order: apporder,
          //     })
          //     .set('authorization', WALLETS.DEFAULT.authorization)
          //     .then(parseResult);
          //   jest.clearAllMocks();
          //   await setChallenge(chainId, WALLETS.DEFAULT.challenge);
          //   const { data, status } = await request
          //     .post(
          //       buildQuery('/requestorders', {
          //         chainId, // *
          //       }),
          //     )
          //     .send({
          //       order,
          //     })
          //     .set('authorization', WALLETS.DEFAULT.authorization)
          //     .then(parseResult);
          //   expect(status).toBe(BUSINESS_ERROR_STATUS);
          //   expect(data.ok).toBe(false);
          //   expect(data.error).toBe(
          //     "requestorder with workerpool restriction can't be published",
          //   );
          //   expect(data.published).toBeUndefined();
          //   expect(socketEmitSpy).toHaveBeenCalledTimes(0);
          // });

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
              { checkRequest: false },
            );
            const order11nRlc = await iexec.order.signRequestorder(
              {
                ...requestorderTemplate,
                workerpool: utils.NULL_ADDRESS,
                workerpoolmaxprice: 1,
                volume: 11,
              },
              { checkRequest: false },
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

        describe('unpublish', () => {
          test('PUT /requestorders (standard)', async () => {
            const order = await iexec.order.signRequestorder(
              {
                ...requestorderTemplate,
                workerpool: utils.NULL_ADDRESS,
              },
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
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
            expect(data.unpublished).toEqual(
              expect.arrayContaining([hash1, hash2]),
            );
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
              { checkRequest: false },
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
              { checkRequest: false },
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
              { checkRequest: false },
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
      });
    });

    describe('Orderbook', () => {
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
                    tag: ['tee'],
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
                  .then(iexecUser.order.signApporder);
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
                    tag: ['tee', 'gpu'],
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
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
                  '0x0000000000000000000000000000000000000000000000000000000000000001',
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
                '0x0000000000000000000000000000000000000000000000000000000000000001' ||
                e.order.tag ===
                  '0x0000000000000000000000000000000000000000000000000000000000000101',
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
                  '0x0000000000000000000000000000000000000000000000000000000000000001',
                maxTag:
                  '0xf000000000000000000000000000000000000000000000000000000000000001',
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
                '0x0000000000000000000000000000000000000000000000000000000000000001',
            ).toBe(true);
          });
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
                    tag: ['tee'],
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
                    tag: ['tee', 'gpu'],
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
              expect(prev.order.datasetprice <= curr.order.datasetprice).toBe(
                true,
              );
              if (prev.order.datasetprice === curr.order.datasetprice) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
              expect(prev.order.datasetprice <= curr.order.datasetprice).toBe(
                true,
              );
              if (prev.order.datasetprice === curr.order.datasetprice) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
              expect(prev.order.datasetprice <= curr.order.datasetprice).toBe(
                true,
              );
              if (prev.order.datasetprice === curr.order.datasetprice) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
              expect(prev.order.datasetprice <= curr.order.datasetprice).toBe(
                true,
              );
              if (prev.order.datasetprice === curr.order.datasetprice) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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

          expect(status).toBe(OK_STATUS);
          expect(data.ok).toBe(true);
          expect(data.count).toBe(ordersExcludingAnyApp.length);
          expect(data.orders).toBeDefined();
          expect(Array.isArray(data.orders)).toBe(true);
          expect(data.orders.length).toBe(ordersExcludingAnyApp.length);
          data.orders.forEach((e) =>
            expect(e.order.apprestrict).toBe(allowedApp),
          );
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
                  '0x0000000000000000000000000000000000000000000000000000000000000001',
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
                '0x0000000000000000000000000000000000000000000000000000000000000001' ||
                e.order.tag ===
                  '0x0000000000000000000000000000000000000000000000000000000000000101',
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
                  '0x0000000000000000000000000000000000000000000000000000000000000001',
                maxTag:
                  '0xf000000000000000000000000000000000000000000000000000000000000001',
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
                '0x0000000000000000000000000000000000000000000000000000000000000001',
            ).toBe(true);
          });
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                    tag: ['tee'],
                    category: 0,
                  })
                  .then(iexecUser.order.signWorkerpoolorder);
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                    tag: ['tee', 'gpu'],
                    category: 0,
                  })
                  .then(iexecUser.order.signWorkerpoolorder);
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
                const orderHash = await iexecUser.order.hashWorkerpoolorder(
                  order,
                );
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
              expect(
                prev.order.workerpoolprice <= curr.order.workerpoolprice,
              ).toBe(true);
              if (prev.order.workerpoolprice === curr.order.workerpoolprice) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
              expect(
                prev.order.workerpoolprice <= curr.order.workerpoolprice,
              ).toBe(true);
              if (prev.order.workerpoolprice === curr.order.workerpoolprice) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
              expect(
                prev.order.workerpoolprice <= curr.order.workerpoolprice,
              ).toBe(true);
              if (prev.order.workerpoolprice === curr.order.workerpoolprice) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
              expect(
                prev.order.workerpoolprice <= curr.order.workerpoolprice,
              ).toBe(true);
              if (prev.order.workerpoolprice === curr.order.workerpoolprice) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
                  '0x0000000000000000000000000000000000000000000000000000000000000001',
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
                '0x0000000000000000000000000000000000000000000000000000000000000001' ||
                e.order.tag ===
                  '0x0000000000000000000000000000000000000000000000000000000000000101',
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
                  '0x0000000000000000000000000000000000000000000000000000000000000001',
                maxTag:
                  '0xf000000000000000000000000000000000000000000000000000000000000001',
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
                '0x0000000000000000000000000000000000000000000000000000000000000001',
            ).toBe(true);
          });
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                    tag: ['tee'],
                    category: 0,
                  })
                  .then((o) =>
                    iexecUser1.order.signRequestorder(o, {
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                    tag: ['tee', 'gpu'],
                    category: 0,
                  })
                  .then((o) =>
                    iexecUser1.order.signRequestorder(o, {
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
                      checkRequest: false,
                    }),
                  );
                const orderHash = await iexecUser1.order.hashRequestorder(
                  order,
                );
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
          maxGpuTagOrders = filterOrders(publicOrders, [
            ...tagTee,
            ...tagTeeGpu,
          ]);
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
              if (
                prev.order.workerpoolmaxprice === curr.order.workerpoolmaxprice
              ) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
              if (
                prev.order.workerpoolmaxprice === curr.order.workerpoolmaxprice
              ) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
              if (
                prev.order.workerpoolmaxprice === curr.order.workerpoolmaxprice
              ) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
              if (
                prev.order.workerpoolmaxprice === curr.order.workerpoolmaxprice
              ) {
                expect(
                  prev.publicationTimestamp <= curr.publicationTimestamp,
                ).toBe(true);
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
                  '0x0000000000000000000000000000000000000000000000000000000000000001',
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
                '0x0000000000000000000000000000000000000000000000000000000000000001' ||
                e.order.tag ===
                  '0x0000000000000000000000000000000000000000000000000000000000000101',
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
                  '0x0000000000000000000000000000000000000000000000000000000000000001',
                maxTag:
                  '0xf000000000000000000000000000000000000000000000000000000000000001',
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
                '0x0000000000000000000000000000000000000000000000000000000000000001',
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
  });

  describe('Indexed onchain data', () => {
    describe('categories', () => {
      beforeAll(async () => {
        await dropDB(chainId);
        // prepare documents
        const categories = [
          { catid: 0, name: '0', workClockTimeRef: 0 },
          { catid: 1, name: '1', workClockTimeRef: 100 },
          { catid: 2, name: '2', workClockTimeRef: 101 },
          { catid: 3, name: '3', workClockTimeRef: 200 },
          { catid: 4, name: '4', workClockTimeRef: 200 },
          { catid: 5, name: 'Cat5', workClockTimeRef: 200 },
          { catid: 6, name: '6', workClockTimeRef: 200 },
          { catid: 7, name: '7', workClockTimeRef: 200 },
          { catid: 8, name: '8', workClockTimeRef: 200 },
          { catid: 9, name: '9', workClockTimeRef: 200 },
          { catid: 10, name: '10', workClockTimeRef: 999 },
          { catid: 11, name: '11', workClockTimeRef: 200 },
          { catid: 12, name: '12', workClockTimeRef: 200 },
          { catid: 13, name: '13', workClockTimeRef: 200 },
          { catid: 14, name: '14', workClockTimeRef: 200 },
          { catid: 15, name: '15', workClockTimeRef: 200 },
          { catid: 16, name: '16', workClockTimeRef: 200 },
          { catid: 17, name: '17', workClockTimeRef: 200 },
          { catid: 18, name: '18', workClockTimeRef: 200 },
          { catid: 19, name: '19', workClockTimeRef: 200 },
          { catid: 20, name: '20', workClockTimeRef: 200 },
          { catid: 21, name: '21', workClockTimeRef: 200 },
          { catid: 22, name: '22', workClockTimeRef: 200 },
          { catid: 23, name: '23', workClockTimeRef: 200 },
          { catid: 24, name: '24', workClockTimeRef: 200 },
          { catid: 25, name: '25', workClockTimeRef: 200 },
          { catid: 26, name: '26', workClockTimeRef: 200 },
          { catid: 27, name: '27', workClockTimeRef: 500 },
          { catid: 28, name: '28', workClockTimeRef: 1000 },
          { catid: 29, name: '29', workClockTimeRef: 1001 },
        ];
        await addCategories(chainId, categories);
      });

      test('GET /categories/:catid (missing chainId)', async () => {
        const { data, status } = await request
          .get(buildQuery('/categories/5', {}))
          .then(parseResult);
        expect(status).toBe(VALIDATION_ERROR_STATUS);
        expect(data.ok).toBe(false);
        expect(data.error).toBe('chainId is a required field');
        expect(data.order).toBeUndefined();
      });

      test('GET /categories/:catid (standard)', async () => {
        const { data, status } = await request
          .get(buildQuery('/categories/5', { chainId }))
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.catid).toBe(5);
        expect(data.chainId).toBe(chainId);
        expect(data.name).toBe('Cat5');
        expect(data.workClockTimeRef).toBe(200);
        expect(data.description).toBeDefined();
        expect(data.transactionHash).toBeDefined();
        expect(data.blockNumber).toBeDefined();
        expect(data.blockTimestamp).toBeDefined();
      });

      test('GET /categories/:catid (not found)', async () => {
        const { data, status } = await request
          .get(
            buildQuery('/categories/48', {
              chainId, // *
            }),
          )
          .then(parseResult);
        expect(status).toBe(NOT_FOUND_ERROR_STATUS);
        expect(data.ok).toBe(false);
        expect(data.error).toBe('category not found');
        expect(data.catid).toBeUndefined();
      });

      test('GET /categories (missing chainId)', async () => {
        const { status, data } = await request
          .get(buildQuery('/categories', {}))
          .then(parseResult);
        expect(status).toBe(VALIDATION_ERROR_STATUS);
        expect(data.ok).toBe(false);
        expect(data.error).toBe('chainId is a required field');
        expect(data.count).toBeUndefined();
        expect(data.categories).toBeUndefined();
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /categories (invalid pageSize)', async () => {
        await request
          .get(
            buildQuery('/categories', {
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
            expect(data.categories).toBeUndefined();
          });

        await request
          .get(
            buildQuery('/categories', {
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
            expect(data.categories).toBeUndefined();
          });
      });

      test('GET /categories (invalid pageIndex)', async () => {
        await request
          .get(
            buildQuery('/categories', {
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
            expect(data.categories).toBeUndefined();
          });
      });

      test('GET /categories (sort + pagination)', async () => {
        const res1 = await request
          .get(
            buildQuery('/categories', {
              chainId, // *
              pageSize: 25,
            }),
          )
          .then(parseResult);
        expect(res1.status).toBe(OK_STATUS);
        expect(res1.data.ok).toBe(true);
        expect(res1.data.count).toBe(30);
        expect(res1.data.categories).toBeDefined();
        expect(Array.isArray(res1.data.categories)).toBe(true);
        res1.data.categories.reduce((prev, curr) => {
          expect(typeof curr.catid).toBe('number');
          expect(typeof curr.chainId).toBe('number');
          expect(typeof curr.name).toBe('string');
          expect(typeof curr.description).toBe('string');
          expect(typeof curr.workClockTimeRef).toBe('number');
          expect(typeof curr.transactionHash).toBe('string');
          expect(typeof curr.blockNumber).toBe('number');
          expect(typeof curr.blockTimestamp).toBe('string');
          if (prev) {
            expect(prev.workClockTimeRef <= curr.workClockTimeRef).toBe(true);
            if (prev.workClockTimeRef === curr.workClockTimeRef) {
              expect(prev.catid <= curr.catid).toBe(true);
            }
          }
          return curr;
        });
        expect(res1.data.categories.length).toBe(25);
        const res2 = await request
          .get(
            buildQuery('/categories', {
              chainId, // *
              pageSize: 25,
              pageIndex: 1,
            }),
          )
          .then(parseResult);
        expect(res2.status).toBe(OK_STATUS);
        expect(res2.data.ok).toBe(true);
        expect(res2.data.count).toBe(30);
        expect(res2.data.categories).toBeDefined();
        expect(Array.isArray(res2.data.categories)).toBe(true);
        res2.data.categories.reduce((prev, curr) => {
          expect(curr.workClockTimeRef).toBeDefined();
          if (prev) {
            expect(prev.workClockTimeRef <= curr.workClockTimeRef).toBe(true);
            if (prev.workClockTimeRef === curr.workClockTimeRef) {
              expect(prev.catid <= curr.catid).toBe(true);
            }
          }
          return curr;
        });
        expect(res2.data.categories.length).toBe(res1.data.count - 25);
        const res3 = await request
          .get(
            buildQuery('/categories', {
              chainId, // *
              pageSize: 25,
              pageIndex: 100,
            }),
          )
          .then(parseResult);
        expect(res3.status).toBe(OK_STATUS);
        expect(res3.data.ok).toBe(true);
        expect(res3.data.count).toBe(30);
        expect(res3.data.categories).toBeDefined();
        expect(res3.data.categories.length).toBe(0);
      });

      test('GET /categories (sort + legacy pagination)', async () => {
        const res1 = await request
          .get(
            buildQuery('/categories', {
              chainId, // *
            }),
          )
          .then(parseResult);
        expect(res1.status).toBe(OK_STATUS);
        expect(res1.data.ok).toBe(true);
        expect(res1.data.count).toBe(30);
        expect(res1.data.categories).toBeDefined();
        expect(Array.isArray(res1.data.categories)).toBe(true);
        res1.data.categories.reduce((prev, curr) => {
          expect(typeof curr.catid).toBe('number');
          expect(typeof curr.chainId).toBe('number');
          expect(typeof curr.name).toBe('string');
          expect(typeof curr.description).toBe('string');
          expect(typeof curr.workClockTimeRef).toBe('number');
          expect(typeof curr.transactionHash).toBe('string');
          expect(typeof curr.blockNumber).toBe('number');
          expect(typeof curr.blockTimestamp).toBe('string');
          if (prev) {
            expect(prev.workClockTimeRef <= curr.workClockTimeRef).toBe(true);
            if (prev.workClockTimeRef === curr.workClockTimeRef) {
              expect(prev.catid <= curr.catid).toBe(true);
            }
          }
          return curr;
        });
        expect(res1.data.categories.length).toBe(20);
        expect(res1.data.nextPage).toBeDefined();
        const res2 = await request
          .get(
            buildQuery('/categories', {
              chainId, // *
              page: res1.data.nextPage,
            }),
          )
          .then(parseResult);
        expect(res2.status).toBe(OK_STATUS);
        expect(res2.data.ok).toBe(true);
        expect(res2.data.count).toBe(30);
        expect(res2.data.categories).toBeDefined();
        expect(Array.isArray(res2.data.categories)).toBe(true);
        res2.data.categories.reduce((prev, curr) => {
          expect(curr.workClockTimeRef).toBeDefined();
          if (prev) {
            expect(prev.workClockTimeRef <= curr.workClockTimeRef).toBe(true);
            if (prev.workClockTimeRef === curr.workClockTimeRef) {
              expect(prev.catid <= curr.catid).toBe(true);
            }
          }
          return curr;
        });
        expect(res2.data.categories.length).toBe(10);
        expect(res2.data.nextPage).toBeUndefined();
      });

      test('GET /categories (minWorkClockTimeRef filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/categories', {
              chainId, // *
              minWorkClockTimeRef: 200,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(27);
        expect(data.categories).toBeDefined();
        expect(Array.isArray(data.categories)).toBe(true);
        expect(data.categories.length).toBe(20);
        data.categories.forEach((e) => {
          expect(e.workClockTimeRef).toBeDefined();
          expect(e.workClockTimeRef >= 200).toBe(true);
        });
        expect(data.nextPage).toBeDefined();
      });

      test('GET /categories (maxWorkClockTimeRef filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/categories', {
              chainId, // *
              maxWorkClockTimeRef: 200,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(26);
        expect(data.categories).toBeDefined();
        expect(Array.isArray(data.categories)).toBe(true);
        expect(data.categories.length).toBe(20);
        data.categories.forEach((e) => {
          expect(e.workClockTimeRef).toBeDefined();
          expect(e.workClockTimeRef <= 200).toBe(true);
        });
        expect(data.nextPage).toBeDefined();
      });
    });

    describe('deals', () => {
      const category = 5;
      const requester = getRandomAddress();
      const beneficiary = getRandomAddress();
      const app = getRandomAddress();
      const dataset = getRandomAddress();
      const workerpool = getRandomAddress();
      const appOwner = getRandomAddress();
      const datasetOwner = getRandomAddress();
      const workerpoolOwner = getRandomAddress();
      const apporderHash =
        '0xabc1000000000000000000000000000000000000000000000000000000000000';
      const datasetorderHash =
        '0xabc2000000000000000000000000000000000000000000000000000000000000';
      const workerpoolorderHash =
        '0xabc3000000000000000000000000000000000000000000000000000000000000';
      const requestorderHash =
        '0xabc4000000000000000000000000000000000000000000000000000000000000';

      const allDeals = [];
      let categorySpecificDeals;
      let appSpecificDeals;
      let datasetSpecificDeals;
      let workerpoolSpecificDeals;
      let requesterSpecificDeals;
      let beneficiarySpecificDeals;
      let appOwnerSpecificDeals;
      let datasetOwnerSpecificDeals;
      let workerpoolOwnerSpecificDeals;
      let apporderSpecificDeals;
      let datasetorderSpecificDeals;
      let workerpoolorderSpecificDeals;
      let requestorderSpecificDeals;

      beforeAll(async () => {
        await dropDB(chainId);
        // prepare documents
        categorySpecificDeals = [{ category, blockNumber: 1 }, { category }];
        allDeals.push(...categorySpecificDeals);
        appSpecificDeals = [{ app, blockNumber: 6 }, { app }, { app }];
        allDeals.push(...appSpecificDeals);
        datasetSpecificDeals = [
          { dataset, blockNumber: 5 },
          { dataset },
          { dataset },
          { dataset },
        ];
        allDeals.push(...datasetSpecificDeals);
        workerpoolSpecificDeals = [
          { workerpool, blockNumber: 4 },
          { workerpool },
          { workerpool },
        ];
        allDeals.push(...workerpoolSpecificDeals);
        requesterSpecificDeals = [
          { requester, blockNumber: 3 },
          { requester },
          { requester },
        ];
        allDeals.push(...requesterSpecificDeals);
        beneficiarySpecificDeals = [
          { beneficiary, blockNumber: 2 },
          { beneficiary },
        ];
        allDeals.push(...beneficiarySpecificDeals);
        appOwnerSpecificDeals = [{ appOwner, blockNumber: 1 }, { appOwner }];
        allDeals.push(...appOwnerSpecificDeals);
        datasetOwnerSpecificDeals = [
          { datasetOwner, blockNumber: 0 },
          { datasetOwner },
          { datasetOwner },
        ];
        allDeals.push(...datasetOwnerSpecificDeals);
        workerpoolOwnerSpecificDeals = [
          { workerpoolOwner, blockNumber: 10 },
          { workerpoolOwner },
          { workerpoolOwner },
          { workerpoolOwner },
        ];
        allDeals.push(...workerpoolOwnerSpecificDeals);
        apporderSpecificDeals = [{ apporderHash, blockNumber: 12 }];
        allDeals.push(...apporderSpecificDeals);
        datasetorderSpecificDeals = [
          { datasetorderHash, blockNumber: 13 },
          { datasetorderHash },
        ];
        allDeals.push(...datasetorderSpecificDeals);
        workerpoolorderSpecificDeals = [
          { workerpoolorderHash, blockNumber: 14 },
          { workerpoolorderHash },
          { workerpoolorderHash },
        ];
        allDeals.push(...workerpoolorderSpecificDeals);
        requestorderSpecificDeals = [
          { requestorderHash, blockNumber: 15 },
          { requestorderHash },
          { requestorderHash },
          { requestorderHash },
        ];
        allDeals.push(...requestorderSpecificDeals);
        await addDeals(chainId, allDeals);
      });

      test('GET /deals (missing chainId)', async () => {
        const { status, data } = await request
          .get(buildQuery('/deals', {}))
          .then(parseResult);
        expect(status).toBe(VALIDATION_ERROR_STATUS);
        expect(data.ok).toBe(false);
        expect(data.error).toBe('chainId is a required field');
        expect(data.count).toBeUndefined();
        expect(data.deals).toBeUndefined();
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (invalid pageSize)', async () => {
        await request
          .get(
            buildQuery('/deals', {
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
            expect(data.deals).toBeUndefined();
          });

        await request
          .get(
            buildQuery('/deals', {
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
            expect(data.deals).toBeUndefined();
          });
      });

      test('GET /deals (invalid pageIndex)', async () => {
        await request
          .get(
            buildQuery('/deals', {
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
            expect(data.deals).toBeUndefined();
          });
      });

      test('GET /deals (sort + pagination)', async () => {
        const res1 = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              pageSize: 25,
            }),
          )
          .then(parseResult);
        expect(res1.status).toBe(OK_STATUS);
        expect(res1.data.ok).toBe(true);
        expect(res1.data.count).toBe(allDeals.length);
        expect(res1.data.deals).toBeDefined();
        expect(Array.isArray(res1.data.deals)).toBe(true);
        res1.data.deals.reduce((prev, curr) => {
          expect(typeof curr.dealid).toBe('string');
          expect(typeof curr.chainId).toBe('number');
          expect(typeof curr.app.pointer).toBe('string');
          expect(typeof curr.app.owner).toBe('string');
          expect(typeof curr.app.price).toBe('number');
          expect(typeof curr.dataset.pointer).toBe('string');
          expect(typeof curr.dataset.owner).toBe('string');
          expect(typeof curr.dataset.price).toBe('number');
          expect(typeof curr.workerpool.pointer).toBe('string');
          expect(typeof curr.workerpool.owner).toBe('string');
          expect(typeof curr.workerpool.price).toBe('number');
          expect(typeof curr.appHash).toBe('string');
          expect(typeof curr.datasetHash).toBe('string');
          expect(typeof curr.workerpoolHash).toBe('string');
          expect(typeof curr.requestHash).toBe('string');
          expect(typeof curr.requester).toBe('string');
          expect(typeof curr.beneficiary).toBe('string');
          expect(typeof curr.callback).toBe('string');
          expect(typeof curr.botFirst).toBe('number');
          expect(typeof curr.botSize).toBe('number');
          expect(typeof curr.category).toBe('number');
          expect(typeof curr.volume).toBe('number');
          expect(typeof curr.trust).toBe('number');
          expect(typeof curr.startTime).toBe('number');
          expect(typeof curr.params).toBe('string');
          expect(typeof curr.tag).toBe('string');
          expect(typeof curr.schedulerRewardRatio).toBe('number');
          expect(typeof curr.workerStake).toBe('number');
          expect(typeof curr.transactionHash).toBe('string');
          expect(typeof curr.blockNumber).toBe('number');
          expect(typeof curr.blockTimestamp).toBe('string');
          if (prev) {
            expect(prev.blockNumber >= curr.blockNumber).toBe(true);
            if (prev.blockNumber === curr.blockNumber) {
              expect(prev.dealid <= curr.dealid).toBe(true);
            }
          }
          return curr;
        });
        expect(res1.data.deals.length).toBe(25);
        const res2 = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              pageIndex: 1,
              pageSize: 25,
            }),
          )
          .then(parseResult);
        expect(res2.status).toBe(OK_STATUS);
        expect(res2.data.ok).toBe(true);
        expect(res2.data.count).toBe(allDeals.length);
        expect(res2.data.deals).toBeDefined();
        expect(Array.isArray(res2.data.deals)).toBe(true);
        res2.data.deals.reduce((prev, curr) => {
          expect(typeof curr.dealid).toBe('string');
          expect(typeof curr.chainId).toBe('number');
          expect(typeof curr.app.pointer).toBe('string');
          expect(typeof curr.app.owner).toBe('string');
          expect(typeof curr.app.price).toBe('number');
          expect(typeof curr.dataset.pointer).toBe('string');
          expect(typeof curr.dataset.owner).toBe('string');
          expect(typeof curr.dataset.price).toBe('number');
          expect(typeof curr.workerpool.pointer).toBe('string');
          expect(typeof curr.workerpool.owner).toBe('string');
          expect(typeof curr.workerpool.price).toBe('number');
          expect(typeof curr.appHash).toBe('string');
          expect(typeof curr.datasetHash).toBe('string');
          expect(typeof curr.workerpoolHash).toBe('string');
          expect(typeof curr.requestHash).toBe('string');
          expect(typeof curr.requester).toBe('string');
          expect(typeof curr.beneficiary).toBe('string');
          expect(typeof curr.callback).toBe('string');
          expect(typeof curr.botFirst).toBe('number');
          expect(typeof curr.botSize).toBe('number');
          expect(typeof curr.category).toBe('number');
          expect(typeof curr.volume).toBe('number');
          expect(typeof curr.trust).toBe('number');
          expect(typeof curr.startTime).toBe('number');
          expect(typeof curr.params).toBe('string');
          expect(typeof curr.tag).toBe('string');
          expect(typeof curr.schedulerRewardRatio).toBe('number');
          expect(typeof curr.workerStake).toBe('number');
          expect(typeof curr.transactionHash).toBe('string');
          expect(typeof curr.blockNumber).toBe('number');
          expect(typeof curr.blockTimestamp).toBe('string');
          if (prev) {
            expect(prev.blockNumber >= curr.blockNumber).toBe(true);
            if (prev.blockNumber === curr.blockNumber) {
              expect(prev.dealid <= curr.dealid).toBe(true);
            }
          }
          return curr;
        });
        expect(res2.data.deals.length).toBe(res1.data.count - 25);
        const res3 = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              pageIndex: 100,
              pageSize: 25,
            }),
          )
          .then(parseResult);
        expect(res3.status).toBe(OK_STATUS);
        expect(res3.data.ok).toBe(true);
        expect(res3.data.count).toBe(allDeals.length);
        expect(res3.data.deals).toBeDefined();
        expect(Array.isArray(res3.data.deals)).toBe(true);
        expect(res3.data.deals.length).toBe(0);
      });

      test('GET /deals (sort + legacy pagination)', async () => {
        const res1 = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
            }),
          )
          .then(parseResult);
        expect(res1.status).toBe(OK_STATUS);
        expect(res1.data.ok).toBe(true);
        expect(res1.data.count).toBe(allDeals.length);
        expect(res1.data.deals).toBeDefined();
        expect(Array.isArray(res1.data.deals)).toBe(true);
        res1.data.deals.reduce((prev, curr) => {
          expect(typeof curr.dealid).toBe('string');
          expect(typeof curr.chainId).toBe('number');
          expect(typeof curr.app.pointer).toBe('string');
          expect(typeof curr.app.owner).toBe('string');
          expect(typeof curr.app.price).toBe('number');
          expect(typeof curr.dataset.pointer).toBe('string');
          expect(typeof curr.dataset.owner).toBe('string');
          expect(typeof curr.dataset.price).toBe('number');
          expect(typeof curr.workerpool.pointer).toBe('string');
          expect(typeof curr.workerpool.owner).toBe('string');
          expect(typeof curr.workerpool.price).toBe('number');
          expect(typeof curr.appHash).toBe('string');
          expect(typeof curr.datasetHash).toBe('string');
          expect(typeof curr.workerpoolHash).toBe('string');
          expect(typeof curr.requestHash).toBe('string');
          expect(typeof curr.requester).toBe('string');
          expect(typeof curr.beneficiary).toBe('string');
          expect(typeof curr.callback).toBe('string');
          expect(typeof curr.botFirst).toBe('number');
          expect(typeof curr.botSize).toBe('number');
          expect(typeof curr.category).toBe('number');
          expect(typeof curr.volume).toBe('number');
          expect(typeof curr.trust).toBe('number');
          expect(typeof curr.startTime).toBe('number');
          expect(typeof curr.params).toBe('string');
          expect(typeof curr.tag).toBe('string');
          expect(typeof curr.schedulerRewardRatio).toBe('number');
          expect(typeof curr.workerStake).toBe('number');
          expect(typeof curr.transactionHash).toBe('string');
          expect(typeof curr.blockNumber).toBe('number');
          expect(typeof curr.blockTimestamp).toBe('string');
          if (prev) {
            expect(prev.blockNumber >= curr.blockNumber).toBe(true);
            if (prev.blockNumber === curr.blockNumber) {
              expect(prev.dealid <= curr.dealid).toBe(true);
            }
          }
          return curr;
        });
        expect(res1.data.deals.length).toBe(20);
        expect(res1.data.nextPage).toBeDefined();
        const res2 = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              page: res1.data.nextPage,
            }),
          )
          .then(parseResult);
        expect(res2.status).toBe(OK_STATUS);
        expect(res2.data.ok).toBe(true);
        expect(res2.data.count).toBe(allDeals.length);
        expect(res2.data.deals).toBeDefined();
        expect(Array.isArray(res2.data.deals)).toBe(true);
        res2.data.deals.reduce((prev, curr) => {
          expect(typeof curr.dealid).toBe('string');
          expect(typeof curr.chainId).toBe('number');
          expect(typeof curr.app.pointer).toBe('string');
          expect(typeof curr.app.owner).toBe('string');
          expect(typeof curr.app.price).toBe('number');
          expect(typeof curr.dataset.pointer).toBe('string');
          expect(typeof curr.dataset.owner).toBe('string');
          expect(typeof curr.dataset.price).toBe('number');
          expect(typeof curr.workerpool.pointer).toBe('string');
          expect(typeof curr.workerpool.owner).toBe('string');
          expect(typeof curr.workerpool.price).toBe('number');
          expect(typeof curr.appHash).toBe('string');
          expect(typeof curr.datasetHash).toBe('string');
          expect(typeof curr.workerpoolHash).toBe('string');
          expect(typeof curr.requestHash).toBe('string');
          expect(typeof curr.requester).toBe('string');
          expect(typeof curr.beneficiary).toBe('string');
          expect(typeof curr.callback).toBe('string');
          expect(typeof curr.botFirst).toBe('number');
          expect(typeof curr.botSize).toBe('number');
          expect(typeof curr.category).toBe('number');
          expect(typeof curr.volume).toBe('number');
          expect(typeof curr.trust).toBe('number');
          expect(typeof curr.startTime).toBe('number');
          expect(typeof curr.params).toBe('string');
          expect(typeof curr.tag).toBe('string');
          expect(typeof curr.schedulerRewardRatio).toBe('number');
          expect(typeof curr.workerStake).toBe('number');
          expect(typeof curr.transactionHash).toBe('string');
          expect(typeof curr.blockNumber).toBe('number');
          expect(typeof curr.blockTimestamp).toBe('string');
          if (prev) {
            expect(prev.blockNumber >= curr.blockNumber).toBe(true);
            if (prev.blockNumber === curr.blockNumber) {
              expect(prev.dealid <= curr.dealid).toBe(true);
            }
          }
          return curr;
        });
        expect(res2.data.deals.length).toBe(
          allDeals.length - res1.data.deals.length,
        );
        expect(res2.data.nextPage).toBeUndefined();
      });

      test('GET /deals (category filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              category: 5,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(categorySpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(categorySpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.category).toBe(5);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (requester filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              requester,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(requesterSpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(requesterSpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.requester).toBe(requester);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (beneficiary filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              beneficiary,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(beneficiarySpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(beneficiarySpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.beneficiary).toBe(beneficiary);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (app filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              app,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(appSpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(appSpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.app.pointer).toBe(app);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (dataset filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              dataset,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(datasetSpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(datasetSpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.dataset.pointer).toBe(dataset);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (workerpool filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              workerpool,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(workerpoolSpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(workerpoolSpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.workerpool.pointer).toBe(workerpool);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (appOwner filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              appOwner,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(appOwnerSpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(appOwnerSpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.app.owner).toBe(appOwner);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (datasetOwner filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              datasetOwner,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(datasetOwnerSpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(datasetOwnerSpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.dataset.owner).toBe(datasetOwner);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (workerpoolOwner filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              workerpoolOwner,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(workerpoolOwnerSpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(workerpoolOwnerSpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.workerpool.owner).toBe(workerpoolOwner);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (apporderHash filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              apporderHash,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(apporderSpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(apporderSpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.appHash).toBe(apporderHash);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (datasetorderHash filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              datasetorderHash,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(datasetorderSpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(datasetorderSpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.datasetHash).toBe(datasetorderHash);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /deals (workerpoolorderHash filter)', async () => {
        const { status, data } = await request
          .get(
            buildQuery('/deals', {
              chainId, // *
              workerpoolorderHash,
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.count).toBe(workerpoolorderSpecificDeals.length);
        expect(data.deals).toBeDefined();
        expect(Array.isArray(data.deals)).toBe(true);
        expect(data.deals.length).toBe(workerpoolorderSpecificDeals.length);
        data.deals.forEach((e) => {
          expect(e.workerpoolHash).toBe(workerpoolorderHash);
        });
        expect(data.nextPage).toBeUndefined();
      });

      test('GET /ohlc (missing category)', async () => {
        const { data, status } = await request
          .get(
            buildQuery('/ohlc', {
              chainId, // *
            }),
          )
          .then(parseResult);
        expect(status).toBe(VALIDATION_ERROR_STATUS);
        expect(data.ok).toBe(false);
        expect(data.error).toBe('category is a required field');
        expect(data.ohlc).toBeUndefined();
      });

      test('GET /ohlc', async () => {
        const { data, status } = await request
          .get(
            buildQuery('/ohlc', {
              chainId, // *
              category: 0, // *
            }),
          )
          .then(parseResult);
        expect(status).toBe(OK_STATUS);
        expect(data.ok).toBe(true);
        expect(data.ohlc).toBeDefined();
        expect(Array.isArray(data.ohlc)).toBe(true);
        expect(data.ohlc.length).toBe(
          allDeals.length - categorySpecificDeals.length,
        );
      });
    });
  });
});
