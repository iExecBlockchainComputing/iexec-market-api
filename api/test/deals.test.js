import { beforeAll, afterAll, expect, test } from '@jest/globals';
import supertest from 'supertest';
import application from '../src/app.js';
import { chains } from '../src/config.js';
import {
  parseResult,
  buildQuery,
  dropDB,
  addDeals,
  getRandomAddress,
} from './test-utils.js';

const OK_STATUS = 200;
const VALIDATION_ERROR_STATUS = 400;

const [chainName] = Object.keys(chains);

const chainId = chains[chainName].id;

const request = supertest(application);

beforeAll(async () => {
  application.listen();
});

afterAll(async () => {
  application.close();
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
        expect(data.error).toBe('pageSize must be greater than or equal to 10');
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
        expect(data.error).toBe('pageSize must be less than or equal to 1000');
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
        expect(data.error).toBe('pageIndex must be greater than or equal to 0');
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
