import { afterAll, expect, test, jest } from '@jest/globals';
import supertest from 'supertest';
import application from '../src/app.js';

import { parseResult } from './test-utils.js';

// jest config
jest.setTimeout(2 * 60 * 1000);

const OK_STATUS = 200;

application.listen();
const request = supertest(application);

afterAll(async () => {
  application.close();
});

test('GET /version', async () => {
  const { data, status } = await request.get('/version').then(parseResult);
  expect(status).toBe(OK_STATUS);
  expect(data.ok).toBe(true);
  expect(data.version).toBeDefined();
});
