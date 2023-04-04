const ethers = require('ethers');
const erlcDesc = require('@iexec/erlc/build/contracts-min/ERLCTokenSwap.json');
const { utils, IExec } = require('iexec');
const socket = require('../src/loaders/socket');
// jest spies
const socketEmitSpy = jest.spyOn(socket, 'emit');
const { start, stop } = require('../src/app');
const { replayPastOnly } = require('../src/controllers/replayer');
const { chain } = require('../src/config');
const { sleep } = require('../src/utils/utils');
const { STATUS_MAP } = require('../src/utils/order-utils');
const { KYC_MEMBER_ROLE } = require('../src/utils/iexec-utils');
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
  APPORDERS_COLLECTION,
  DATASETORDERS_COLLECTION,
  WORKERPOOLORDERS_COLLECTION,
  REQUESTORDERS_COLLECTION,
  fastForwardToLastBlock,
  setCheckpointToLastBlock,
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
let iexecUser;
const signer = utils.getSignerFromPrivateKey(chainUrl, PRIVATE_KEY);
const userSigner = utils.getSignerFromPrivateKey(
  chainUrl,
  ethers.Wallet.createRandom().privateKey,
);

const grantKYC = async (address) => {
  const iExecContract = new ethers.Contract(
    hubAddress,
    [
      {
        inputs: [],
        name: 'token',
        outputs: [
          {
            internalType: 'address',
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
  const eRlcAddress = await iExecContract.token();
  const eRlcContract = new ethers.Contract(eRlcAddress, erlcDesc.abi, signer);
  const grantTx = await eRlcContract.grantRole(KYC_MEMBER_ROLE, address);
  await grantTx.wait();
};

const revokeKYC = async (address) => {
  const iExecContract = new ethers.Contract(
    hubAddress,
    [
      {
        inputs: [],
        name: 'token',
        outputs: [
          {
            internalType: 'address',
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
  const eRlcAddress = await iExecContract.token();
  const eRlcContract = new ethers.Contract(eRlcAddress, erlcDesc.abi, signer);

  const revokeTx = await eRlcContract.revokeRole(KYC_MEMBER_ROLE, address);
  await revokeTx.wait();
};

beforeAll(async () => {
  const network = await rpc.getNetwork();
  chainId = `${network.chainId}`;
  iexec = new IExec(
    {
      ethProvider: signer,
      flavour: 'enterprise',
    },
    {
      hubAddress,
      isNative: chain.isNative,
      resultProxyURL: 'http://example.com',
    },
  );
  iexecUser = new IExec(
    {
      ethProvider: userSigner,
      flavour: 'enterprise',
    },
    {
      hubAddress,
      isNative: chain.isNative,
      resultProxyURL: 'http://example.com',
    },
  );
  await dropDB(chainId);
  // fill user wallet with Eth
  await iexec.wallet.sendETH('1 ether', await iexecUser.wallet.getAddress());
});

describe('Watcher enterprise specific', () => {
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

  test('RoleRevoked (clean user orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    const defaultAddress = await iexec.wallet.getAddress();
    await grantKYC(userAddress);
    const apporder = await deployAndGetApporder(iexecUser);
    const datasetorder = await deployAndGetDatasetorder(iexecUser);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexecUser);
    const requestorder = await getMatchableRequestorder(iexecUser, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const apporderKyc = await deployAndGetApporder(iexec);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const [
      appHash,
      datasetHash,
      workerpoolHash,
      requestHash,
      appKycHash,
      datasetKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexecUser.order.hashApporder(apporder),
      iexecUser.order.hashDatasetorder(datasetorder),
      iexecUser.order.hashWorkerpoolorder(workerpoolorder),
      iexecUser.order.hashRequestorder(requestorder),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
          signer: userAddress,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
          signer: defaultAddress,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
          signer: userAddress,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
          signer: defaultAddress,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
          signer: userAddress,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
          signer: defaultAddress,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
          signer: userAddress,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
          signer: defaultAddress,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
      [savedApporderKyc],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
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
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(4);
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
  });

  test('RoleRevoked (clean user apps dependant orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    await grantKYC(userAddress);
    const apporder = await deployAndGetApporder(iexecUser);
    const apporder2 = await deployAndGetApporder(iexecUser);
    const apporderKyc = await deployAndGetApporder(iexec);

    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const datasetorderAppDependant = await deployAndGetDatasetorder(iexec, {
      apprestrict: apporder.app,
    });
    const workerpoolorderAppDependant = await deployAndGetWorkerpoolorder(
      iexec,
      { apprestrict: apporder.app },
    );
    const requestorderAppDependant = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const datasetorderApp2Dependant = await deployAndGetDatasetorder(iexec, {
      apprestrict: apporder2.app,
    });
    const workerpoolorderApp2Dependant = await deployAndGetWorkerpoolorder(
      iexec,
      { apprestrict: apporder2.app },
    );
    const requestorderApp2Dependant = await getMatchableRequestorder(iexec, {
      apporder: apporder2,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const [
      datasetAppDependantHash,
      workerpoolAppDependantHash,
      requestAppDependantHash,
      datasetApp2DependantHash,
      workerpoolApp2DependantHash,
      requestApp2DependantHash,
      datasetKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexec.order.hashDatasetorder(datasetorderAppDependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderAppDependant),
      iexec.order.hashRequestorder(requestorderAppDependant),
      iexec.order.hashDatasetorder(datasetorderApp2Dependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderApp2Dependant),
      iexec.order.hashRequestorder(requestorderApp2Dependant),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addDatasetorders(chainId, [
        {
          orderHash: datasetAppDependantHash,
          order: datasetorderAppDependant,
        },
        {
          orderHash: datasetApp2DependantHash,
          order: datasetorderApp2Dependant,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolAppDependantHash,
          order: workerpoolorderAppDependant,
        },
        {
          orderHash: workerpoolApp2DependantHash,
          order: workerpoolorderApp2Dependant,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestAppDependantHash,
          order: requestorderAppDependant,
        },
        {
          orderHash: requestApp2DependantHash,
          order: requestorderApp2Dependant,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedDatasetorderAppDependant],
      [savedWorkerpoolorderAppDependant],
      [savedRequestorderAppDependant],
      [savedDatasetorderApp2Dependant],
      [savedWorkerpoolorderApp2Dependant],
      [savedRequestorderApp2Dependant],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
    ] = await Promise.all([
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetAppDependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolAppDependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppDependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetApp2DependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolApp2DependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestApp2DependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedDatasetorderAppDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderAppDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderAppDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderApp2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderApp2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderApp2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(6);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetAppDependantHash,
      ],
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetApp2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'workerpoolorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolAppDependantHash,
      ],
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolApp2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestAppDependantHash,
      ],
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestApp2DependantHash,
      ],
    ]);
  });

  test('RoleRevoked (clean user datasets dependant orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    await grantKYC(userAddress);
    const datasetorder = await deployAndGetDatasetorder(iexecUser);
    const datasetorder2 = await deployAndGetDatasetorder(iexecUser);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);

    const apporderKyc = await deployAndGetApporder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const apporderDatasetDependant = await deployAndGetApporder(iexec, {
      datasetrestrict: datasetorder.dataset,
    });
    const workerpoolorderDatasetDependant = await deployAndGetWorkerpoolorder(
      iexec,
      { datasetrestrict: datasetorder.dataset },
    );
    const requestorderDatasetDependant = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder,
      workerpoolorder: workerpoolorderKyc,
    });
    const apporderDataset2Dependant = await deployAndGetApporder(iexec, {
      datasetrestrict: datasetorder2.dataset,
    });
    const workerpoolorderDataset2Dependant = await deployAndGetWorkerpoolorder(
      iexec,
      { datasetrestrict: datasetorder2.dataset },
    );
    const requestorderDataset2Dependant = await getMatchableRequestorder(
      iexec,
      {
        apporder: apporderKyc,
        datasetorder: datasetorder2,
        workerpoolorder: workerpoolorderKyc,
      },
    );
    const [
      appDatasetDependantHash,
      workerpoolDatasetDependantHash,
      requestDatasetDependantHash,
      appDataset2DependantHash,
      workerpoolDataset2DependantHash,
      requestDataset2DependantHash,
      appKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporderDatasetDependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderDatasetDependant),
      iexec.order.hashRequestorder(requestorderDatasetDependant),
      iexec.order.hashApporder(apporderDataset2Dependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderDataset2Dependant),
      iexec.order.hashRequestorder(requestorderDataset2Dependant),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appDatasetDependantHash,
          order: apporderDatasetDependant,
        },
        {
          orderHash: appDataset2DependantHash,
          order: apporderDataset2Dependant,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolDatasetDependantHash,
          order: workerpoolorderDatasetDependant,
        },
        {
          orderHash: workerpoolDataset2DependantHash,
          order: workerpoolorderDataset2Dependant,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestDatasetDependantHash,
          order: requestorderDatasetDependant,
        },
        {
          orderHash: requestDataset2DependantHash,
          order: requestorderDataset2Dependant,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporderDatasetDependant],
      [savedWorkerpoolorderDatasetDependant],
      [savedRequestorderDatasetDependant],
      [savedApporderDataset2Dependant],
      [savedWorkerpoolorderDataset2Dependant],
      [savedRequestorderDataset2Dependant],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appDatasetDependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolDatasetDependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDatasetDependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appDataset2DependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolDataset2DependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDataset2DependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporderDatasetDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderDatasetDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderDatasetDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderDataset2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderDataset2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderDataset2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(6);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'apporder_unpublished', appDatasetDependantHash],
      [`${chainId}:orders`, 'apporder_unpublished', appDataset2DependantHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'workerpoolorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolDatasetDependantHash,
      ],
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolDataset2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestDatasetDependantHash,
      ],
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestDataset2DependantHash,
      ],
    ]);
  });

  test('RoleRevoked (clean user workerpools dependant orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    await grantKYC(userAddress);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexecUser);
    const workerpoolorder2 = await deployAndGetWorkerpoolorder(iexecUser);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);

    const apporderKyc = await deployAndGetApporder(iexec);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const apporderWorkerpoolDependant = await deployAndGetApporder(iexec, {
      workerpoolrestrict: workerpoolorder.workerpool,
    });
    const datasetorderWorkerpoolDependant = await deployAndGetDatasetorder(
      iexec,
      {
        workerpoolrestrict: workerpoolorder.workerpool,
      },
    );
    const requestorderWorkerpoolDependant = await getMatchableRequestorder(
      iexec,
      {
        apporder: apporderKyc,
        datasetorder: datasetorderKyc,
        workerpoolorder,
      },
    );
    const apporderWorkerpool2Dependant = await deployAndGetApporder(iexec, {
      workerpoolrestrict: workerpoolorder2.workerpool,
    });
    const datasetorderWorkerpool2Dependant = await deployAndGetDatasetorder(
      iexec,
      {
        workerpoolrestrict: workerpoolorder2.workerpool,
      },
    );
    const requestorderWorkerpool2Dependant = await getMatchableRequestorder(
      iexec,
      {
        apporder: apporderKyc,
        datasetorder: datasetorderKyc,
        workerpoolorder: workerpoolorder2,
      },
    );
    const [
      appWorkerpoolDependantHash,
      datasetWorkerpoolDependantHash,
      requestWorkerpoolDependantHash,
      appWorkerpool2DependantHash,
      datasetWorkerpool2DependantHash,
      requestWorkerpool2DependantHash,
      appKycHash,
      datasetKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporderWorkerpoolDependant),
      iexec.order.hashDatasetorder(datasetorderWorkerpoolDependant),
      iexec.order.hashRequestorder(requestorderWorkerpoolDependant),
      iexec.order.hashApporder(apporderWorkerpool2Dependant),
      iexec.order.hashDatasetorder(datasetorderWorkerpool2Dependant),
      iexec.order.hashRequestorder(requestorderWorkerpool2Dependant),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appWorkerpoolDependantHash,
          order: apporderWorkerpoolDependant,
        },
        {
          orderHash: appWorkerpool2DependantHash,
          order: apporderWorkerpool2Dependant,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetWorkerpoolDependantHash,
          order: datasetorderWorkerpoolDependant,
        },
        {
          orderHash: datasetWorkerpool2DependantHash,
          order: datasetorderWorkerpool2Dependant,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestWorkerpoolDependantHash,
          order: requestorderWorkerpoolDependant,
        },
        {
          orderHash: requestWorkerpool2DependantHash,
          order: requestorderWorkerpool2Dependant,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporderWorkerpoolDependant],
      [savedDatasetorderWorkerpoolDependant],
      [savedRequestorderWorkerpoolDependant],
      [savedApporderWorkerpool2Dependant],
      [savedDatasetorderWorkerpool2Dependant],
      [savedRequestorderWorkerpool2Dependant],
      [savedApporderKyc],
      [savedDatasetorderKyc],
      [savedRequestorderKyc],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appWorkerpoolDependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetWorkerpoolDependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestWorkerpoolDependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appWorkerpool2DependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetWorkerpool2DependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestWorkerpool2DependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporderWorkerpoolDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderWorkerpoolDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderWorkerpoolDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderWorkerpool2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderWorkerpool2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderWorkerpool2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(6);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'apporder_unpublished', appWorkerpoolDependantHash],
      [
        `${chainId}:orders`,
        'apporder_unpublished',
        appWorkerpool2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetWorkerpoolDependantHash,
      ],
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetWorkerpool2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestWorkerpoolDependantHash,
      ],
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestWorkerpool2DependantHash,
      ],
    ]);
  });
});

describe('Recover on start enterprise specific', () => {
  beforeEach(async () => {
    await dropDB(chainId);
    await fastForwardToLastBlock(chainId, rpc);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await stop();
  });

  test('RoleRevoked (clean user orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    const defaultAddress = await iexec.wallet.getAddress();
    await grantKYC(userAddress);
    const apporder = await deployAndGetApporder(iexecUser);
    const datasetorder = await deployAndGetDatasetorder(iexecUser);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexecUser);
    const requestorder = await getMatchableRequestorder(iexecUser, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const apporderKyc = await deployAndGetApporder(iexec);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const [
      appHash,
      datasetHash,
      workerpoolHash,
      requestHash,
      appKycHash,
      datasetKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexecUser.order.hashApporder(apporder),
      iexecUser.order.hashDatasetorder(datasetorder),
      iexecUser.order.hashWorkerpoolorder(workerpoolorder),
      iexecUser.order.hashRequestorder(requestorder),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
          signer: userAddress,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
          signer: defaultAddress,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
          signer: userAddress,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
          signer: defaultAddress,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
          signer: userAddress,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
          signer: defaultAddress,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
          signer: userAddress,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
          signer: defaultAddress,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
      [savedApporderKyc],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
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
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(4);
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
  });

  test('RoleRevoked (clean user apps dependant orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    await grantKYC(userAddress);
    const apporder = await deployAndGetApporder(iexecUser);
    const apporder2 = await deployAndGetApporder(iexecUser);
    const apporderKyc = await deployAndGetApporder(iexec);

    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const datasetorderAppDependant = await deployAndGetDatasetorder(iexec, {
      apprestrict: apporder.app,
    });
    const workerpoolorderAppDependant = await deployAndGetWorkerpoolorder(
      iexec,
      { apprestrict: apporder.app },
    );
    const requestorderAppDependant = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const datasetorderApp2Dependant = await deployAndGetDatasetorder(iexec, {
      apprestrict: apporder2.app,
    });
    const workerpoolorderApp2Dependant = await deployAndGetWorkerpoolorder(
      iexec,
      { apprestrict: apporder2.app },
    );
    const requestorderApp2Dependant = await getMatchableRequestorder(iexec, {
      apporder: apporder2,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const [
      datasetAppDependantHash,
      workerpoolAppDependantHash,
      requestAppDependantHash,
      datasetApp2DependantHash,
      workerpoolApp2DependantHash,
      requestApp2DependantHash,
      datasetKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexec.order.hashDatasetorder(datasetorderAppDependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderAppDependant),
      iexec.order.hashRequestorder(requestorderAppDependant),
      iexec.order.hashDatasetorder(datasetorderApp2Dependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderApp2Dependant),
      iexec.order.hashRequestorder(requestorderApp2Dependant),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addDatasetorders(chainId, [
        {
          orderHash: datasetAppDependantHash,
          order: datasetorderAppDependant,
        },
        {
          orderHash: datasetApp2DependantHash,
          order: datasetorderApp2Dependant,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolAppDependantHash,
          order: workerpoolorderAppDependant,
        },
        {
          orderHash: workerpoolApp2DependantHash,
          order: workerpoolorderApp2Dependant,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestAppDependantHash,
          order: requestorderAppDependant,
        },
        {
          orderHash: requestApp2DependantHash,
          order: requestorderApp2Dependant,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedDatasetorderAppDependant],
      [savedWorkerpoolorderAppDependant],
      [savedRequestorderAppDependant],
      [savedDatasetorderApp2Dependant],
      [savedWorkerpoolorderApp2Dependant],
      [savedRequestorderApp2Dependant],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
    ] = await Promise.all([
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetAppDependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolAppDependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppDependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetApp2DependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolApp2DependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestApp2DependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedDatasetorderAppDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderAppDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderAppDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderApp2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderApp2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderApp2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(6);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetAppDependantHash,
      ],
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetApp2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'workerpoolorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolAppDependantHash,
      ],
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolApp2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestAppDependantHash,
      ],
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestApp2DependantHash,
      ],
    ]);
  });

  test('RoleRevoked (clean user datasets dependant orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    await grantKYC(userAddress);
    const datasetorder = await deployAndGetDatasetorder(iexecUser);
    const datasetorder2 = await deployAndGetDatasetorder(iexecUser);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);

    const apporderKyc = await deployAndGetApporder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const apporderDatasetDependant = await deployAndGetApporder(iexec, {
      datasetrestrict: datasetorder.dataset,
    });
    const workerpoolorderDatasetDependant = await deployAndGetWorkerpoolorder(
      iexec,
      { datasetrestrict: datasetorder.dataset },
    );
    const requestorderDatasetDependant = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder,
      workerpoolorder: workerpoolorderKyc,
    });
    const apporderDataset2Dependant = await deployAndGetApporder(iexec, {
      datasetrestrict: datasetorder2.dataset,
    });
    const workerpoolorderDataset2Dependant = await deployAndGetWorkerpoolorder(
      iexec,
      { datasetrestrict: datasetorder2.dataset },
    );
    const requestorderDataset2Dependant = await getMatchableRequestorder(
      iexec,
      {
        apporder: apporderKyc,
        datasetorder: datasetorder2,
        workerpoolorder: workerpoolorderKyc,
      },
    );
    const [
      appDatasetDependantHash,
      workerpoolDatasetDependantHash,
      requestDatasetDependantHash,
      appDataset2DependantHash,
      workerpoolDataset2DependantHash,
      requestDataset2DependantHash,
      appKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporderDatasetDependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderDatasetDependant),
      iexec.order.hashRequestorder(requestorderDatasetDependant),
      iexec.order.hashApporder(apporderDataset2Dependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderDataset2Dependant),
      iexec.order.hashRequestorder(requestorderDataset2Dependant),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appDatasetDependantHash,
          order: apporderDatasetDependant,
        },
        {
          orderHash: appDataset2DependantHash,
          order: apporderDataset2Dependant,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolDatasetDependantHash,
          order: workerpoolorderDatasetDependant,
        },
        {
          orderHash: workerpoolDataset2DependantHash,
          order: workerpoolorderDataset2Dependant,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestDatasetDependantHash,
          order: requestorderDatasetDependant,
        },
        {
          orderHash: requestDataset2DependantHash,
          order: requestorderDataset2Dependant,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporderDatasetDependant],
      [savedWorkerpoolorderDatasetDependant],
      [savedRequestorderDatasetDependant],
      [savedApporderDataset2Dependant],
      [savedWorkerpoolorderDataset2Dependant],
      [savedRequestorderDataset2Dependant],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appDatasetDependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolDatasetDependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDatasetDependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appDataset2DependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolDataset2DependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDataset2DependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporderDatasetDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderDatasetDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderDatasetDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderDataset2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderDataset2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderDataset2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(6);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'apporder_unpublished', appDatasetDependantHash],
      [`${chainId}:orders`, 'apporder_unpublished', appDataset2DependantHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'workerpoolorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolDatasetDependantHash,
      ],
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolDataset2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestDatasetDependantHash,
      ],
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestDataset2DependantHash,
      ],
    ]);
  });

  test('RoleRevoked (clean user workerpools dependant orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    await grantKYC(userAddress);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexecUser);
    const workerpoolorder2 = await deployAndGetWorkerpoolorder(iexecUser);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);

    const apporderKyc = await deployAndGetApporder(iexec);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const apporderWorkerpoolDependant = await deployAndGetApporder(iexec, {
      workerpoolrestrict: workerpoolorder.workerpool,
    });
    const datasetorderWorkerpoolDependant = await deployAndGetDatasetorder(
      iexec,
      {
        workerpoolrestrict: workerpoolorder.workerpool,
      },
    );
    const requestorderWorkerpoolDependant = await getMatchableRequestorder(
      iexec,
      {
        apporder: apporderKyc,
        datasetorder: datasetorderKyc,
        workerpoolorder,
      },
    );
    const apporderWorkerpool2Dependant = await deployAndGetApporder(iexec, {
      workerpoolrestrict: workerpoolorder2.workerpool,
    });
    const datasetorderWorkerpool2Dependant = await deployAndGetDatasetorder(
      iexec,
      {
        workerpoolrestrict: workerpoolorder2.workerpool,
      },
    );
    const requestorderWorkerpool2Dependant = await getMatchableRequestorder(
      iexec,
      {
        apporder: apporderKyc,
        datasetorder: datasetorderKyc,
        workerpoolorder: workerpoolorder2,
      },
    );
    const [
      appWorkerpoolDependantHash,
      datasetWorkerpoolDependantHash,
      requestWorkerpoolDependantHash,
      appWorkerpool2DependantHash,
      datasetWorkerpool2DependantHash,
      requestWorkerpool2DependantHash,
      appKycHash,
      datasetKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporderWorkerpoolDependant),
      iexec.order.hashDatasetorder(datasetorderWorkerpoolDependant),
      iexec.order.hashRequestorder(requestorderWorkerpoolDependant),
      iexec.order.hashApporder(apporderWorkerpool2Dependant),
      iexec.order.hashDatasetorder(datasetorderWorkerpool2Dependant),
      iexec.order.hashRequestorder(requestorderWorkerpool2Dependant),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appWorkerpoolDependantHash,
          order: apporderWorkerpoolDependant,
        },
        {
          orderHash: appWorkerpool2DependantHash,
          order: apporderWorkerpool2Dependant,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetWorkerpoolDependantHash,
          order: datasetorderWorkerpoolDependant,
        },
        {
          orderHash: datasetWorkerpool2DependantHash,
          order: datasetorderWorkerpool2Dependant,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestWorkerpoolDependantHash,
          order: requestorderWorkerpoolDependant,
        },
        {
          orderHash: requestWorkerpool2DependantHash,
          order: requestorderWorkerpool2Dependant,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporderWorkerpoolDependant],
      [savedDatasetorderWorkerpoolDependant],
      [savedRequestorderWorkerpoolDependant],
      [savedApporderWorkerpool2Dependant],
      [savedDatasetorderWorkerpool2Dependant],
      [savedRequestorderWorkerpool2Dependant],
      [savedApporderKyc],
      [savedDatasetorderKyc],
      [savedRequestorderKyc],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appWorkerpoolDependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetWorkerpoolDependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestWorkerpoolDependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appWorkerpool2DependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetWorkerpool2DependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestWorkerpool2DependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporderWorkerpoolDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderWorkerpoolDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderWorkerpoolDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderWorkerpool2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderWorkerpool2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderWorkerpool2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(6);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'apporder_unpublished', appWorkerpoolDependantHash],
      [
        `${chainId}:orders`,
        'apporder_unpublished',
        appWorkerpool2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetWorkerpoolDependantHash,
      ],
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetWorkerpool2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestWorkerpoolDependantHash,
      ],
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestWorkerpool2DependantHash,
      ],
    ]);
  });

  test('RoleRevoked then RoleGranted (do not clean orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    const defaultAddress = await iexec.wallet.getAddress();
    await grantKYC(userAddress);
    const apporder = await deployAndGetApporder(iexecUser);
    const datasetorder = await deployAndGetDatasetorder(iexecUser);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexecUser);
    const requestorder = await getMatchableRequestorder(iexecUser, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const apporderKyc = await deployAndGetApporder(iexec);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const [
      appHash,
      datasetHash,
      workerpoolHash,
      requestHash,
      appKycHash,
      datasetKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexecUser.order.hashApporder(apporder),
      iexecUser.order.hashDatasetorder(datasetorder),
      iexecUser.order.hashWorkerpoolorder(workerpoolorder),
      iexecUser.order.hashRequestorder(requestorder),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
          signer: userAddress,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
          signer: defaultAddress,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
          signer: userAddress,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
          signer: defaultAddress,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
          signer: userAddress,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
          signer: defaultAddress,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
          signer: userAddress,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
          signer: defaultAddress,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await grantKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    await start({ syncWatcher: false, replayer: false });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
      [savedApporderKyc],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
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
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedApporderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
  });
});

describe('Replay Past enterprise specific', () => {
  beforeAll(async () => {
    await dropDB(chainId);
    await ethereumInit();
  });

  beforeEach(async () => {
    await dropDB(chainId, [
      APPORDERS_COLLECTION,
      DATASETORDERS_COLLECTION,
      WORKERPOOLORDERS_COLLECTION,
      REQUESTORDERS_COLLECTION,
    ]);
    await fastForwardToLastBlock(chainId, rpc);
    await setCheckpointToLastBlock(chainId);
    jest.clearAllMocks();
  });

  test('RoleRevoked (clean user orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    const defaultAddress = await iexec.wallet.getAddress();
    await grantKYC(userAddress);
    const apporder = await deployAndGetApporder(iexecUser);
    const datasetorder = await deployAndGetDatasetorder(iexecUser);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexecUser);
    const requestorder = await getMatchableRequestorder(iexecUser, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const apporderKyc = await deployAndGetApporder(iexec);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const [
      appHash,
      datasetHash,
      workerpoolHash,
      requestHash,
      appKycHash,
      datasetKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexecUser.order.hashApporder(apporder),
      iexecUser.order.hashDatasetorder(datasetorder),
      iexecUser.order.hashWorkerpoolorder(workerpoolorder),
      iexecUser.order.hashRequestorder(requestorder),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
          signer: userAddress,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
          signer: defaultAddress,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
          signer: userAddress,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
          signer: defaultAddress,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
          signer: userAddress,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
          signer: defaultAddress,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
          signer: userAddress,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
          signer: defaultAddress,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
      [savedApporderKyc],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
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
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorder.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(4);
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
  });

  test('RoleRevoked (clean user apps dependant orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    await grantKYC(userAddress);
    const apporder = await deployAndGetApporder(iexecUser);
    const apporder2 = await deployAndGetApporder(iexecUser);
    const apporderKyc = await deployAndGetApporder(iexec);

    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const datasetorderAppDependant = await deployAndGetDatasetorder(iexec, {
      apprestrict: apporder.app,
    });
    const workerpoolorderAppDependant = await deployAndGetWorkerpoolorder(
      iexec,
      { apprestrict: apporder.app },
    );
    const requestorderAppDependant = await getMatchableRequestorder(iexec, {
      apporder,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const datasetorderApp2Dependant = await deployAndGetDatasetorder(iexec, {
      apprestrict: apporder2.app,
    });
    const workerpoolorderApp2Dependant = await deployAndGetWorkerpoolorder(
      iexec,
      { apprestrict: apporder2.app },
    );
    const requestorderApp2Dependant = await getMatchableRequestorder(iexec, {
      apporder: apporder2,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const [
      datasetAppDependantHash,
      workerpoolAppDependantHash,
      requestAppDependantHash,
      datasetApp2DependantHash,
      workerpoolApp2DependantHash,
      requestApp2DependantHash,
      datasetKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexec.order.hashDatasetorder(datasetorderAppDependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderAppDependant),
      iexec.order.hashRequestorder(requestorderAppDependant),
      iexec.order.hashDatasetorder(datasetorderApp2Dependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderApp2Dependant),
      iexec.order.hashRequestorder(requestorderApp2Dependant),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addDatasetorders(chainId, [
        {
          orderHash: datasetAppDependantHash,
          order: datasetorderAppDependant,
        },
        {
          orderHash: datasetApp2DependantHash,
          order: datasetorderApp2Dependant,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolAppDependantHash,
          order: workerpoolorderAppDependant,
        },
        {
          orderHash: workerpoolApp2DependantHash,
          order: workerpoolorderApp2Dependant,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestAppDependantHash,
          order: requestorderAppDependant,
        },
        {
          orderHash: requestApp2DependantHash,
          order: requestorderApp2Dependant,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedDatasetorderAppDependant],
      [savedWorkerpoolorderAppDependant],
      [savedRequestorderAppDependant],
      [savedDatasetorderApp2Dependant],
      [savedWorkerpoolorderApp2Dependant],
      [savedRequestorderApp2Dependant],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
    ] = await Promise.all([
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetAppDependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolAppDependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestAppDependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetApp2DependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolApp2DependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestApp2DependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedDatasetorderAppDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderAppDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderAppDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderApp2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderApp2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderApp2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(6);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetAppDependantHash,
      ],
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetApp2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'workerpoolorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolAppDependantHash,
      ],
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolApp2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestAppDependantHash,
      ],
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestApp2DependantHash,
      ],
    ]);
  });

  test('RoleRevoked (clean user datasets dependant orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    await grantKYC(userAddress);
    const datasetorder = await deployAndGetDatasetorder(iexecUser);
    const datasetorder2 = await deployAndGetDatasetorder(iexecUser);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);

    const apporderKyc = await deployAndGetApporder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const apporderDatasetDependant = await deployAndGetApporder(iexec, {
      datasetrestrict: datasetorder.dataset,
    });
    const workerpoolorderDatasetDependant = await deployAndGetWorkerpoolorder(
      iexec,
      { datasetrestrict: datasetorder.dataset },
    );
    const requestorderDatasetDependant = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder,
      workerpoolorder: workerpoolorderKyc,
    });
    const apporderDataset2Dependant = await deployAndGetApporder(iexec, {
      datasetrestrict: datasetorder2.dataset,
    });
    const workerpoolorderDataset2Dependant = await deployAndGetWorkerpoolorder(
      iexec,
      { datasetrestrict: datasetorder2.dataset },
    );
    const requestorderDataset2Dependant = await getMatchableRequestorder(
      iexec,
      {
        apporder: apporderKyc,
        datasetorder: datasetorder2,
        workerpoolorder: workerpoolorderKyc,
      },
    );
    const [
      appDatasetDependantHash,
      workerpoolDatasetDependantHash,
      requestDatasetDependantHash,
      appDataset2DependantHash,
      workerpoolDataset2DependantHash,
      requestDataset2DependantHash,
      appKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporderDatasetDependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderDatasetDependant),
      iexec.order.hashRequestorder(requestorderDatasetDependant),
      iexec.order.hashApporder(apporderDataset2Dependant),
      iexec.order.hashWorkerpoolorder(workerpoolorderDataset2Dependant),
      iexec.order.hashRequestorder(requestorderDataset2Dependant),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appDatasetDependantHash,
          order: apporderDatasetDependant,
        },
        {
          orderHash: appDataset2DependantHash,
          order: apporderDataset2Dependant,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolDatasetDependantHash,
          order: workerpoolorderDatasetDependant,
        },
        {
          orderHash: workerpoolDataset2DependantHash,
          order: workerpoolorderDataset2Dependant,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestDatasetDependantHash,
          order: requestorderDatasetDependant,
        },
        {
          orderHash: requestDataset2DependantHash,
          order: requestorderDataset2Dependant,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporderDatasetDependant],
      [savedWorkerpoolorderDatasetDependant],
      [savedRequestorderDatasetDependant],
      [savedApporderDataset2Dependant],
      [savedWorkerpoolorderDataset2Dependant],
      [savedRequestorderDataset2Dependant],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appDatasetDependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolDatasetDependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDatasetDependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appDataset2DependantHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolDataset2DependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestDataset2DependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporderDatasetDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderDatasetDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderDatasetDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderDataset2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedWorkerpoolorderDataset2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderDataset2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(6);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'apporder_unpublished', appDatasetDependantHash],
      [`${chainId}:orders`, 'apporder_unpublished', appDataset2DependantHash],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'workerpoolorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolDatasetDependantHash,
      ],
      [
        `${chainId}:orders`,
        'workerpoolorder_unpublished',
        workerpoolDataset2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestDatasetDependantHash,
      ],
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestDataset2DependantHash,
      ],
    ]);
  });

  test('RoleRevoked (clean user workerpools dependant orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    await grantKYC(userAddress);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexecUser);
    const workerpoolorder2 = await deployAndGetWorkerpoolorder(iexecUser);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);

    const apporderKyc = await deployAndGetApporder(iexec);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const apporderWorkerpoolDependant = await deployAndGetApporder(iexec, {
      workerpoolrestrict: workerpoolorder.workerpool,
    });
    const datasetorderWorkerpoolDependant = await deployAndGetDatasetorder(
      iexec,
      {
        workerpoolrestrict: workerpoolorder.workerpool,
      },
    );
    const requestorderWorkerpoolDependant = await getMatchableRequestorder(
      iexec,
      {
        apporder: apporderKyc,
        datasetorder: datasetorderKyc,
        workerpoolorder,
      },
    );
    const apporderWorkerpool2Dependant = await deployAndGetApporder(iexec, {
      workerpoolrestrict: workerpoolorder2.workerpool,
    });
    const datasetorderWorkerpool2Dependant = await deployAndGetDatasetorder(
      iexec,
      {
        workerpoolrestrict: workerpoolorder2.workerpool,
      },
    );
    const requestorderWorkerpool2Dependant = await getMatchableRequestorder(
      iexec,
      {
        apporder: apporderKyc,
        datasetorder: datasetorderKyc,
        workerpoolorder: workerpoolorder2,
      },
    );
    const [
      appWorkerpoolDependantHash,
      datasetWorkerpoolDependantHash,
      requestWorkerpoolDependantHash,
      appWorkerpool2DependantHash,
      datasetWorkerpool2DependantHash,
      requestWorkerpool2DependantHash,
      appKycHash,
      datasetKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexec.order.hashApporder(apporderWorkerpoolDependant),
      iexec.order.hashDatasetorder(datasetorderWorkerpoolDependant),
      iexec.order.hashRequestorder(requestorderWorkerpoolDependant),
      iexec.order.hashApporder(apporderWorkerpool2Dependant),
      iexec.order.hashDatasetorder(datasetorderWorkerpool2Dependant),
      iexec.order.hashRequestorder(requestorderWorkerpool2Dependant),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appWorkerpoolDependantHash,
          order: apporderWorkerpoolDependant,
        },
        {
          orderHash: appWorkerpool2DependantHash,
          order: apporderWorkerpool2Dependant,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetWorkerpoolDependantHash,
          order: datasetorderWorkerpoolDependant,
        },
        {
          orderHash: datasetWorkerpool2DependantHash,
          order: datasetorderWorkerpool2Dependant,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestWorkerpoolDependantHash,
          order: requestorderWorkerpoolDependant,
        },
        {
          orderHash: requestWorkerpool2DependantHash,
          order: requestorderWorkerpool2Dependant,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporderWorkerpoolDependant],
      [savedDatasetorderWorkerpoolDependant],
      [savedRequestorderWorkerpoolDependant],
      [savedApporderWorkerpool2Dependant],
      [savedDatasetorderWorkerpool2Dependant],
      [savedRequestorderWorkerpool2Dependant],
      [savedApporderKyc],
      [savedDatasetorderKyc],
      [savedRequestorderKyc],
    ] = await Promise.all([
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appWorkerpoolDependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetWorkerpoolDependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestWorkerpoolDependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appWorkerpool2DependantHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetWorkerpool2DependantHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestWorkerpool2DependantHash,
      }),
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporderWorkerpoolDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderWorkerpoolDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderWorkerpoolDependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderWorkerpool2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedDatasetorderWorkerpool2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedRequestorderWorkerpool2Dependant.status).toBe(STATUS_MAP.DEAD);
    expect(savedApporderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(6);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'apporder_unpublished',
      ),
    ).toMatchObject([
      [`${chainId}:orders`, 'apporder_unpublished', appWorkerpoolDependantHash],
      [
        `${chainId}:orders`,
        'apporder_unpublished',
        appWorkerpool2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'datasetorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetWorkerpoolDependantHash,
      ],
      [
        `${chainId}:orders`,
        'datasetorder_unpublished',
        datasetWorkerpool2DependantHash,
      ],
    ]);
    expect(
      socketEmitSpy.mock.calls.filter(
        (args) => args[1] === 'requestorder_unpublished',
      ),
    ).toMatchObject([
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestWorkerpoolDependantHash,
      ],
      [
        `${chainId}:orders`,
        'requestorder_unpublished',
        requestWorkerpool2DependantHash,
      ],
    ]);
  });

  test('RoleRevoked then RoleGranted (do not clean orders)', async () => {
    const userAddress = await iexecUser.wallet.getAddress();
    const defaultAddress = await iexec.wallet.getAddress();
    await grantKYC(userAddress);
    const apporder = await deployAndGetApporder(iexecUser);
    const datasetorder = await deployAndGetDatasetorder(iexecUser);
    const workerpoolorder = await deployAndGetWorkerpoolorder(iexecUser);
    const requestorder = await getMatchableRequestorder(iexecUser, {
      apporder,
      datasetorder,
      workerpoolorder,
    });
    const apporderKyc = await deployAndGetApporder(iexec);
    const datasetorderKyc = await deployAndGetDatasetorder(iexec);
    const workerpoolorderKyc = await deployAndGetWorkerpoolorder(iexec);
    const requestorderKyc = await getMatchableRequestorder(iexec, {
      apporder: apporderKyc,
      datasetorder: datasetorderKyc,
      workerpoolorder: workerpoolorderKyc,
    });
    const [
      appHash,
      datasetHash,
      workerpoolHash,
      requestHash,
      appKycHash,
      datasetKycHash,
      workerpoolKycHash,
      requestKycHash,
    ] = await Promise.all([
      iexecUser.order.hashApporder(apporder),
      iexecUser.order.hashDatasetorder(datasetorder),
      iexecUser.order.hashWorkerpoolorder(workerpoolorder),
      iexecUser.order.hashRequestorder(requestorder),
      iexec.order.hashApporder(apporderKyc),
      iexec.order.hashDatasetorder(datasetorderKyc),
      iexec.order.hashWorkerpoolorder(workerpoolorderKyc),
      iexec.order.hashRequestorder(requestorderKyc),
    ]);
    await Promise.all([
      addApporders(chainId, [
        {
          orderHash: appHash,
          order: apporder,
          signer: userAddress,
        },
        {
          orderHash: appKycHash,
          order: apporderKyc,
          signer: defaultAddress,
        },
      ]),
      addDatasetorders(chainId, [
        {
          orderHash: datasetHash,
          order: datasetorder,
          signer: userAddress,
        },
        {
          orderHash: datasetKycHash,
          order: datasetorderKyc,
          signer: defaultAddress,
        },
      ]),
      addWorkerpoolorders(chainId, [
        {
          orderHash: workerpoolHash,
          order: workerpoolorder,
          signer: userAddress,
        },
        {
          orderHash: workerpoolKycHash,
          order: workerpoolorderKyc,
          signer: defaultAddress,
        },
      ]),
      addRequestorders(chainId, [
        {
          orderHash: requestHash,
          order: requestorder,
          signer: userAddress,
        },
        {
          orderHash: requestKycHash,
          order: requestorderKyc,
          signer: defaultAddress,
        },
      ]),
    ]);
    await revokeKYC(userAddress);
    await grantKYC(userAddress);
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
    await fastForwardToLastBlock(chainId, rpc);
    await replayPastOnly({ nbConfirmation: 0 });
    await sleep(PROCESS_TRIGGERED_EVENT_TIMEOUT);
    const [
      [savedApporder],
      [savedDatasetorder],
      [savedWorkerpoolorder],
      [savedRequestorder],
      [savedApporderKyc],
      [savedDatasetorderKyc],
      [savedWorkerpoolorderKyc],
      [savedRequestorderKyc],
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
      find(chainId, APPORDERS_COLLECTION, {
        orderHash: appKycHash,
      }),
      find(chainId, DATASETORDERS_COLLECTION, {
        orderHash: datasetKycHash,
      }),
      find(chainId, WORKERPOOLORDERS_COLLECTION, {
        orderHash: workerpoolKycHash,
      }),
      find(chainId, REQUESTORDERS_COLLECTION, {
        orderHash: requestKycHash,
      }),
    ]);
    expect(savedApporder.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorder.status).toBe(STATUS_MAP.OPEN);
    expect(savedApporderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedDatasetorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedWorkerpoolorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(savedRequestorderKyc.status).toBe(STATUS_MAP.OPEN);
    expect(socketEmitSpy).toHaveBeenCalledTimes(0);
  });
});
