import { beforeAll, afterAll, expect, test } from '@jest/globals';
import supertest from 'supertest';
import application from '../src/app.js';
import { chains } from '../src/config.js';
import {
  parseResult,
  buildQuery,
  dropDB,
  addCategories,
} from './test-utils.js';

const OK_STATUS = 200;
const VALIDATION_ERROR_STATUS = 400;
const NOT_FOUND_ERROR_STATUS = 404;

const [chainName] = Object.keys(chains);

const chainId = chains[chainName].id;

const request = supertest(application);

beforeAll(async () => {
  application.listen();
});

afterAll(async () => {
  application.close();
});

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
        expect(data.error).toBe('pageSize must be greater than or equal to 10');
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
        expect(data.error).toBe('pageSize must be less than or equal to 1000');
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
        expect(data.error).toBe('pageIndex must be greater than or equal to 0');
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
