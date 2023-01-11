const ethers = require('ethers');
const { utils, IExec } = require('iexec');
const socket = require('../src/loaders/socket');
// jest spies
const socketEmitSpy = jest.spyOn(socket, 'emit');
const { start, stop } = require('../src/app');
const { replayPastOnly } = require('../src/controllers/replayer');
const { chain } = require('../src/config');
const { sleep } = require('../src/utils/utils');
const { STATUS_MAP } = require('../src/utils/order-utils');
const {
  addApporders,
  addDatasetorders,
  addWorkerpoolorders,
  addRequestorders,
  find,
  dropDB,
  deployAndGetApporder,
  deployAndGetDatasetorder,
  deployAndGetWorkerpoolorder,
  getMatchableRequestorder,
  transferResourceERC721,
  timestampRegex,
  bytes32Regex,
  APPORDERS_COLLECTION,
  DATASETORDERS_COLLECTION,
  WORKERPOOLORDERS_COLLECTION,
  REQUESTORDERS_COLLECTION,
  DEALS_COLLECTION,
  CATEGORIES_COLLECTION,
  fastForwardToLastBlock,
} = require('./test-utils');
const { init: ethereumInit } = require('../src/loaders/ethereum');

jest.setTimeout(120000);

const PROCESS_TRIGGERED_EVENT_TIMEOUT = 1000;

let chainId;
const chainUrl = chain.httpHost;
const { hubAddress } = chain;
const PRIVATE_KEY =
  '0x564a9db84969c8159f7aa3d5393c5ecd014fce6a375842a45b12af6677b12407';
const rpc = new ethers.providers.JsonRpcProvider(chainUrl);
const wallet = new ethers.Wallet(PRIVATE_KEY, rpc);

let iexec;
const signer = utils.getSignerFromPrivateKey(chainUrl, PRIVATE_KEY);

beforeAll(async () => {
  const network = await rpc.getNetwork();
  chainId = `${network.chainId}`;
  iexec = new IExec(
    {
      ethProvider: signer,
    },
    {
      hubAddress,
      isNative: chain.isNative,
      resultProxyURL: 'http://example.com',
    },
  );
  await dropDB(chainId);
  await iexec.account.deposit(100);
  const { stake } = await iexec.account.checkBalance(
    await iexec.wallet.getAddress(),
  );
  await iexec.account.withdraw(stake);
});

describe('Watcher', () => {
  beforeAll(async () => {
    await start({ syncWatcher: false, replayer: false });
    await dropDB(chainId);
  });

  beforeEach(async () => {
    await dropDB(chainId);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await stop();
  });

  test('CreateCategory', async () => {
    const { catid, txHash } = await iexec.hub.createCategory({
      name: 'TEST',
      description: 'DESC',
      workClockTimeRef: '300',
    });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [saved] = await find(chainId, CATEGORIES_COLLECTION, {
      catid: catid.toNumber(),
    });
    expect(saved.name).toBe('TEST');
    expect(saved.description).toBe('DESC');
    expect(saved.workClockTimeRef).toBe(300);
    expect(saved.transactionHash).toBe(txHash);
    expect(typeof saved.blockNumber).toBe('number');
    expect(saved.blockTimestamp).toMatch(timestampRegex);
    expect(saved.chainId).toBe(Number(chainId));
  });

  test('OrderMatched (save deal)', async () => {
    const address = await iexec.wallet.getAddress();
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const { dealid, txHash } = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    const [appHash, datasetHash, workerpoolHash, requestHash] =
      await Promise.all([
        iexec.order.hashApporder(apporder),
        iexec.order.hashDatasetorder(datasetorder),
        iexec.order.hashWorkerpoolorder(workerpoolorder),
        iexec.order.hashRequestorder(requestorder),
      ]);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [saved] = await find(chainId, DEALS_COLLECTION, { dealid });
    expect(saved.dealid).toBe(dealid);
    expect(saved.app.pointer).toBe(apporder.app);
    expect(saved.app.price).toBe(Number(apporder.appprice));
    expect(saved.app.owner).toBe(address);
    expect(saved.dataset.pointer).toBe(datasetorder.dataset);
    expect(saved.dataset.price).toBe(Number(datasetorder.datasetprice));
    expect(saved.dataset.owner).toBe(address);
    expect(saved.workerpool.pointer).toBe(workerpoolorder.workerpool);
    expect(saved.workerpool.price).toBe(
      Number(workerpoolorder.workerpoolprice),
    );
    expect(saved.workerpool.owner).toBe(address);
    expect(saved.appHash).toMatch(bytes32Regex);
    expect(saved.appHash).toBe(appHash);
    expect(saved.datasetHash).toMatch(bytes32Regex);
    expect(saved.datasetHash).toBe(datasetHash);
    expect(saved.workerpoolHash).toMatch(bytes32Regex);
    expect(saved.workerpoolHash).toBe(workerpoolHash);
    expect(saved.requestHash).toMatch(bytes32Regex);
    expect(saved.requestHash).toBe(requestHash);
    expect(saved.requester).toBe(requestorder.requester);
    expect(saved.beneficiary).toBe(requestorder.beneficiary);
    expect(saved.category).toBe(Number(requestorder.category));
    expect(saved.trust).toBe(Math.max(Number(requestorder.trust), 1));
    expect(saved.tag).toBe(requestorder.tag);
    expect(saved.volume).toBe(Number(requestorder.volume));
    expect(saved.callback).toBe(requestorder.callback);
    expect(saved.params).toBe(requestorder.params);
    expect(saved.botFirst).toBe(0);
    expect(saved.botSize).toBe(1);
    expect(saved.workerStake).toBe(0);
    expect(saved.schedulerRewardRatio).toBe(1);
    expect(saved.transactionHash).toBe(txHash);
    expect(typeof saved.blockNumber).toBe('number');
    expect(saved.blockTimestamp).toMatch(timestampRegex);
    expect(saved.chainId).toBe(Number(chainId));
    expect(socketEmitSpy).toHaveBeenCalledTimes(1);
    expect(socketEmitSpy).toHaveBeenNthCalledWith(
      1,
      `${chainId}:deals`,
      'deal_created',
      expect.objectContaining({ dealid }),
    );
  });

  test('OrderMatched (update orders all filled)', async () => {
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const [appHash, datasetHash, workerpoolHash, requestHash] =
      await Promise.all([
        iexec.order.hashApporder(apporder),
        iexec.order.hashDatasetorder(datasetorder),
        iexec.order.hashWorkerpoolorder(workerpoolorder),
        iexec.order.hashRequestorder(requestorder),
      ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
      ]),
    ]);
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.FILLED);
    expect(savedApporder.remaining).toBe(0);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedDatasetorder.remaining).toBe(0);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedWorkerpoolorder.remaining).toBe(0);
    expect(savedRequestorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedRequestorder.remaining).toBe(0);
    expect(socketEmitSpy).toHaveBeenCalledTimes(5);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([[`${chainId}:orders`, 'apporder_unpublished', appHash]]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'datasetorder_unpublished', datasetHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'workerpoolorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'workerpoolorder_unpublished', workerpoolHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'requestorder_unpublished', requestHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter((args) => args[1] === 'deal_created'),
    ).toMatchObject([
      [`${chainId}:deals`, 'deal_created', expect.objectContaining({ dealid })],
    ]);
  });

  test('OrderMatched (update orders partial fill)', async () => {
    const apporder = await deployAndGetApporder(iexec, { volume: 105 });
    const datasetorder = await deployAndGetDatasetorder(iexec, { volume: 205 });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      volume: 35,
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
      volume: 5,
    });
    const partiallyMatchableRequestorder = await getMatchableRequestorder(
      iexec,
      {
        apporder,
        datasetorder,
        workerpoolorder,
        volume: 40,
      },
    );
    const [
      appHash,
      datasetHash,
      workerpoolHash,
      requestHash,
      partiallyMatchableRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashWorkerpoolorder(workerpoolorder),
      iexec.order.hashRequestorder(requestorder),
      iexec.order.hashRequestorder(partiallyMatchableRequestorder),
    ]);

    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
        {
          orderHash: partiallyMatchableRequestHash,
          order: partiallyMatchableRequestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);

    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(savedApporder.remaining).toBe(100);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorder.remaining).toBe(200);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorder.remaining).toBe(30);
    expect(savedRequestorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedRequestorder.remaining).toBe(0);

    expect(socketEmitSpy).toHaveBeenCalledTimes(5);
    expect(
      socketEmitSpy.mock.calls.filter((args) => args[1] === 'apporder_updated'),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'apporder_updated',
        expect.objectContaining({ orderHash: appHash }),
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_updated',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'datasetorder_updated',
        expect.objectContaining({ orderHash: datasetHash }),
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'workerpoolorder_updated',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'workerpoolorder_updated',
        expect.objectContaining({ orderHash: workerpoolHash }),
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_updated',
      ),
    ).toMatchObject([]);

    jest.clearAllMocks();

    await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder: partiallyMatchableRequestorder,
      },
      { checkRequest: false },
    );
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [savedPartiallyMatchedRequestorder] = await find(
      chainId,
      REQUESTORDERS_COLLECTION,
      {
        orderHash: partiallyMatchableRequestHash,
      },
    );
    expect(savedPartiallyMatchedRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedPartiallyMatchedRequestorder.remaining).toBe(10);
    expect(socketEmitSpy).toHaveBeenCalledTimes(5);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_updated',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_updated',
        expect.objectContaining({ orderHash: partiallyMatchableRequestHash }),
      ],
    ]);
  });

  test('OrderMatched (clean app dependant requestOrders)', async () => {
    await iexec.account.deposit(100);

    const privateIexecUser = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          chainUrl,
          ethers.Wallet.createRandom().privateKey,
        ),
      },
      {
        hubAddress,
        isNative: chain.isNative,
        resultProxyURL: 'http://example.com',
      },
    );

    const apporder = await deployAndGetApporder(iexec);
    const independentApporder = await deployAndGetApporder(iexec);
    const apporder5nRlc = await iexec.order.signApporder({
      ...apporder,
      appprice: 5,
    });
    const apporderPrivate = await iexec.order.signApporder({
      ...apporder,
      appprice: 0,
      requesterrestrict: await privateIexecUser.wallet.getAddress(),
    });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const requestorderApp = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const requestorderApp5nRlc = await getMatchableRequestorder(iexec, {
      apporder: apporder5nRlc,
      workerpoolorder,
    });
    const independentRequestorder = await getMatchableRequestorder(iexec, {
      apporder: independentApporder,
      workerpoolorder,
    });
    const requestorderPrivate = await getMatchableRequestorder(
      privateIexecUser,
      {
        apporder: apporderPrivate,
        workerpoolorder,
      },
    );
    const [
      independentAppHash,
      appHash,
      app5nRlcHash,
      appPrivateHash,
      requestAppHash,
      requestApp5nRlcHash,
      independentRequestHash,
      requestPrivateHash,
    ] = await Promise.all([
      iexec.order.hashApporder(independentApporder),
      iexec.order.hashApporder(apporder),
      iexec.order.hashApporder(apporder5nRlc),
      iexec.order.hashApporder(apporderPrivate),
      iexec.order.hashRequestorder(requestorderApp),
      iexec.order.hashRequestorder(requestorderApp5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
      iexec.order.hashRequestorder(requestorderPrivate),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: independentAppHash,
          order: independentApporder,
        },
        {
          orderHash: appHash,
          order: apporder,
        },
        {
          orderHash: app5nRlcHash,
          order: apporder5nRlc,
        },
        {
          orderHash: appPrivateHash,
          order: apporderPrivate,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestAppHash,
          order: requestorderApp,
        },
        {
          orderHash: requestApp5nRlcHash,
          order: requestorderApp5nRlc,
        },
        {
          orderHash: requestPrivateHash,
          order: requestorderPrivate,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedRequestorderApp],
      [savedRequestorderApp5nRlc],
      [savedRequestorderPrivate],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestApp5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestPrivateHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedRequestorderApp.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderApp5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderPrivate.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(3);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'requestorder_unpublished', requestAppHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([[`${chainId}:orders`, 'apporder_unpublished', appHash]]);
    expect(
      socketEmitSpy.mock.calls.filter((args) => args[1] === 'deal_created'),
    ).toMatchObject([
      [`${chainId}:deals`, 'deal_created', expect.objectContaining({ dealid })],
    ]);
  });

  test('OrderMatched (clean app dependant TEE requestOrders)', async () => {
    await iexec.account.deposit(100);
    const independentApporder = await deployAndGetApporder(iexec);
    const apporderTee = await iexec.order.signApporder({
      ...independentApporder,
      tag: ['tee'],
    });
    const apporderTee5nRlc = await iexec.order.signApporder({
      ...independentApporder,
      tag: ['tee'],
      appprice: 5,
    });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      tag: ['tee'],
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder: apporderTee,
      workerpoolorder,
    });
    const requestorderAppTee = await getMatchableRequestorder(iexec, {
      apporder: apporderTee,
      workerpoolorder,
    });
    const requestorderAppTee5nRlc = await getMatchableRequestorder(iexec, {
      apporder: apporderTee5nRlc,
      workerpoolorder,
    });
    const independentRequestorder = await getMatchableRequestorder(iexec, {
      apporder: independentApporder,
      workerpoolorder,
    });
    const [
      independentAppHash,
      appTeeHash,
      appTee5nRlcHash,
      requestAppTeeHash,
      requestAppTee5nRlcHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(independentApporder),
      iexec.order.hashApporder(apporderTee),
      iexec.order.hashApporder(apporderTee5nRlc),
      iexec.order.hashRequestorder(requestorderAppTee),
      iexec.order.hashRequestorder(requestorderAppTee5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: independentAppHash,
          order: independentApporder,
        },
        {
          orderHash: appTeeHash,
          order: apporderTee,
        },
        {
          orderHash: appTee5nRlcHash,
          order: apporderTee5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestAppTeeHash,
          order: requestorderAppTee,
        },
        {
          orderHash: requestAppTee5nRlcHash,
          order: requestorderAppTee5nRlc,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder: apporderTee,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedRequestorderAppTee],
      [savedRequestorderAppTee5nRlc],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppTeeHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppTee5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedRequestorderAppTee.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderAppTee5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(3);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'requestorder_unpublished', requestAppTeeHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'apporder_unpublished', appTeeHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter((args) => args[1] === 'deal_created'),
    ).toMatchObject([
      [`${chainId}:deals`, 'deal_created', expect.objectContaining({ dealid })],
    ]);
  });

  test('OrderMatched (clean dataset dependant requestOrders)', async () => {
    await iexec.account.deposit(100);

    const privateIexecUser = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          chainUrl,
          ethers.Wallet.createRandom().privateKey,
        ),
      },
      {
        hubAddress,
        isNative: chain.isNative,
        resultProxyURL: 'http://example.com',
      },
    );

    const apporder = await deployAndGetApporder(iexec, { volume: 2 });
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const datasetorder5nRlc = await iexec.order.signDatasetorder({
      ...datasetorder,
      datasetprice: 5,
    });
    const datasetorderPrivate = await iexec.order.signDatasetorder({
      ...datasetorder,
      datasetprice: 0,
      requesterrestrict: await privateIexecUser.wallet.getAddress(),
    });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const requestorderDataset = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const requestorderDataset5nRlc = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder: datasetorder5nRlc,
      workerpoolorder,
    });
    const independentRequestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const requestorderPrivate = await getMatchableRequestorder(
      privateIexecUser,
      {
        apporder,
        dataset: datasetorderPrivate,
        workerpoolorder,
      },
    );
    const [
      appHash,
      datasetHash,
      dataset5nRlcHash,
      datasetPrivateHash,
      requestDatasetHash,
      requestDataset5nRlcHash,
      independentRequestHash,
      requestPrivateHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashDatasetorder(datasetorder5nRlc),
      iexec.order.hashDatasetorder(datasetorderPrivate),
      iexec.order.hashRequestorder(requestorderDataset),
      iexec.order.hashRequestorder(requestorderDataset5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
      iexec.order.hashRequestorder(requestorderPrivate),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
        {
          orderHash: dataset5nRlcHash,
          order: datasetorder5nRlc,
        },
        {
          orderHash: datasetPrivateHash,
          order: datasetorderPrivate,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestDatasetHash,
          order: requestorderDataset,
        },
        {
          orderHash: requestDataset5nRlcHash,
          order: requestorderDataset5nRlc,
        },
        {
          orderHash: requestPrivateHash,
          order: requestorderPrivate,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    const { dealid } = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedRequestorderDataset],
      [savedRequestorderDataset5nRlc],
      [savedRequestorderPrivate],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDatasetHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDataset5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestPrivateHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedRequestorderDataset.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderDataset5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderPrivate.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(4);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'requestorder_unpublished', requestDatasetHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter((args) => args[1] === 'apporder_updated'),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'apporder_updated',
        expect.objectContaining({ orderHash: appHash }),
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'datasetorder_unpublished', datasetHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter((args) => args[1] === 'deal_created'),
    ).toMatchObject([
      [`${chainId}:deals`, 'deal_created', expect.objectContaining({ dealid })],
    ]);
  });

  test('ClosedAppOrder (cancel order)', async () => {
    const apporder = await deployAndGetApporder(iexec);
    const [appHash] = await Promise.all([iexec.order.hashApporder(apporder)]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
    ]);
    await iexec.order.cancelApporder(apporder);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [[savedApporder]] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedApporder.remaining).toBe(0);
    expect(socketEmitSpy).toHaveBeenCalledTimes(1);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([[`${chainId}:orders`, 'apporder_unpublished', appHash]]);
  });

  test('ClosedAppOrder (clean dependant requestorder)', async () => {
    await iexec.account.deposit(100);

    const privateIexecUser = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          chainUrl,
          ethers.Wallet.createRandom().privateKey,
        ),
      },
      {
        hubAddress,
        isNative: chain.isNative,
        resultProxyURL: 'http://example.com',
      },
    );

    const apporder = await deployAndGetApporder(iexec, { appprice: 0 });
    const apporder5nRlc = await iexec.order.signApporder({
      ...apporder,
      appprice: 5,
    });
    const apporderPrivate = await iexec.order.signApporder({
      ...apporder,
      appprice: 0,
      requesterrestrict: await privateIexecUser.wallet.getAddress(),
    });
    const requestorder = await iexec.order
      .createRequestorder({
        app: apporder.app,
        appmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: await iexec.wallet.getAddress(),
        category: 0,
        volume: 10,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const independentRequestorder = await iexec.order.signRequestorder(
      {
        ...requestorder,
        appmaxprice: 5,
      },
      { checkRequest: false },
    );
    const requestorderPrivate = await privateIexecUser.order.signRequestorder(
      {
        ...requestorder,
        requester: await privateIexecUser.wallet.getAddress(),
      },
      { checkRequest: false },
    );
    const [
      appHash,
      app5nRlcHash,
      appPrivateHash,
      requestHash,
      requestPrivateHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashApporder(apporder5nRlc),
      iexec.order.hashApporder(apporderPrivate),
      iexec.order.hashRequestorder(requestorder),
      iexec.order.hashRequestorder(requestorderPrivate),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
        {
          orderHash: app5nRlcHash,
          order: apporder5nRlc,
        },
        {
          orderHash: appPrivateHash,
          order: apporderPrivate,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
        {
          orderHash: requestPrivateHash,
          order: requestorderPrivate,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.cancelApporder(apporder);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporder],
      [savedRequestorder],
      [savedRequestorderPrivate],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestPrivateHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedApporder.remaining).toBe(0);
    expect(savedRequestorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderPrivate.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(2);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'requestorder_unpublished', requestHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([[`${chainId}:orders`, 'apporder_unpublished', appHash]]);
  });

  test('ClosedAppOrder (clean dependant TEE requestorder)', async () => {
    await iexec.account.deposit(100);
    const apporder = await deployAndGetApporder(iexec);
    const apporderTee = await iexec.order.signApporder({
      ...apporder,
      tag: ['tee'],
    });
    const apporderTee5nRlc = await iexec.order.signApporder({
      ...apporder,
      tag: ['tee'],
      appprice: 5,
    });
    const independentRequestorder = await iexec.order
      .createRequestorder({
        app: apporder.app,
        appmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: await iexec.wallet.getAddress(),
        category: 0,
        volume: 10,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const requestorderTee = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        tag: ['tee'],
      },
      { checkRequest: false },
    );
    const requestorderTee5nRlc = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        tag: ['tee'],
        appmaxprice: 5,
      },
      { checkRequest: false },
    );
    const [
      appHash,
      appTeeHash,
      appTee5nRlcHash,
      requestTeeHash,
      requestTee5nRlcHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashApporder(apporderTee),
      iexec.order.hashApporder(apporderTee5nRlc),
      iexec.order.hashRequestorder(requestorderTee),
      iexec.order.hashRequestorder(requestorderTee5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
        {
          orderHash: appTeeHash,
          order: apporderTee,
        },
        {
          orderHash: appTee5nRlcHash,
          order: apporderTee5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestTeeHash,
          order: requestorderTee,
        },
        {
          orderHash: requestTee5nRlcHash,
          order: requestorderTee5nRlc,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.cancelApporder(apporderTee);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporderTee],
      [savedRequestorderTee],
      [savedRequestorderTee5nRlc],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appTeeHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestTeeHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestTee5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedApporderTee.status).toBe(STATUS_MAP.CANCELED);
    expect(savedApporderTee.remaining).toBe(0);
    expect(savedRequestorderTee.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderTee5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(2);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'requestorder_unpublished', requestTeeHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'apporder_unpublished', appTeeHash],
    ]);
  });

  test('ClosedDatasetOrder (cancel order)', async () => {
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const [datasetHash] = await Promise.all([
      iexec.order.hashDatasetorder(datasetorder),
    ]);
    await Promise.all([
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
      ]),
    ]);
    await iexec.order.cancelDatasetorder(datasetorder);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [[savedDatasetorder]] = await Promise.all([
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
    ]);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedDatasetorder.remaining).toBe(0);
    expect(socketEmitSpy).toHaveBeenCalledTimes(1);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'datasetorder_unpublished', datasetHash],
    ]);
  });

  test('ClosedDatasetOrder (clean dependant requestorder)', async () => {
    await iexec.account.deposit(100);

    const privateIexecUser = new IExec(
      {
        ethProvider: utils.getSignerFromPrivateKey(
          chainUrl,
          ethers.Wallet.createRandom().privateKey,
        ),
      },
      {
        hubAddress,
        isNative: chain.isNative,
        resultProxyURL: 'http://example.com',
      },
    );

    const datasetorder = await deployAndGetDatasetorder(iexec, {
      datasetprice: 0,
    });
    const datasetorder5nRlc = await iexec.order.signDatasetorder({
      ...datasetorder,
      datasetprice: 5,
    });
    const datasetorderPrivate = await iexec.order.signDatasetorder({
      ...datasetorder,
      datasetprice: 0,
      requesterrestrict: await privateIexecUser.wallet.getAddress(),
    });
    const apporder = await deployAndGetApporder(iexec, {
      datasetrestrict: datasetorder.dataset,
    });
    const requestorder = await iexec.order
      .createRequestorder({
        app: apporder.app,
        appmaxprice: 0,
        dataset: datasetorder.dataset,
        datasetmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: await iexec.wallet.getAddress(),
        category: 0,
        volume: 10,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const independentRequestorder = await iexec.order.signRequestorder(
      {
        ...requestorder,
        datasetmaxprice: 5,
      },
      { checkRequest: false },
    );
    const requestorderPrivate = await privateIexecUser.order.signRequestorder(
      {
        ...requestorder,
        requester: await privateIexecUser.wallet.getAddress(),
      },
      { checkRequest: false },
    );
    const [
      appHash,
      datasetHash,
      dataset5nRlcHash,
      datasetPrivateHash,
      requestHash,
      requestPrivateHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashDatasetorder(datasetorder5nRlc),
      iexec.order.hashDatasetorder(datasetorderPrivate),
      iexec.order.hashRequestorder(requestorder),
      iexec.order.hashRequestorder(requestorderPrivate),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
        {
          orderHash: dataset5nRlcHash,
          order: datasetorder5nRlc,
        },
        {
          orderHash: datasetPrivateHash,
          order: datasetorderPrivate,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
        {
          orderHash: requestPrivateHash,
          order: requestorderPrivate,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.cancelDatasetorder(datasetorder);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedDatasetorder5nRlc],
      [savedRequestorder],
      [savedRequestorderPrivate],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: dataset5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestPrivateHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedDatasetorder.remaining).toBe(0);
    expect(savedDatasetorder5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderPrivate.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(2);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'requestorder_unpublished', requestHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'datasetorder_unpublished', datasetHash],
    ]);
  });

  test('ClosedWorkerpoolOrder (cancel order)', async () => {
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const [workerpoolHash] = await Promise.all([
      iexec.order.hashWorkerpoolorder(workerpoolorder),
    ]);
    await Promise.all([
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
        },
      ]),
    ]);
    await iexec.order.cancelWorkerpoolorder(workerpoolorder);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [[savedWorkerpoolorder]] = await Promise.all([
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolHash,
      }),
    ]);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedWorkerpoolorder.remaining).toBe(0);
    expect(socketEmitSpy).toHaveBeenCalledTimes(1);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'workerpoolorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'workerpoolorder_unpublished', workerpoolHash],
    ]);
  });

  test('ClosedRequestOrder (cancel order)', async () => {
    const requestorder = await iexec.order
      .createRequestorder({
        app: utils.NULL_ADDRESS,
        category: 0,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));

    const [requestHash] = await Promise.all([
      iexec.order.hashRequestorder(requestorder),
    ]);
    await Promise.all([
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
      ]),
    ]);
    await iexec.order.cancelRequestorder(requestorder);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [[savedRequestorder]] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
    ]);
    expect(savedRequestorder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedRequestorder.remaining).toBe(0);
    expect(socketEmitSpy).toHaveBeenCalledTimes(1);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'requestorder_unpublished', requestHash],
    ]);
  });

  test('Transfer StakedRlc (clean dependant workerpoolorder)', async () => {
    await iexec.account.deposit(100);
    const address = await iexec.wallet.getAddress();
    const independentWorkerpoolorder = await deployAndGetWorkerpoolorder(
      iexec,
      {
        workerpoolprice: 36,
        volume: 3,
      },
    );
    const workerpoolorderTooExpensive = await iexec.order.signWorkerpoolorder({
      ...independentWorkerpoolorder,
      workerpoolprice: 104,
      volume: 1,
    });
    const workerpoolorderCumulativeTooExpensive =
      await iexec.order.signWorkerpoolorder({
        ...independentWorkerpoolorder,
        workerpoolprice: 37,
        volume: 3,
      });
    const [
      independentWorkerpoolHash,
      workerpoolorderTooExpensiveHash,
      workerpoolorderCumulativeTooExpensiveHash,
    ] = await Promise.all([
      iexec.order.hashWorkerpoolorder(independentWorkerpoolorder),
      iexec.order.hashWorkerpoolorder(workerpoolorderTooExpensive),
      iexec.order.hashWorkerpoolorder(workerpoolorderCumulativeTooExpensive),
    ]);
    await Promise.all([
      addWorkerpoolorders(chainId, [
        {
          orderHash: independentWorkerpoolHash,
          order: independentWorkerpoolorder,
          signer: address,
        },
        {
          orderHash: workerpoolorderTooExpensiveHash,
          order: workerpoolorderTooExpensive,
          signer: address,
        },
        {
          orderHash: workerpoolorderCumulativeTooExpensiveHash,
          order: workerpoolorderCumulativeTooExpensive,
          signer: address,
        },
      ]),
    ]);
    const { stake } = await iexec.account.checkBalance(address);
    await iexec.account.withdraw(stake.sub(new utils.BN(30)));
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedIndependentWorkerpoolorder],
      [savedWorkerpoolorderTooExpensive],
      [savedWorkerpoolorderCumulativeTooExpensive],
    ] = await Promise.all([
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: independentWorkerpoolHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolorderTooExpensiveHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolorderCumulativeTooExpensiveHash,
      }),
    ]);
    expect(savedIndependentWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderTooExpensive.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderCumulativeTooExpensive.status).toBe(
      STATUS_MAP.DEAD,
    );
    expect(socketEmitSpy).toHaveBeenCalledTimes(2);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) =>
          args[1] === 'workerpoolorder_unpublished' &&
          args[2] === workerpoolorderTooExpensiveHash,
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolorderTooExpensiveHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) =>
          args[1] === 'workerpoolorder_unpublished' &&
          args[2] === workerpoolorderCumulativeTooExpensiveHash,
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolorderCumulativeTooExpensiveHash,
      ],
    ]);
  });

  test('Transfer StakedRlc (clean dependant requestorder)', async () => {
    await iexec.account.deposit(100);
    const address = await iexec.wallet.getAddress();
    const independentRequestorder = await iexec.order
      .createRequestorder({
        app: utils.NULL_ADDRESS,
        appmaxprice: 1,
        datasetmaxprice: 1,
        workerpoolmaxprice: 1,
        requester: address,
        category: 0,
        volume: 3,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const requestorderAppTooExpensive = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        appmaxprice: 4,
        datasetmaxprice: 0,
        workerpoolmaxprice: 0,
      },
      { checkRequest: false },
    );
    const requestorderDatasetTooExpensive = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        appmaxprice: 0,
        datasetmaxprice: 4,
        workerpoolmaxprice: 0,
      },
      { checkRequest: false },
    );
    const requestorderWorkerpoolTooExpensive =
      await iexec.order.signRequestorder(
        {
          ...independentRequestorder,
          appmaxprice: 0,
          datasetmaxprice: 0,
          workerpoolmaxprice: 4,
        },
        { checkRequest: false },
      );
    const requestorderCumulativeTooExpensive =
      await iexec.order.signRequestorder(
        {
          ...independentRequestorder,
          appmaxprice: 2,
          datasetmaxprice: 2,
          workerpoolmaxprice: 2,
        },
        { checkRequest: false },
      );
    const [
      independentRequestHash,
      requestorderAppTooExpensiveHash,
      requestorderDatasetTooExpensiveHash,
      requestorderWorkerpoolTooExpensiveHash,
      requestorderCumulativeTooExpensiveHash,
    ] = await Promise.all([
      iexec.order.hashRequestorder(independentRequestorder),
      iexec.order.hashRequestorder(requestorderAppTooExpensive),
      iexec.order.hashRequestorder(requestorderDatasetTooExpensive),
      iexec.order.hashRequestorder(requestorderWorkerpoolTooExpensive),
      iexec.order.hashRequestorder(requestorderCumulativeTooExpensive),
    ]);
    await Promise.all([
      addRequestorders(chainId, [
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
          signer: address,
        },
        {
          orderHash: requestorderAppTooExpensiveHash,
          order: requestorderAppTooExpensive,
          signer: address,
        },
        {
          orderHash: requestorderDatasetTooExpensiveHash,
          order: requestorderDatasetTooExpensive,
          signer: address,
        },
        {
          orderHash: requestorderWorkerpoolTooExpensiveHash,
          order: requestorderWorkerpoolTooExpensive,
          signer: address,
        },
        {
          orderHash: requestorderCumulativeTooExpensiveHash,
          order: requestorderCumulativeTooExpensive,
          signer: address,
        },
      ]),
    ]);
    const { stake } = await iexec.account.checkBalance(address);
    await iexec.account.withdraw(stake.sub(new utils.BN(10)));
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedIndependentRequestorder],
      [savedRequestorderAppTooExpensive],
      [savedRequestorderDatasetTooExpensive],
      [savedRequestorderWorkerpoolTooExpensive],
      [savedRequestorderCumulativeTooExpensive],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderAppTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderDatasetTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderWorkerpoolTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderCumulativeTooExpensiveHash,
      }),
    ]);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderAppTooExpensive.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderDatasetTooExpensive.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderWorkerpoolTooExpensive.status).toBe(
      STATUS_MAP.DEAD,
    );
    expect(savedRequestorderCumulativeTooExpensive.status).toBe(
      STATUS_MAP.DEAD,
    );
    expect(socketEmitSpy).toHaveBeenCalledTimes(4);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) =>
          args[1] === 'requestorder_unpublished' &&
          args[2] === requestorderAppTooExpensiveHash,
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestorderAppTooExpensiveHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) =>
          args[1] === 'requestorder_unpublished' &&
          args[2] === requestorderDatasetTooExpensiveHash,
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestorderDatasetTooExpensiveHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) =>
          args[1] === 'requestorder_unpublished' &&
          args[2] === requestorderWorkerpoolTooExpensiveHash,
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestorderWorkerpoolTooExpensiveHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) =>
          args[1] === 'requestorder_unpublished' &&
          args[2] === requestorderCumulativeTooExpensiveHash,
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestorderCumulativeTooExpensiveHash,
      ],
    ]);
  });

  test('App Transfer (clean previous owner orders)', async () => {
    const owner = await iexec.wallet.getAddress();
    const order = await deployAndGetApporder(iexec);
    const orderHash = await iexec.order.hashApporder(order);
    await addApporders(chainId, [
      {
        orderHash,
        order,
        signer: owner,
      },
    ]);
    await transferResourceERC721(
      wallet,
      order.app,
      '0x000000000000000000000000000000000000dead',
    );
    const [savedOrder] = await find(chainId, APPORDERS_COLLECTION, {
      orderHash,
    });
    expect(savedOrder.status).toBe(STATUS_MAP.DEAD);
    expect(socketEmitSpy).toHaveBeenCalledTimes(1);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([[`${chainId}:orders`, 'apporder_unpublished', orderHash]]);
  });

  test('Dataset Transfer (clean previous owner orders)', async () => {
    const owner = await iexec.wallet.getAddress();
    const order = await deployAndGetDatasetorder(iexec);
    const orderHash = await iexec.order.hashDatasetorder(order);
    await addDatasetorders(chainId, [
      {
        orderHash,
        order,
        signer: owner,
      },
    ]);
    await transferResourceERC721(
      wallet,
      order.dataset,
      '0x000000000000000000000000000000000000dead',
    );
    const [savedOrder] = await find(chainId, DATASETORDERS_COLLECTION, {
      orderHash,
    });
    expect(savedOrder.status).toBe(STATUS_MAP.DEAD);
    expect(socketEmitSpy).toHaveBeenCalledTimes(1);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'datasetorder_unpublished', orderHash],
    ]);
  });

  test('Workerpool Transfer (clean previous owner orders)', async () => {
    const owner = await iexec.wallet.getAddress();
    const order = await deployAndGetWorkerpoolorder(iexec);
    const orderHash = await iexec.order.hashWorkerpoolorder(order);
    await addWorkerpoolorders(chainId, [
      {
        orderHash,
        order,
        signer: owner,
      },
    ]);
    await transferResourceERC721(
      wallet,
      order.workerpool,
      '0x000000000000000000000000000000000000dead',
    );
    const [savedOrder] = await find(chainId, WORKERPOOLORDERS_COLLECTION, {
      orderHash,
    });
    expect(savedOrder.status).toBe(STATUS_MAP.DEAD);
    expect(socketEmitSpy).toHaveBeenCalledTimes(1);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'workerpoolorder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'workerpoolorder_unpublished', orderHash],
    ]);
  });
});

describe('Recover on start', () => {
  beforeAll(async () => {
    await dropDB(chainId);
  });

  afterEach(async () => {
    await stop();
  });

  test('CreateCategory', async () => {
    const { catid, txHash } = await iexec.hub.createCategory({
      name: 'TEST',
      description: 'DESC',
      workClockTimeRef: '300',
    });
    const [notSaved] = await find(chainId, CATEGORIES_COLLECTION, {
      catid: catid.toNumber(),
    });
    expect(notSaved).toBeUndefined();
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [saved] = await find(chainId, CATEGORIES_COLLECTION, {
      catid: catid.toNumber(),
    });
    expect(saved.name).toBe('TEST');
    expect(saved.description).toBe('DESC');
    expect(saved.workClockTimeRef).toBe(300);
    expect(saved.transactionHash).toBe(txHash);
    expect(typeof saved.blockNumber).toBe('number');
    expect(saved.blockTimestamp).toMatch(timestampRegex);
    expect(saved.chainId).toBe(Number(chainId));
  });

  test('OrderMatched (save deal)', async () => {
    const address = await iexec.wallet.getAddress();
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const { dealid, txHash } = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    const [appHash, datasetHash, workerpoolHash, requestHash] =
      await Promise.all([
        iexec.order.hashApporder(apporder),
        iexec.order.hashDatasetorder(datasetorder),
        iexec.order.hashWorkerpoolorder(workerpoolorder),
        iexec.order.hashRequestorder(requestorder),
      ]);
    const [notSaved] = await find(chainId, DEALS_COLLECTION, {
      dealid,
    });
    expect(notSaved).toBeUndefined();
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [saved] = await find(chainId, DEALS_COLLECTION, { dealid });
    expect(saved.dealid).toBe(dealid);
    expect(saved.app.pointer).toBe(apporder.app);
    expect(saved.app.price).toBe(Number(apporder.appprice));
    expect(saved.app.owner).toBe(address);
    expect(saved.dataset.pointer).toBe(datasetorder.dataset);
    expect(saved.dataset.price).toBe(Number(datasetorder.datasetprice));
    expect(saved.dataset.owner).toBe(address);
    expect(saved.workerpool.pointer).toBe(workerpoolorder.workerpool);
    expect(saved.workerpool.price).toBe(
      Number(workerpoolorder.workerpoolprice),
    );
    expect(saved.workerpool.owner).toBe(address);
    expect(saved.appHash).toMatch(bytes32Regex);
    expect(saved.appHash).toBe(appHash);
    expect(saved.datasetHash).toMatch(bytes32Regex);
    expect(saved.datasetHash).toBe(datasetHash);
    expect(saved.workerpoolHash).toMatch(bytes32Regex);
    expect(saved.workerpoolHash).toBe(workerpoolHash);
    expect(saved.requestHash).toMatch(bytes32Regex);
    expect(saved.requestHash).toBe(requestHash);
    expect(saved.requester).toBe(requestorder.requester);
    expect(saved.beneficiary).toBe(requestorder.beneficiary);
    expect(saved.category).toBe(Number(requestorder.category));
    expect(saved.trust).toBe(Math.max(Number(requestorder.trust), 1));
    expect(saved.tag).toBe(requestorder.tag);
    expect(saved.volume).toBe(Number(requestorder.volume));
    expect(saved.callback).toBe(requestorder.callback);
    expect(saved.params).toBe(requestorder.params);
    expect(saved.botFirst).toBe(0);
    expect(saved.botSize).toBe(1);
    expect(saved.workerStake).toBe(0);
    expect(saved.schedulerRewardRatio).toBe(1);
    expect(saved.transactionHash).toBe(txHash);
    expect(typeof saved.blockNumber).toBe('number');
    expect(saved.blockTimestamp).toMatch(timestampRegex);
    expect(saved.chainId).toBe(Number(chainId));
  });

  test('OrderMatched (update orders all filled)', async () => {
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const [appHash, datasetHash, workerpoolHash, requestHash] =
      await Promise.all([
        iexec.order.hashApporder(apporder),
        iexec.order.hashDatasetorder(datasetorder),
        iexec.order.hashWorkerpoolorder(workerpoolorder),
        iexec.order.hashRequestorder(requestorder),
      ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.FILLED);
    expect(savedApporder.remaining).toBe(0);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedDatasetorder.remaining).toBe(0);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedWorkerpoolorder.remaining).toBe(0);
    expect(savedRequestorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedRequestorder.remaining).toBe(0);
  });

  test('OrderMatched (update orders partial fill)', async () => {
    const apporder = await deployAndGetApporder(iexec, { volume: 105 });
    const datasetorder = await deployAndGetDatasetorder(iexec, { volume: 205 });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      volume: 35,
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
      volume: 5,
    });
    const partiallyMatchableRequestorder = await getMatchableRequestorder(
      iexec,
      {
        apporder,
        datasetorder,
        workerpoolorder,
        volume: 40,
      },
    );
    const [
      appHash,
      datasetHash,
      workerpoolHash,
      requestHash,
      partiallyMatchableRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashWorkerpoolorder(workerpoolorder),
      iexec.order.hashRequestorder(requestorder),
      iexec.order.hashRequestorder(partiallyMatchableRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
        {
          orderHash: partiallyMatchableRequestHash,
          order: partiallyMatchableRequestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    await stop();
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(savedApporder.remaining).toBe(100);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorder.remaining).toBe(200);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorder.remaining).toBe(30);
    expect(savedRequestorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedRequestorder.remaining).toBe(0);
    await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder: partiallyMatchableRequestorder,
      },
      { checkRequest: false },
    );
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [savedPartiallyMatchedRequestorder] = await find(
      chainId,
      REQUESTORDERS_COLLECTION,
      {
        orderHash: partiallyMatchableRequestHash,
      },
    );
    expect(savedPartiallyMatchedRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedPartiallyMatchedRequestorder.remaining).toBe(10);
  });

  test('OrderMatched (clean app dependant requestOrders)', async () => {
    await iexec.account.deposit(100);
    const apporder = await deployAndGetApporder(iexec);
    const independentApporder = await deployAndGetApporder(iexec);
    const apporder5nRlc = await iexec.order.signApporder({
      ...apporder,
      appprice: 5,
    });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const requestorderApp = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const requestorderApp5nRlc = await getMatchableRequestorder(iexec, {
      apporder: apporder5nRlc,
      workerpoolorder,
    });
    const independentRequestorder = await getMatchableRequestorder(iexec, {
      apporder: independentApporder,
      workerpoolorder,
    });
    const [
      independentAppHash,
      appHash,
      app5nRlcHash,
      requestAppHash,
      requestApp5nRlcHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(independentApporder),
      iexec.order.hashApporder(apporder),
      iexec.order.hashApporder(apporder5nRlc),
      iexec.order.hashRequestorder(requestorderApp),
      iexec.order.hashRequestorder(requestorderApp5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: independentAppHash,
          order: independentApporder,
        },
        {
          orderHash: appHash,
          order: apporder,
        },
        {
          orderHash: app5nRlcHash,
          order: apporder5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestAppHash,
          order: requestorderApp,
        },
        {
          orderHash: requestApp5nRlcHash,
          order: requestorderApp5nRlc,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedRequestorderApp],
      [savedRequestorderApp5nRlc],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestApp5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedRequestorderApp.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderApp5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('OrderMatched (clean app dependant TEE requestOrders)', async () => {
    await iexec.account.deposit(100);
    const independentApporder = await deployAndGetApporder(iexec);
    const apporderTee = await iexec.order.signApporder({
      ...independentApporder,
      tag: ['tee'],
    });
    const apporderTee5nRlc = await iexec.order.signApporder({
      ...independentApporder,
      tag: ['tee'],
      appprice: 5,
    });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      tag: ['tee'],
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder: apporderTee,
      workerpoolorder,
    });
    const requestorderAppTee = await getMatchableRequestorder(iexec, {
      apporder: apporderTee,
      workerpoolorder,
    });
    const requestorderAppTee5nRlc = await getMatchableRequestorder(iexec, {
      apporder: apporderTee5nRlc,
      workerpoolorder,
    });
    const independentRequestorder = await getMatchableRequestorder(iexec, {
      apporder: independentApporder,
      workerpoolorder,
    });
    const [
      independentAppHash,
      appTeeHash,
      appTee5nRlcHash,
      requestAppTeeHash,
      requestAppTee5nRlcHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(independentApporder),
      iexec.order.hashApporder(apporderTee),
      iexec.order.hashApporder(apporderTee5nRlc),
      iexec.order.hashRequestorder(requestorderAppTee),
      iexec.order.hashRequestorder(requestorderAppTee5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: independentAppHash,
          order: independentApporder,
        },
        {
          orderHash: appTeeHash,
          order: apporderTee,
        },
        {
          orderHash: appTee5nRlcHash,
          order: apporderTee5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestAppTeeHash,
          order: requestorderAppTee,
        },
        {
          orderHash: requestAppTee5nRlcHash,
          order: requestorderAppTee5nRlc,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder: apporderTee,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedRequestorderAppTee],
      [savedRequestorderAppTee5nRlc],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppTeeHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppTee5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedRequestorderAppTee.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderAppTee5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('OrderMatched (clean dataset dependant requestOrders)', async () => {
    const apporder = await deployAndGetApporder(iexec, { volume: 2 });
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const datasetorder5nRlc = await iexec.order.signDatasetorder({
      ...datasetorder,
      datasetprice: 5,
    });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const requestorderDataset = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const requestorderDataset5nRlc = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder: datasetorder5nRlc,
      workerpoolorder,
    });
    const independentRequestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const [
      appHash,
      datasetHash,
      dataset5nRlcHash,
      requestDatasetHash,
      requestDataset5nRlcHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashDatasetorder(datasetorder5nRlc),
      iexec.order.hashRequestorder(requestorderDataset),
      iexec.order.hashRequestorder(requestorderDataset5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
        {
          orderHash: dataset5nRlcHash,
          order: datasetorder5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestDatasetHash,
          order: requestorderDataset,
        },
        {
          orderHash: requestDataset5nRlcHash,
          order: requestorderDataset5nRlc,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedRequestorderDataset],
      [savedRequestorderDataset5nRlc],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDatasetHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDataset5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedRequestorderDataset.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderDataset5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('ClosedAppOrder (cancel order)', async () => {
    const apporder = await deployAndGetApporder(iexec);
    const [appHash] = await Promise.all([iexec.order.hashApporder(apporder)]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
    ]);
    await iexec.order.cancelApporder(apporder);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [[savedApporder]] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedApporder.remaining).toBe(0);
  });

  test('ClosedAppOrder (clean dependant requestorder)', async () => {
    await iexec.account.deposit(100);
    const apporder = await deployAndGetApporder(iexec, { appprice: 0 });
    const apporder5nRlc = await iexec.order.signApporder({
      ...apporder,
      appprice: 5,
    });
    const datasetorder = await deployAndGetDatasetorder(iexec, {
      apprestrict: apporder.app,
    });
    const requestorder = await iexec.order
      .createRequestorder({
        app: apporder.app,
        appmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: await iexec.wallet.getAddress(),
        category: 0,
        volume: 10,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const independentRequestorder = await iexec.order.signRequestorder(
      {
        ...requestorder,
        appmaxprice: 5,
      },
      { checkRequest: false },
    );
    const [
      appHash,
      app5nRlcHash,
      datasetHash,
      requestHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashApporder(apporder5nRlc),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashRequestorder(requestorder),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
        {
          orderHash: app5nRlcHash,
          order: apporder5nRlc,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.cancelApporder(apporder);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedRequestorder],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [updatedApporder],
      [updatedDatasetorder],
      [updatedRequestorder],
      [updatedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(updatedApporder.status).toBe(STATUS_MAP.CANCELED);
    expect(updatedApporder.remaining).toBe(0);
    expect(updatedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedRequestorder.status).toBe(STATUS_MAP.DEAD);
    expect(updatedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('ClosedAppOrder (clean dependant TEE requestorder)', async () => {
    const apporder = await deployAndGetApporder(iexec);
    const apporderTee = await iexec.order.signApporder({
      ...apporder,
      tag: ['tee'],
    });
    const apporderTee5nRlc = await iexec.order.signApporder({
      ...apporder,
      tag: ['tee'],
      appprice: 5,
    });
    const independentRequestorder = await iexec.order
      .createRequestorder({
        app: apporder.app,
        appmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: await iexec.wallet.getAddress(),
        category: 0,
        volume: 10,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const requestorderTee = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        tag: ['tee'],
      },
      { checkRequest: false },
    );
    const requestorderTee5nRlc = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        tag: ['tee'],
        appmaxprice: 5,
      },
      { checkRequest: false },
    );
    const [
      appHash,
      appTeeHash,
      appTee5nRlcHash,
      requestTeeHash,
      requestTee5nRlcHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashApporder(apporderTee),
      iexec.order.hashApporder(apporderTee5nRlc),
      iexec.order.hashRequestorder(requestorderTee),
      iexec.order.hashRequestorder(requestorderTee5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
        {
          orderHash: appTeeHash,
          order: apporderTee,
        },
        {
          orderHash: appTee5nRlcHash,
          order: apporderTee5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestTeeHash,
          order: requestorderTee,
        },
        {
          orderHash: requestTee5nRlcHash,
          order: requestorderTee5nRlc,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.cancelApporder(apporderTee);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporderTee],
      [savedRequestorderTee],
      [savedRequestorderTee5nRlc],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appTeeHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestTeeHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestTee5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedApporderTee.status).toBe(STATUS_MAP.CANCELED);
    expect(savedApporderTee.remaining).toBe(0);
    expect(savedRequestorderTee.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderTee5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('ClosedDatasetOrder (cancel order)', async () => {
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const [datasetHash] = await Promise.all([
      iexec.order.hashDatasetorder(datasetorder),
    ]);
    await Promise.all([
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
      ]),
    ]);
    await iexec.order.cancelDatasetorder(datasetorder);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [[savedDatasetorder]] = await Promise.all([
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
    ]);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedDatasetorder.remaining).toBe(0);
  });

  test('ClosedDatasetOrder (clean dependant requestorder)', async () => {
    await iexec.account.deposit(100);
    const datasetorder = await deployAndGetDatasetorder(iexec, {
      datasetprice: 0,
    });
    const datasetorder5nRlc = await iexec.order.signDatasetorder({
      ...datasetorder,
      datasetprice: 5,
    });
    const apporder = await deployAndGetApporder(iexec, {
      datasetrestrict: datasetorder.dataset,
    });
    const requestorder = await iexec.order
      .createRequestorder({
        app: apporder.app,
        appmaxprice: 0,
        dataset: datasetorder.dataset,
        datasetmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: await iexec.wallet.getAddress(),
        category: 0,
        volume: 10,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const independentRequestorder = await iexec.order.signRequestorder(
      {
        ...requestorder,
        datasetmaxprice: 5,
      },
      { checkRequest: false },
    );
    const [
      appHash,
      datasetHash,
      dataset5nRlcHash,
      requestHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashDatasetorder(datasetorder5nRlc),
      iexec.order.hashRequestorder(requestorder),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
        {
          orderHash: dataset5nRlcHash,
          order: datasetorder5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.cancelDatasetorder(datasetorder);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedDatasetorder5nRlc],
      [savedRequestorder],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: dataset5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorder5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [updatedApporder],
      [updatedDatasetorder],
      [updatedDatasetorder5nRlc],
      [updatedRequestorder],
      [updatedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: dataset5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(updatedDatasetorder.status).toBe(STATUS_MAP.CANCELED);
    expect(updatedDatasetorder.remaining).toBe(0);
    expect(updatedDatasetorder5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(updatedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedRequestorder.status).toBe(STATUS_MAP.DEAD);
    expect(updatedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('ClosedWorkerpoolOrder (cancel order)', async () => {
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const [workerpoolHash] = await Promise.all([
      iexec.order.hashWorkerpoolorder(workerpoolorder),
    ]);
    await Promise.all([
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
        },
      ]),
    ]);
    await iexec.order.cancelWorkerpoolorder(workerpoolorder);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [[savedWorkerpoolorder]] = await Promise.all([
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolHash,
      }),
    ]);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedWorkerpoolorder.remaining).toBe(0);
  });

  test('ClosedRequestOrder (cancel order)', async () => {
    const requestorder = await iexec.order
      .createRequestorder({
        app: utils.NULL_ADDRESS,
        category: 0,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));

    const [requestHash] = await Promise.all([
      iexec.order.hashRequestorder(requestorder),
    ]);
    await Promise.all([
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
      ]),
    ]);
    await iexec.order.cancelRequestorder(requestorder);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [[savedRequestorder]] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
    ]);
    expect(savedRequestorder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedRequestorder.remaining).toBe(0);
  });

  test('Transfer StakedRlc (clean dependant workerpoolorder)', async () => {
    await iexec.account.deposit(100);
    const address = await iexec.wallet.getAddress();
    const independentWorkerpoolorder = await deployAndGetWorkerpoolorder(
      iexec,
      {
        workerpoolprice: 0,
        volume: 30,
      },
    );
    const finallyGoodWorkerpoolorder = await iexec.order.signWorkerpoolorder({
      ...independentWorkerpoolorder,
      workerpoolprice: 100,
      volume: 1,
    });
    const workerpoolorderTooExpensive = await iexec.order.signWorkerpoolorder({
      ...independentWorkerpoolorder,
      workerpoolprice: 104,
      volume: 1,
    });
    const workerpoolorderCumulativeTooExpensive =
      await iexec.order.signWorkerpoolorder({
        ...independentWorkerpoolorder,
        workerpoolprice: 37,
        volume: 3,
      });
    const [
      independentWorkerpoolHash,
      finallyGoodWorkerpoolHash,
      workerpoolorderTooExpensiveHash,
      workerpoolorderCumulativeTooExpensiveHash,
    ] = await Promise.all([
      iexec.order.hashWorkerpoolorder(independentWorkerpoolorder),
      iexec.order.hashWorkerpoolorder(finallyGoodWorkerpoolorder),
      iexec.order.hashWorkerpoolorder(workerpoolorderTooExpensive),
      iexec.order.hashWorkerpoolorder(workerpoolorderCumulativeTooExpensive),
    ]);
    await Promise.all([
      addWorkerpoolorders(chainId, [
        {
          orderHash: independentWorkerpoolHash,
          order: independentWorkerpoolorder,
          signer: address,
        },
        {
          orderHash: finallyGoodWorkerpoolHash,
          order: finallyGoodWorkerpoolorder,
          signer: address,
        },
        {
          orderHash: workerpoolorderTooExpensiveHash,
          order: workerpoolorderTooExpensive,
          signer: address,
        },
        {
          orderHash: workerpoolorderCumulativeTooExpensiveHash,
          order: workerpoolorderCumulativeTooExpensive,
          signer: address,
        },
      ]),
    ]);
    const { stake } = await iexec.account.checkBalance(address);
    await iexec.account.withdraw(stake);
    await iexec.account.deposit(30);
    const [
      [savedIndependentWorkerpoolorder],
      [savedFinallyGoodWorkerpoolorder],
      [savedWorkerpoolorderTooExpensive],
      [savedWorkerpoolorderCumulativeTooExpensive],
    ] = await Promise.all([
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: independentWorkerpoolHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: finallyGoodWorkerpoolHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolorderTooExpensiveHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolorderCumulativeTooExpensiveHash,
      }),
    ]);
    expect(savedIndependentWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedFinallyGoodWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderTooExpensive.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderCumulativeTooExpensive.status).toBe(
      STATUS_MAP.OPEN,
    );
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [updatedIndependentWorkerpoolorder],
      [updatedFinallyGoodWorkerpoolorder],
      [updatedWorkerpoolorderTooExpensive],
      [updatedWorkerpoolorderCumulativeTooExpensive],
    ] = await Promise.all([
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: independentWorkerpoolHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: finallyGoodWorkerpoolHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolorderTooExpensiveHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolorderCumulativeTooExpensiveHash,
      }),
    ]);
    expect(updatedIndependentWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedFinallyGoodWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedWorkerpoolorderTooExpensive.status).toBe(STATUS_MAP.DEAD);
    expect(updatedWorkerpoolorderCumulativeTooExpensive.status).toBe(
      STATUS_MAP.DEAD,
    );
  });

  test('Transfer StakedRlc (clean dependant requestorder)', async () => {
    await iexec.account.deposit(100);
    const address = await iexec.wallet.getAddress();
    const independentRequestorder = await iexec.order
      .createRequestorder({
        app: utils.NULL_ADDRESS,
        appmaxprice: 0,
        datasetmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: address,
        category: 0,
        volume: 3,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const finallyGoodRequestorder = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        appmaxprice: 1,
        datasetmaxprice: 1,
        workerpoolmaxprice: 1,
      },
      { checkRequest: false },
    );
    const requestorderAppTooExpensive = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        appmaxprice: 4,
        datasetmaxprice: 0,
        workerpoolmaxprice: 0,
      },
      { checkRequest: false },
    );
    const requestorderDatasetTooExpensive = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        appmaxprice: 0,
        datasetmaxprice: 4,
        workerpoolmaxprice: 0,
      },
      { checkRequest: false },
    );
    const requestorderWorkerpoolTooExpensive =
      await iexec.order.signRequestorder(
        {
          ...independentRequestorder,
          appmaxprice: 0,
          datasetmaxprice: 0,
          workerpoolmaxprice: 4,
        },
        { checkRequest: false },
      );
    const requestorderCumulativeTooExpensive =
      await iexec.order.signRequestorder(
        {
          ...independentRequestorder,
          appmaxprice: 2,
          datasetmaxprice: 2,
          workerpoolmaxprice: 2,
        },
        { checkRequest: false },
      );
    const [
      independentRequestHash,
      finallyGoodRequestHash,
      requestorderAppTooExpensiveHash,
      requestorderDatasetTooExpensiveHash,
      requestorderWorkerpoolTooExpensiveHash,
      requestorderCumulativeTooExpensiveHash,
    ] = await Promise.all([
      iexec.order.hashRequestorder(independentRequestorder),
      iexec.order.hashRequestorder(finallyGoodRequestorder),
      iexec.order.hashRequestorder(requestorderAppTooExpensive),
      iexec.order.hashRequestorder(requestorderDatasetTooExpensive),
      iexec.order.hashRequestorder(requestorderWorkerpoolTooExpensive),
      iexec.order.hashRequestorder(requestorderCumulativeTooExpensive),
    ]);
    await Promise.all([
      addRequestorders(chainId, [
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
          signer: address,
        },
        {
          orderHash: finallyGoodRequestHash,
          order: finallyGoodRequestorder,
          signer: address,
        },
        {
          orderHash: requestorderAppTooExpensiveHash,
          order: requestorderAppTooExpensive,
          signer: address,
        },
        {
          orderHash: requestorderDatasetTooExpensiveHash,
          order: requestorderDatasetTooExpensive,
          signer: address,
        },
        {
          orderHash: requestorderWorkerpoolTooExpensiveHash,
          order: requestorderWorkerpoolTooExpensive,
          signer: address,
        },
        {
          orderHash: requestorderCumulativeTooExpensiveHash,
          order: requestorderCumulativeTooExpensive,
          signer: address,
        },
      ]),
    ]);
    const { stake } = await iexec.account.checkBalance(address);
    await iexec.account.withdraw(stake);
    await iexec.account.deposit(10);
    const [
      [savedIndependentRequestorder],
      [savedFinallyGoodRequestorder],
      [savedRequestorderAppTooExpensive],
      [savedRequestorderDatasetTooExpensive],
      [savedRequestorderWorkerpoolTooExpensive],
      [savedRequestorderCumulativeTooExpensive],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: finallyGoodRequestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderAppTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderDatasetTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderWorkerpoolTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderCumulativeTooExpensiveHash,
      }),
    ]);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedFinallyGoodRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderAppTooExpensive.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderDatasetTooExpensive.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderWorkerpoolTooExpensive.status).toBe(
      STATUS_MAP.OPEN,
    );
    expect(savedRequestorderCumulativeTooExpensive.status).toBe(
      STATUS_MAP.OPEN,
    );
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [updatedIndependentRequestorder],
      [updatedFinallyGoodRequestorder],
      [updatedRequestorderAppTooExpensive],
      [updatedRequestorderDatasetTooExpensive],
      [updatedRequestorderWorkerpoolTooExpensive],
      [updatedRequestorderCumulativeTooExpensive],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: finallyGoodRequestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderAppTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderDatasetTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderWorkerpoolTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderCumulativeTooExpensiveHash,
      }),
    ]);
    expect(updatedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedFinallyGoodRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedRequestorderAppTooExpensive.status).toBe(STATUS_MAP.DEAD);
    expect(updatedRequestorderDatasetTooExpensive.status).toBe(STATUS_MAP.DEAD);
    expect(updatedRequestorderWorkerpoolTooExpensive.status).toBe(
      STATUS_MAP.DEAD,
    );
    expect(updatedRequestorderCumulativeTooExpensive.status).toBe(
      STATUS_MAP.DEAD,
    );
  });

  test('App Transfer (clean previous owner orders)', async () => {
    const owner = await iexec.wallet.getAddress();
    const order = await deployAndGetApporder(iexec);
    const orderHash = await iexec.order.hashApporder(order);
    await addApporders(chainId, [
      {
        orderHash,
        order,
        signer: owner,
      },
    ]);
    await transferResourceERC721(
      wallet,
      order.app,
      '0x000000000000000000000000000000000000dead',
    );
    await start({ syncWatcher: false, replayer: false });
    const [savedOrder] = await find(chainId, APPORDERS_COLLECTION, {
      orderHash,
    });
    expect(savedOrder.status).toBe(STATUS_MAP.DEAD);
  });

  test('Dataset Transfer (clean previous owner orders)', async () => {
    const owner = await iexec.wallet.getAddress();
    const order = await deployAndGetDatasetorder(iexec);
    const orderHash = await iexec.order.hashDatasetorder(order);
    await addDatasetorders(chainId, [
      {
        orderHash,
        order,
        signer: owner,
      },
    ]);
    await transferResourceERC721(
      wallet,
      order.dataset,
      '0x000000000000000000000000000000000000dead',
    );
    await start({ syncWatcher: false, replayer: false });
    const [savedOrder] = await find(chainId, DATASETORDERS_COLLECTION, {
      orderHash,
    });
    expect(savedOrder.status).toBe(STATUS_MAP.DEAD);
  });

  test('Workerpool Transfer (clean previous owner orders)', async () => {
    const owner = await iexec.wallet.getAddress();
    const order = await deployAndGetWorkerpoolorder(iexec);
    const orderHash = await iexec.order.hashWorkerpoolorder(order);
    await addWorkerpoolorders(chainId, [
      {
        orderHash,
        order,
        signer: owner,
      },
    ]);
    await transferResourceERC721(
      wallet,
      order.workerpool,
      '0x000000000000000000000000000000000000dead',
    );
    await start({ syncWatcher: false, replayer: false });
    const [savedOrder] = await find(chainId, WORKERPOOLORDERS_COLLECTION, {
      orderHash,
    });
    expect(savedOrder.status).toBe(STATUS_MAP.DEAD);
  });
});

describe('Replay Past', () => {
  beforeAll(async () => {
    await dropDB(chainId);
    await ethereumInit();
  });

  beforeEach(async () => {
    await fastForwardToLastBlock(chainId, rpc);
  });

  test('checkpoints', async () => {
    await replayPastOnly();
    const [initialCheckPoint] = await find(chainId, 'counters', {
      name: 'checkpointBlock',
    });
    await replayPastOnly({ nbConfirmation: 5 });
    const [intermediaryCheckPoint] = await find(chainId, 'counters', {
      name: 'checkpointBlock',
    });
    await replayPastOnly({ nbConfirmation: 0 });
    const [finalCheckPoint] = await find(chainId, 'counters', {
      name: 'checkpointBlock',
    });
    expect(initialCheckPoint.value).toBeDefined();
    expect(typeof initialCheckPoint.value).toBe('number');
    expect(intermediaryCheckPoint.value).toBeDefined();
    expect(typeof intermediaryCheckPoint.value).toBe('number');
    expect(finalCheckPoint.value).toBeDefined();
    expect(typeof finalCheckPoint.value).toBe('number');
    expect(intermediaryCheckPoint.value - initialCheckPoint.value).toBe(5);
    expect(finalCheckPoint.value - initialCheckPoint.value).toBe(10);
  });

  test('nbConfirmation', async () => {
    await dropDB(chainId);
    await fastForwardToLastBlock(chainId, rpc);
    const { catid } = await iexec.hub.createCategory({
      name: 'TEST',
      description: 'DESC',
      workClockTimeRef: '300',
    });
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 1 });
    const [notSaved] = await find(chainId, CATEGORIES_COLLECTION, {
      catid: catid.toNumber(),
    });
    await replayPastOnly({ nbConfirmation: 0 });
    const [saved] = await find(chainId, CATEGORIES_COLLECTION, {
      catid: catid.toNumber(),
    });
    expect(notSaved).toBeUndefined();
    expect(saved).toBeDefined();
  });

  test('CreateCategory', async () => {
    const { catid, txHash } = await iexec.hub.createCategory({
      name: 'TEST',
      description: 'DESC',
      workClockTimeRef: '300',
    });
    const [notSaved] = await find(chainId, CATEGORIES_COLLECTION, {
      catid: catid.toNumber(),
    });
    expect(notSaved).toBeUndefined();
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [saved] = await find(chainId, CATEGORIES_COLLECTION, {
      catid: catid.toNumber(),
    });
    expect(saved.name).toBe('TEST');
    expect(saved.description).toBe('DESC');
    expect(saved.workClockTimeRef).toBe(300);
    expect(saved.transactionHash).toBe(txHash);
    expect(typeof saved.blockNumber).toBe('number');
    expect(saved.blockTimestamp).toMatch(timestampRegex);
    expect(saved.chainId).toBe(Number(chainId));
    const [finalCheckPoint] = await find(chainId, 'counters', {
      name: 'checkpointBlock',
    });
    expect(finalCheckPoint.value).toBe(saved.blockNumber);
  });

  test('OrderMatched (save deal)', async () => {
    const address = await iexec.wallet.getAddress();
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const { dealid, txHash } = await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await fastForwardToLastBlock(chainId, rpc);
    const [appHash, datasetHash, workerpoolHash, requestHash] =
      await Promise.all([
        iexec.order.hashApporder(apporder),
        iexec.order.hashDatasetorder(datasetorder),
        iexec.order.hashWorkerpoolorder(workerpoolorder),
        iexec.order.hashRequestorder(requestorder),
      ]);
    const [notSaved] = await find(chainId, DEALS_COLLECTION, {
      dealid,
    });
    expect(notSaved).toBeUndefined();
    await replayPastOnly({ nbConfirmation: 0 });
    const [saved] = await find(chainId, DEALS_COLLECTION, { dealid });
    expect(saved.dealid).toBe(dealid);
    expect(saved.app.pointer).toBe(apporder.app);
    expect(saved.app.price).toBe(Number(apporder.appprice));
    expect(saved.app.owner).toBe(address);
    expect(saved.dataset.pointer).toBe(datasetorder.dataset);
    expect(saved.dataset.price).toBe(Number(datasetorder.datasetprice));
    expect(saved.dataset.owner).toBe(address);
    expect(saved.workerpool.pointer).toBe(workerpoolorder.workerpool);
    expect(saved.workerpool.price).toBe(
      Number(workerpoolorder.workerpoolprice),
    );
    expect(saved.workerpool.owner).toBe(address);
    expect(saved.appHash).toMatch(bytes32Regex);
    expect(saved.appHash).toBe(appHash);
    expect(saved.datasetHash).toMatch(bytes32Regex);
    expect(saved.datasetHash).toBe(datasetHash);
    expect(saved.workerpoolHash).toMatch(bytes32Regex);
    expect(saved.workerpoolHash).toBe(workerpoolHash);
    expect(saved.requestHash).toMatch(bytes32Regex);
    expect(saved.requestHash).toBe(requestHash);
    expect(saved.requester).toBe(requestorder.requester);
    expect(saved.beneficiary).toBe(requestorder.beneficiary);
    expect(saved.category).toBe(Number(requestorder.category));
    expect(saved.trust).toBe(Math.max(Number(requestorder.trust), 1));
    expect(saved.tag).toBe(requestorder.tag);
    expect(saved.volume).toBe(Number(requestorder.volume));
    expect(saved.callback).toBe(requestorder.callback);
    expect(saved.params).toBe(requestorder.params);
    expect(saved.botFirst).toBe(0);
    expect(saved.botSize).toBe(1);
    expect(saved.workerStake).toBe(0);
    expect(saved.schedulerRewardRatio).toBe(1);
    expect(saved.transactionHash).toBe(txHash);
    expect(typeof saved.blockNumber).toBe('number');
    expect(saved.blockTimestamp).toMatch(timestampRegex);
    expect(saved.chainId).toBe(Number(chainId));
    const [finalCheckPoint] = await find(chainId, 'counters', {
      name: 'checkpointBlock',
    });
    expect(finalCheckPoint.value).toBe(saved.blockNumber);
  });

  test('OrderMatched (update orders all filled)', async () => {
    const apporder = await deployAndGetApporder(iexec);
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const [appHash, datasetHash, workerpoolHash, requestHash] =
      await Promise.all([
        iexec.order.hashApporder(apporder),
        iexec.order.hashDatasetorder(datasetorder),
        iexec.order.hashWorkerpoolorder(workerpoolorder),
        iexec.order.hashRequestorder(requestorder),
      ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.FILLED);
    expect(savedApporder.remaining).toBe(0);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedDatasetorder.remaining).toBe(0);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedWorkerpoolorder.remaining).toBe(0);
    expect(savedRequestorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedRequestorder.remaining).toBe(0);
  });

  test('OrderMatched (update orders partial fill)', async () => {
    const apporder = await deployAndGetApporder(iexec, { volume: 105 });
    const datasetorder = await deployAndGetDatasetorder(iexec, { volume: 205 });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      volume: 35,
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
      volume: 5,
    });
    const partiallyMatchableRequestorder = await getMatchableRequestorder(
      iexec,
      {
        apporder,
        datasetorder,
        workerpoolorder,
        volume: 40,
      },
    );
    const [
      appHash,
      datasetHash,
      workerpoolHash,
      requestHash,
      partiallyMatchableRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashWorkerpoolorder(workerpoolorder),
      iexec.order.hashRequestorder(requestorder),
      iexec.order.hashRequestorder(partiallyMatchableRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: partiallyMatchableRequestHash,
          order: partiallyMatchableRequestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(savedApporder.remaining).toBe(100);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorder.remaining).toBe(200);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorder.remaining).toBe(30);
    expect(savedRequestorder.status).toBe(STATUS_MAP.FILLED);
    expect(savedRequestorder.remaining).toBe(0);
    await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder: partiallyMatchableRequestorder,
      },
      { checkRequest: false },
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [savedPartiallyMatchedRequestorder] = await find(
      chainId,
      REQUESTORDERS_COLLECTION,
      {
        orderHash: partiallyMatchableRequestHash,
      },
    );
    expect(savedPartiallyMatchedRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedPartiallyMatchedRequestorder.remaining).toBe(10);
  });

  test('OrderMatched (clean app dependant requestOrders)', async () => {
    await iexec.account.deposit(100);
    const apporder = await deployAndGetApporder(iexec);
    const independentApporder = await deployAndGetApporder(iexec);
    const apporder5nRlc = await iexec.order.signApporder({
      ...apporder,
      appprice: 5,
    });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const requestorderApp = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const requestorderApp5nRlc = await getMatchableRequestorder(iexec, {
      apporder: apporder5nRlc,
      workerpoolorder,
    });
    const independentRequestorder = await getMatchableRequestorder(iexec, {
      apporder: independentApporder,
      workerpoolorder,
    });
    const [
      independentAppHash,
      appHash,
      app5nRlcHash,
      requestAppHash,
      requestApp5nRlcHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(independentApporder),
      iexec.order.hashApporder(apporder),
      iexec.order.hashApporder(apporder5nRlc),
      iexec.order.hashRequestorder(requestorderApp),
      iexec.order.hashRequestorder(requestorderApp5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: independentAppHash,
          order: independentApporder,
        },
        {
          orderHash: appHash,
          order: apporder,
        },
        {
          orderHash: app5nRlcHash,
          order: apporder5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestAppHash,
          order: requestorderApp,
        },
        {
          orderHash: requestApp5nRlcHash,
          order: requestorderApp5nRlc,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedRequestorderApp],
      [savedRequestorderApp5nRlc],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestApp5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedRequestorderApp.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderApp5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('OrderMatched (clean app dependant TEE requestOrders)', async () => {
    await iexec.account.deposit(100);
    const independentApporder = await deployAndGetApporder(iexec);
    const apporderTee = await iexec.order.signApporder({
      ...independentApporder,
      tag: ['tee'],
    });
    const apporderTee5nRlc = await iexec.order.signApporder({
      ...independentApporder,
      tag: ['tee'],
      appprice: 5,
    });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec, {
      tag: ['tee'],
    });
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder: apporderTee,
      workerpoolorder,
    });
    const requestorderAppTee = await getMatchableRequestorder(iexec, {
      apporder: apporderTee,
      workerpoolorder,
    });
    const requestorderAppTee5nRlc = await getMatchableRequestorder(iexec, {
      apporder: apporderTee5nRlc,
      workerpoolorder,
    });
    const independentRequestorder = await getMatchableRequestorder(iexec, {
      apporder: independentApporder,
      workerpoolorder,
    });
    const [
      independentAppHash,
      appTeeHash,
      appTee5nRlcHash,
      requestAppTeeHash,
      requestAppTee5nRlcHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(independentApporder),
      iexec.order.hashApporder(apporderTee),
      iexec.order.hashApporder(apporderTee5nRlc),
      iexec.order.hashRequestorder(requestorderAppTee),
      iexec.order.hashRequestorder(requestorderAppTee5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: independentAppHash,
          order: independentApporder,
        },
        {
          orderHash: appTeeHash,
          order: apporderTee,
        },
        {
          orderHash: appTee5nRlcHash,
          order: apporderTee5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestAppTeeHash,
          order: requestorderAppTee,
        },
        {
          orderHash: requestAppTee5nRlcHash,
          order: requestorderAppTee5nRlc,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder: apporderTee,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedRequestorderAppTee],
      [savedRequestorderAppTee5nRlc],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppTeeHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppTee5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedRequestorderAppTee.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderAppTee5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('OrderMatched (clean dataset dependant requestOrders)', async () => {
    const apporder = await deployAndGetApporder(iexec, { volume: 2 });
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const datasetorder5nRlc = await iexec.order.signDatasetorder({
      ...datasetorder,
      datasetprice: 5,
    });
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const requestorder = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const requestorderDataset = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const requestorderDataset5nRlc = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder: datasetorder5nRlc,
      workerpoolorder,
    });
    const independentRequestorder = await getMatchableRequestorder(iexec, {
      apporder,
      workerpoolorder,
    });
    const [
      appHash,
      datasetHash,
      dataset5nRlcHash,
      requestDatasetHash,
      requestDataset5nRlcHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashDatasetorder(datasetorder5nRlc),
      iexec.order.hashRequestorder(requestorderDataset),
      iexec.order.hashRequestorder(requestorderDataset5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
        {
          orderHash: dataset5nRlcHash,
          order: datasetorder5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestDatasetHash,
          order: requestorderDataset,
        },
        {
          orderHash: requestDataset5nRlcHash,
          order: requestorderDataset5nRlc,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.matchOrders(
      {
        apporder,
        datasetorder,
        workerpoolorder,
        requestorder,
      },
      { checkRequest: false },
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedRequestorderDataset],
      [savedRequestorderDataset5nRlc],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDatasetHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDataset5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedRequestorderDataset.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderDataset5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('ClosedAppOrder (cancel order)', async () => {
    const apporder = await deployAndGetApporder(iexec);
    const [appHash] = await Promise.all([iexec.order.hashApporder(apporder)]);
    await addApporders(chainId, [
      {
        orderHash: appHash,
        order: apporder,
      },
    ]);
    await iexec.order.cancelApporder(apporder);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [[savedApporder]] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedApporder.remaining).toBe(0);
  });

  test('ClosedAppOrder (clean dependant requestorder)', async () => {
    await iexec.account.deposit(100);
    const apporder = await deployAndGetApporder(iexec, { appprice: 0 });
    const apporder5nRlc = await iexec.order.signApporder({
      ...apporder,
      appprice: 5,
    });
    const datasetorder = await deployAndGetDatasetorder(iexec, {
      apprestrict: apporder.app,
    });
    const requestorder = await iexec.order
      .createRequestorder({
        app: apporder.app,
        appmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: await iexec.wallet.getAddress(),
        category: 0,
        volume: 10,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const independentRequestorder = await iexec.order.signRequestorder(
      {
        ...requestorder,
        appmaxprice: 5,
      },
      { checkRequest: false },
    );
    const [
      appHash,
      app5nRlcHash,
      datasetHash,
      requestHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashApporder(apporder5nRlc),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashRequestorder(requestorder),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
        {
          orderHash: app5nRlcHash,
          order: apporder5nRlc,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.cancelApporder(apporder);
    await fastForwardToLastBlock(chainId, rpc);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedRequestorder],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [updatedApporder],
      [updatedDatasetorder],
      [updatedRequestorder],
      [updatedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(updatedApporder.status).toBe(STATUS_MAP.CANCELED);
    expect(updatedApporder.remaining).toBe(0);
    expect(updatedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedRequestorder.status).toBe(STATUS_MAP.DEAD);
    expect(updatedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('ClosedAppOrder (clean dependant TEE requestorder)', async () => {
    await iexec.account.deposit(100);
    const apporder = await deployAndGetApporder(iexec);
    const apporderTee = await iexec.order.signApporder({
      ...apporder,
      tag: ['tee'],
    });
    const apporderTee5nRlc = await iexec.order.signApporder({
      ...apporder,
      tag: ['tee'],
      appprice: 5,
    });
    const independentRequestorder = await iexec.order
      .createRequestorder({
        app: apporder.app,
        appmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: await iexec.wallet.getAddress(),
        category: 0,
        volume: 10,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const requestorderTee = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        tag: ['tee'],
      },
      { checkRequest: false },
    );
    const requestorderTee5nRlc = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        tag: ['tee'],
        appmaxprice: 5,
      },
      { checkRequest: false },
    );
    const [
      appHash,
      appTeeHash,
      appTee5nRlcHash,
      requestTeeHash,
      requestTee5nRlcHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashApporder(apporderTee),
      iexec.order.hashApporder(apporderTee5nRlc),
      iexec.order.hashRequestorder(requestorderTee),
      iexec.order.hashRequestorder(requestorderTee5nRlc),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
        {
          orderHash: appTeeHash,
          order: apporderTee,
        },
        {
          orderHash: appTee5nRlcHash,
          order: apporderTee5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestTeeHash,
          order: requestorderTee,
        },
        {
          orderHash: requestTee5nRlcHash,
          order: requestorderTee5nRlc,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.cancelApporder(apporderTee);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporderTee],
      [savedRequestorderTee],
      [savedRequestorderTee5nRlc],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appTeeHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestTeeHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestTee5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedApporderTee.status).toBe(STATUS_MAP.CANCELED);
    expect(savedApporderTee.remaining).toBe(0);
    expect(savedRequestorderTee.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderTee5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('ClosedDatasetOrder (cancel order)', async () => {
    const datasetorder = await deployAndGetDatasetorder(iexec);
    const [datasetHash] = await Promise.all([
      iexec.order.hashDatasetorder(datasetorder),
    ]);
    await addDatasetorders(chainId, [
      {
        orderHash: datasetHash,
        order: datasetorder,
      },
    ]);
    await iexec.order.cancelDatasetorder(datasetorder);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [[savedDatasetorder]] = await Promise.all([
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
    ]);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedDatasetorder.remaining).toBe(0);
  });

  test('ClosedDatasetOrder (clean dependant requestorder)', async () => {
    await iexec.account.deposit(100);
    const datasetorder = await deployAndGetDatasetorder(iexec, {
      datasetprice: 0,
    });
    const datasetorder5nRlc = await iexec.order.signDatasetorder({
      ...datasetorder,
      datasetprice: 5,
    });
    const apporder = await deployAndGetApporder(iexec, {
      datasetrestrict: datasetorder.dataset,
    });
    const requestorder = await iexec.order
      .createRequestorder({
        app: apporder.app,
        appmaxprice: 0,
        dataset: datasetorder.dataset,
        datasetmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: await iexec.wallet.getAddress(),
        category: 0,
        volume: 10,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));
    const independentRequestorder = await iexec.order.signRequestorder(
      {
        ...requestorder,
        datasetmaxprice: 5,
      },
      { checkRequest: false },
    );
    const [
      appHash,
      datasetHash,
      dataset5nRlcHash,
      requestHash,
      independentRequestHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporder),
      iexec.order.hashDatasetorder(datasetorder),
      iexec.order.hashDatasetorder(datasetorder5nRlc),
      iexec.order.hashRequestorder(requestorder),
      iexec.order.hashRequestorder(independentRequestorder),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
        },
        {
          orderHash: dataset5nRlcHash,
          order: datasetorder5nRlc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
        },
      ]),
    ]);
    await iexec.order.cancelDatasetorder(datasetorder);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedDatasetorder5nRlc],
      [savedRequestorder],
      [savedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: dataset5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorder5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(savedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [updatedApporder],
      [updatedDatasetorder],
      [updatedDatasetorder5nRlc],
      [updatedRequestorder],
      [updatedIndependentRequestorder],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: dataset5nRlcHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
    ]);
    expect(updatedDatasetorder.status).toBe(STATUS_MAP.CANCELED);
    expect(updatedDatasetorder.remaining).toBe(0);
    expect(updatedDatasetorder5nRlc.status).toBe(STATUS_MAP.OPEN);
    expect(updatedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedRequestorder.status).toBe(STATUS_MAP.DEAD);
    expect(updatedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
  });

  test('ClosedWorkerpoolOrder (cancel order)', async () => {
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexec);
    const [workerpoolHash] = await Promise.all([
      iexec.order.hashWorkerpoolorder(workerpoolorder),
    ]);
    await Promise.all([
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
        },
      ]),
    ]);
    await iexec.order.cancelWorkerpoolorder(workerpoolorder);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [[savedWorkerpoolorder]] = await Promise.all([
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolHash,
      }),
    ]);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedWorkerpoolorder.remaining).toBe(0);
  });

  test('ClosedRequestOrder (cancel order)', async () => {
    const requestorder = await iexec.order
      .createRequestorder({
        app: utils.NULL_ADDRESS,
        category: 0,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));

    const [requestHash] = await Promise.all([
      iexec.order.hashRequestorder(requestorder),
    ]);
    await Promise.all([
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
        },
      ]),
    ]);
    await iexec.order.cancelRequestorder(requestorder);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [[savedRequestorder]] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestHash,
      }),
    ]);
    expect(savedRequestorder.status).toBe(STATUS_MAP.CANCELED);
    expect(savedRequestorder.remaining).toBe(0);
  });

  test('Transfer StakedRlc (clean dependant workerpoolorder)', async () => {
    await iexec.account.deposit(100);
    const address = await iexec.wallet.getAddress();
    const independentWorkerpoolorder = await deployAndGetWorkerpoolorder(
      iexec,
      {
        workerpoolprice: 0,
        volume: 30,
      },
    );

    const finallyGoodWorkerpoolorder = await iexec.order.signWorkerpoolorder({
      ...independentWorkerpoolorder,
      workerpoolprice: 100,
      volume: 1,
    });

    const workerpoolorderTooExpensive = await iexec.order.signWorkerpoolorder({
      ...independentWorkerpoolorder,
      workerpoolprice: 104,
      volume: 1,
    });

    const workerpoolorderCumulativeTooExpensive =
      await iexec.order.signWorkerpoolorder({
        ...independentWorkerpoolorder,
        workerpoolprice: 37,
        volume: 3,
      });

    const [
      independentWorkerpoolHash,
      finallyGoodWorkerpoolHash,
      workerpoolorderTooExpensiveHash,
      workerpoolorderCumulativeTooExpensiveHash,
    ] = await Promise.all([
      iexec.order.hashWorkerpoolorder(independentWorkerpoolorder),
      iexec.order.hashWorkerpoolorder(finallyGoodWorkerpoolorder),
      iexec.order.hashWorkerpoolorder(workerpoolorderTooExpensive),
      iexec.order.hashWorkerpoolorder(workerpoolorderCumulativeTooExpensive),
    ]);
    await Promise.all([
      addWorkerpoolorders(chainId, [
        {
          orderHash: independentWorkerpoolHash,
          order: independentWorkerpoolorder,
          signer: address,
        },
        {
          orderHash: finallyGoodWorkerpoolHash,
          order: finallyGoodWorkerpoolorder,
          signer: address,
        },
        {
          orderHash: workerpoolorderTooExpensiveHash,
          order: workerpoolorderTooExpensive,
          signer: address,
        },
        {
          orderHash: workerpoolorderCumulativeTooExpensiveHash,
          order: workerpoolorderCumulativeTooExpensive,
          signer: address,
        },
      ]),
    ]);
    const { stake } = await iexec.account.checkBalance(address);
    await iexec.account.withdraw(stake);
    await iexec.account.deposit(30);
    const [
      [savedIndependentWorkerpoolorder],
      [savedFinallyGoodWorkerpoolorder],
      [savedWorkerpoolorderTooExpensive],
      [savedWorkerpoolorderCumulativeTooExpensive],
    ] = await Promise.all([
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: independentWorkerpoolHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: finallyGoodWorkerpoolHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolorderTooExpensiveHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolorderCumulativeTooExpensiveHash,
      }),
    ]);
    expect(savedIndependentWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedFinallyGoodWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderTooExpensive.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderCumulativeTooExpensive.status).toBe(
      STATUS_MAP.OPEN,
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [updatedIndependentWorkerpoolorder],
      [updatedFinallyGoodWorkerpoolorder],
      [updatedWorkerpoolorderTooExpensive],
      [updatedWorkerpoolorderCumulativeTooExpensive],
    ] = await Promise.all([
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: independentWorkerpoolHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: finallyGoodWorkerpoolHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolorderTooExpensiveHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolorderCumulativeTooExpensiveHash,
      }),
    ]);
    expect(updatedIndependentWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedFinallyGoodWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedWorkerpoolorderTooExpensive.status).toBe(STATUS_MAP.DEAD);
    expect(updatedWorkerpoolorderCumulativeTooExpensive.status).toBe(
      STATUS_MAP.DEAD,
    );
  });

  test('Transfer StakedRlc (clean dependant requestorder)', async () => {
    await iexec.account.deposit(100);
    const address = await iexec.wallet.getAddress();
    const independentRequestorder = await iexec.order
      .createRequestorder({
        app: utils.NULL_ADDRESS,
        appmaxprice: 0,
        datasetmaxprice: 0,
        workerpoolmaxprice: 0,
        requester: address,
        category: 0,
        volume: 3,
      })
      .then((o) => iexec.order.signRequestorder(o, { checkRequest: false }));

    const finallyGoodRequestorder = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        appmaxprice: 1,
        datasetmaxprice: 1,
        workerpoolmaxprice: 1,
      },
      { checkRequest: false },
    );

    const requestorderAppTooExpensive = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        appmaxprice: 4,
        datasetmaxprice: 0,
        workerpoolmaxprice: 0,
      },
      { checkRequest: false },
    );

    const requestorderDatasetTooExpensive = await iexec.order.signRequestorder(
      {
        ...independentRequestorder,
        appmaxprice: 0,
        datasetmaxprice: 4,
        workerpoolmaxprice: 0,
      },
      { checkRequest: false },
    );

    const requestorderWorkerpoolTooExpensive =
      await iexec.order.signRequestorder(
        {
          ...independentRequestorder,
          appmaxprice: 0,
          datasetmaxprice: 0,
          workerpoolmaxprice: 4,
        },
        { checkRequest: false },
      );

    const requestorderCumulativeTooExpensive =
      await iexec.order.signRequestorder(
        {
          ...independentRequestorder,
          appmaxprice: 2,
          datasetmaxprice: 2,
          workerpoolmaxprice: 2,
        },
        { checkRequest: false },
      );
    const [
      independentRequestHash,
      finallyGoodRequestHash,
      requestorderAppTooExpensiveHash,
      requestorderDatasetTooExpensiveHash,
      requestorderWorkerpoolTooExpensiveHash,
      requestorderCumulativeTooExpensiveHash,
    ] = await Promise.all([
      iexec.order.hashRequestorder(independentRequestorder),
      iexec.order.hashRequestorder(finallyGoodRequestorder),
      iexec.order.hashRequestorder(requestorderAppTooExpensive),
      iexec.order.hashRequestorder(requestorderDatasetTooExpensive),
      iexec.order.hashRequestorder(requestorderWorkerpoolTooExpensive),
      iexec.order.hashRequestorder(requestorderCumulativeTooExpensive),
    ]);
    await Promise.all([
      addRequestorders(chainId, [
        {
          orderHash: independentRequestHash,
          order: independentRequestorder,
          signer: address,
        },
        {
          orderHash: finallyGoodRequestHash,
          order: finallyGoodRequestorder,
          signer: address,
        },
        {
          orderHash: requestorderAppTooExpensiveHash,
          order: requestorderAppTooExpensive,
          signer: address,
        },
        {
          orderHash: requestorderDatasetTooExpensiveHash,
          order: requestorderDatasetTooExpensive,
          signer: address,
        },
        {
          orderHash: requestorderWorkerpoolTooExpensiveHash,
          order: requestorderWorkerpoolTooExpensive,
          signer: address,
        },
        {
          orderHash: requestorderCumulativeTooExpensiveHash,
          order: requestorderCumulativeTooExpensive,
          signer: address,
        },
      ]),
    ]);
    const { stake } = await iexec.account.checkBalance(address);
    await iexec.account.withdraw(stake);
    await iexec.account.deposit(10);
    const [
      [savedIndependentRequestorder],
      [savedFinallyGoodRequestorder],
      [savedRequestorderAppTooExpensive],
      [savedRequestorderDatasetTooExpensive],
      [savedRequestorderWorkerpoolTooExpensive],
      [savedRequestorderCumulativeTooExpensive],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: finallyGoodRequestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderAppTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderDatasetTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderWorkerpoolTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderCumulativeTooExpensiveHash,
      }),
    ]);
    expect(savedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedFinallyGoodRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderAppTooExpensive.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderDatasetTooExpensive.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderWorkerpoolTooExpensive.status).toBe(
      STATUS_MAP.OPEN,
    );
    expect(savedRequestorderCumulativeTooExpensive.status).toBe(
      STATUS_MAP.OPEN,
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [updatedIndependentRequestorder],
      [updatedFinallyGoodRequestorder],
      [updatedRequestorderAppTooExpensive],
      [updatedRequestorderDatasetTooExpensive],
      [updatedRequestorderWorkerpoolTooExpensive],
      [updatedRequestorderCumulativeTooExpensive],
    ] = await Promise.all([
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: independentRequestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: finallyGoodRequestHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderAppTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderDatasetTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderWorkerpoolTooExpensiveHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestorderCumulativeTooExpensiveHash,
      }),
    ]);
    expect(updatedIndependentRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedFinallyGoodRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(updatedRequestorderAppTooExpensive.status).toBe(STATUS_MAP.DEAD);
    expect(updatedRequestorderDatasetTooExpensive.status).toBe(STATUS_MAP.DEAD);
    expect(updatedRequestorderWorkerpoolTooExpensive.status).toBe(
      STATUS_MAP.DEAD,
    );
    expect(updatedRequestorderCumulativeTooExpensive.status).toBe(
      STATUS_MAP.DEAD,
    );
  });

  test('App Transfer (clean previous owner orders)', async () => {
    const owner = await iexec.wallet.getAddress();
    const order = await deployAndGetApporder(iexec);
    const orderHash = await iexec.order.hashApporder(order);
    await addApporders(chainId, [
      {
        orderHash,
        order,
        signer: owner,
      },
    ]);
    await transferResourceERC721(
      wallet,
      order.app,
      '0x000000000000000000000000000000000000dead',
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [savedOrder] = await find(chainId, APPORDERS_COLLECTION, {
      orderHash,
    });
    expect(savedOrder.status).toBe(STATUS_MAP.DEAD);
  });

  test('Dataset Transfer (clean previous owner orders)', async () => {
    const owner = await iexec.wallet.getAddress();
    const order = await deployAndGetDatasetorder(iexec);
    const orderHash = await iexec.order.hashDatasetorder(order);
    await addDatasetorders(chainId, [
      {
        orderHash,
        order,
        signer: owner,
      },
    ]);
    await transferResourceERC721(
      wallet,
      order.dataset,
      '0x000000000000000000000000000000000000dead',
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [savedOrder] = await find(chainId, DATASETORDERS_COLLECTION, {
      orderHash,
    });
    expect(savedOrder.status).toBe(STATUS_MAP.DEAD);
  });

  test('Workerpool Transfer (clean previous owner orders)', async () => {
    const owner = await iexec.wallet.getAddress();
    const order = await deployAndGetWorkerpoolorder(iexec);
    const orderHash = await iexec.order.hashWorkerpoolorder(order);
    await addWorkerpoolorders(chainId, [
      {
        orderHash,
        order,
        signer: owner,
      },
    ]);
    await transferResourceERC721(
      wallet,
      order.workerpool,
      '0x000000000000000000000000000000000000dead',
    );
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    const [savedOrder] = await find(chainId, WORKERPOOLORDERS_COLLECTION, {
      orderHash,
    });
    expect(savedOrder.status).toBe(STATUS_MAP.DEAD);
  });
});
