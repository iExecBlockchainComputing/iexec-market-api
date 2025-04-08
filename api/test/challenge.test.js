import { beforeAll, afterAll, expect, test } from '@jest/globals';
import supertest from 'supertest';
import application from '../src/app.js';
import { chains } from '../src/config.js';
import { parseResult, buildQuery } from './test-utils.js';

const OK_STATUS = 200;

const [chainName] = Object.keys(chains);

const chainId = chains[chainName].id;

const request = supertest(application);

beforeAll(async () => {
  application.listen();
});

afterAll(async () => {
  application.close();
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
