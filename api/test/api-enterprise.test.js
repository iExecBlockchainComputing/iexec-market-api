const supertest = require('supertest');
const { IExec, utils } = require('iexec');
const socket = require('../src/loaders/socket');
// jest spies
const socketEmitSpy = jest.spyOn(socket, 'emit');

const appli = require('../src/app');
const { chains } = require('../src/config');
const {
  WALLETS,
  parseResult,
  buildQuery,
  setChallenge,
  dropDB,
  deployAndGetApporder,
  deployAndGetDatasetorder,
  deployAndGetWorkerpoolorder,
  getMatchableRequestorder,
  deployAppFor,
  deployDatasetFor,
  deployWorkerpoolFor,
  timestampRegex,
} = require('./test-utils');

// jest config
jest.setTimeout(2 * 60 * 1000);

const OK_STATUS = 200;

const BUSINESS_ERROR_STATUS = 403;

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
    falvour: 'enterprise',
  },
  {
    hubAddress: chains[chainName].hubAddress,
    isNative: chains[chainName].isNative,
    resultProxyURL: 'http://example.com/',
  },
);

const iexecNotWhitelisted = new IExec(
  {
    ethProvider: utils.getSignerFromPrivateKey(
      chainUrl,
      WALLETS.NOT_KYC.privateKey,
    ),
    chainId,
    falvour: 'enterprise',
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
  server = appli.listen();
  request = supertest(server);
});

afterAll(async () => {
  server.close();
});

describe('API enterprise specific', () => {
  describe('Offchain marketplace', () => {
    describe('Order Management', () => {
      let appNotWhitelisted;
      let datasetNotWhitelisted;
      let workerpoolNotWhitelisted;
      let apporderTemplate;
      let datasetorderTemplate;
      let workerpoolorderTemplate;
      let requestorderTemplate;
      let apporderNotWhitelisted;
      let datasetorderNotWhitelisted;
      let workerpoolorderNotWhitelisted;
      let requestorderNotWhitelisted;

      beforeAll(async () => {
        apporderTemplate = await deployAndGetApporder(iexec);
        datasetorderTemplate = await deployAndGetDatasetorder(iexec);
        workerpoolorderTemplate = await deployAndGetWorkerpoolorder(iexec);
        requestorderTemplate = await getMatchableRequestorder(iexec, {
          apporder: apporderTemplate,
          workerpoolorder: workerpoolorderTemplate,
        });
        appNotWhitelisted = await deployAppFor(iexec, WALLETS.NOT_KYC.address);
        datasetNotWhitelisted = await deployDatasetFor(
          iexec,
          WALLETS.NOT_KYC.address,
        );
        workerpoolNotWhitelisted = await deployWorkerpoolFor(
          iexec,
          WALLETS.NOT_KYC.address,
        );
        apporderNotWhitelisted = await iexecNotWhitelisted.order
          .createApporder({ app: appNotWhitelisted })
          .then(iexecNotWhitelisted.order.signApporder);
        datasetorderNotWhitelisted = await iexecNotWhitelisted.order
          .createDatasetorder({ dataset: datasetNotWhitelisted })
          .then(iexecNotWhitelisted.order.signDatasetorder);
        workerpoolorderNotWhitelisted = await iexecNotWhitelisted.order
          .createWorkerpoolorder({
            workerpool: workerpoolNotWhitelisted,
            category: 0,
          })
          .then(iexecNotWhitelisted.order.signWorkerpoolorder);
        requestorderNotWhitelisted = await getMatchableRequestorder(
          iexecNotWhitelisted,
          {
            apporder: apporderTemplate,
            workerpoolorder: workerpoolorderTemplate,
          },
        );
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
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
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

          test('POST /apporders (order signer not whitelisted)', async () => {
            const order = await iexecNotWhitelisted.order.signApporder({
              ...apporderNotWhitelisted,
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
            });
            await setChallenge(chainId, WALLETS.NOT_KYC.challenge);
            const { data, status } = await request
              .post(
                buildQuery('/apporders', {
                  chainId, // *
                }),
              )
              .send({
                order,
              })
              .set('authorization', WALLETS.NOT_KYC.authorization)
              .then(parseResult);
            expect(status).toBe(BUSINESS_ERROR_STATUS);
            expect(data.ok).toBe(false);
            expect(data.published).toBeUndefined();
            expect(data.error).toBe(
              `Order signer ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
            );
          });

          test('POST /apporders (dataset restricted owner not whitelisted)', async () => {
            const order = await iexec.order.signApporder({
              ...apporderTemplate,
              datasetrestrict: datasetNotWhitelisted,
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
            });
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
            expect(data.published).toBeUndefined();
            expect(data.error).toBe(
              `Dataset owner ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
            );
          });

          test('POST /apporders (workerpool restricted owner not whitelisted)', async () => {
            const order = await iexec.order.signApporder({
              ...apporderTemplate,
              workerpoolrestrict: workerpoolNotWhitelisted,
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
            });
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
            expect(data.published).toBeUndefined();
            expect(data.error).toBe(
              `Workerpool owner ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
            );
          });

          test('POST /apporders (requester restricted not whitelisted)', async () => {
            const order = await iexec.order.signApporder({
              ...apporderTemplate,
              requesterrestrict: WALLETS.NOT_KYC.address,
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
            });
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
            expect(data.published).toBeUndefined();
            expect(data.error).toBe(
              `Requester ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
            );
          });
        });
      });

      describe('/datasetorders', () => {
        describe('publish', () => {
          test('POST /datasetorders (standard)', async () => {
            const order = await iexec.order.signDatasetorder({
              ...datasetorderTemplate,
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
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
        });

        test('POST /datasetorders (order signer not whitelisted)', async () => {
          const order = await iexecNotWhitelisted.order.signDatasetorder({
            ...datasetorderNotWhitelisted,
            tag:
              '0x1000000000000000000000000000000000000000000000000000000000000101',
          });
          await setChallenge(chainId, WALLETS.NOT_KYC.challenge);
          const { data, status } = await request
            .post(
              buildQuery('/datasetorders', {
                chainId, // *
              }),
            )
            .send({
              order,
            })
            .set('authorization', WALLETS.NOT_KYC.authorization)
            .then(parseResult);
          expect(status).toBe(BUSINESS_ERROR_STATUS);
          expect(data.ok).toBe(false);
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `Order signer ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });

        test('POST /datasetorders (app restricted owner not whitelisted)', async () => {
          const order = await iexec.order.signDatasetorder({
            ...datasetorderTemplate,
            apprestrict: appNotWhitelisted,
            tag:
              '0x1000000000000000000000000000000000000000000000000000000000000101',
          });
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
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `App owner ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });

        test('POST /datasetorders (workerpool restricted owner not whitelisted)', async () => {
          const order = await iexec.order.signDatasetorder({
            ...datasetorderTemplate,
            workerpoolrestrict: workerpoolNotWhitelisted,
            tag:
              '0x1000000000000000000000000000000000000000000000000000000000000101',
          });
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
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `Workerpool owner ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });

        test('POST /datasetorders (requester restricted not whitelisted)', async () => {
          const order = await iexec.order.signDatasetorder({
            ...datasetorderTemplate,
            requesterrestrict: WALLETS.NOT_KYC.address,
            tag:
              '0x1000000000000000000000000000000000000000000000000000000000000101',
          });
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
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `Requester ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });
      });

      describe('/workerpoolorders', () => {
        describe('publish', () => {
          test('POST /workerpoolorders (standard)', async () => {
            const address = await iexec.wallet.getAddress();
            const order = await iexec.order.signWorkerpoolorder({
              ...workerpoolorderTemplate,
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
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
        });

        test('POST /workerpoolorders (order signer not whitelisted)', async () => {
          const order = await iexecNotWhitelisted.order.signWorkerpoolorder({
            ...workerpoolorderNotWhitelisted,
            tag:
              '0x1000000000000000000000000000000000000000000000000000000000000101',
          });
          await setChallenge(chainId, WALLETS.NOT_KYC.challenge);
          const { data, status } = await request
            .post(
              buildQuery('/workerpoolorders', {
                chainId, // *
              }),
            )
            .send({
              order,
            })
            .set('authorization', WALLETS.NOT_KYC.authorization)
            .then(parseResult);
          expect(status).toBe(BUSINESS_ERROR_STATUS);
          expect(data.ok).toBe(false);
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `Order signer ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });

        test('POST /workerpoolorders (app restricted owner not whitelisted)', async () => {
          const order = await iexec.order.signWorkerpoolorder({
            ...workerpoolorderTemplate,
            apprestrict: appNotWhitelisted,
            tag:
              '0x1000000000000000000000000000000000000000000000000000000000000101',
          });
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
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `App owner ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });

        test('POST /workerpoolorders (dataset restricted owner not whitelisted)', async () => {
          const order = await iexec.order.signWorkerpoolorder({
            ...workerpoolorderTemplate,
            datasetrestrict: datasetNotWhitelisted,
            tag:
              '0x1000000000000000000000000000000000000000000000000000000000000101',
          });
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
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `Dataset owner ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });

        test('POST /workerpoolorders (requester restricted not whitelisted)', async () => {
          const order = await iexec.order.signWorkerpoolorder({
            ...workerpoolorderTemplate,
            requesterrestrict: WALLETS.NOT_KYC.address,
            tag:
              '0x1000000000000000000000000000000000000000000000000000000000000101',
          });
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
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `Requester ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });
      });

      describe('/requestorders', () => {
        describe('publish', () => {
          test('POST /requestorders (standard)', async () => {
            const order = await iexec.order.signRequestorder(
              {
                ...requestorderTemplate,
                workerpool: utils.NULL_ADDRESS,
                tag:
                  '0xf000000000000000000000000000000000000000000000000000000000000001',
              },
              { checkRequest: false },
            );
            const hash = await iexec.order.hashRequestorder(order);
            const apporder = await iexec.order.signApporder({
              ...apporderTemplate,
              tag:
                '0x0000000000000000000000000000000000000000000000000000000000000001',
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
        });

        test('POST /requestorders (requester not whitelisted)', async () => {
          const order = await iexecNotWhitelisted.order.signRequestorder(
            {
              ...requestorderNotWhitelisted,
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
            },
            { checkRequest: false },
          );
          jest.clearAllMocks();
          await setChallenge(chainId, WALLETS.NOT_KYC.challenge);
          const { data, status } = await request
            .post(
              buildQuery('/requestorders', {
                chainId, // *
              }),
            )
            .send({
              order,
            })
            .set('authorization', WALLETS.NOT_KYC.authorization)
            .then(parseResult);
          expect(status).toBe(BUSINESS_ERROR_STATUS);
          expect(data.ok).toBe(false);
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `Order signer ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });

        test('POST /requestorders (app owner not whitelisted)', async () => {
          const order = await iexec.order.signRequestorder(
            {
              ...requestorderTemplate,
              app: appNotWhitelisted,
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
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
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `App owner ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });

        test('POST /requestorders (dataset owner not whitelisted)', async () => {
          const order = await iexec.order.signRequestorder(
            {
              ...requestorderTemplate,
              dataset: datasetNotWhitelisted,
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
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
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `Dataset owner ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });

        test('POST /requestorders (workerpool owner not whitelisted)', async () => {
          const order = await iexec.order.signRequestorder(
            {
              ...requestorderTemplate,
              workerpool: workerpoolNotWhitelisted,
              tag:
                '0x1000000000000000000000000000000000000000000000000000000000000101',
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
          expect(data.published).toBeUndefined();
          expect(data.error).toBe(
            `Workerpool owner ${WALLETS.NOT_KYC.address} is not authorized by eRLC`,
          );
        });
      });
    });
  });
});
