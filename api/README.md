# iexec-market-api/api

iExec marketplace API implementation

## Run

start databases

```sh
docker run --rm -p 27017:27017 mongo:latest
docker run --rm -p 6379:6379 redis:alpine redis-server --appendonly yes
```

configure blockchain access in `.env` file (see [.env.template](.env.template))

```text
## enabled chains (comma separated names: ARBITRUM_MAINNET,ARBITRUM_SEPOLIA_TESTNET)
CHAINS=ARBITRUM_MAINNET
## configure the ethereum RPC endpoint for each enabled chain
ARBITRUM_MAINNET_ETH_RPC_HOST=https://my-node:8545
```

install dependencies

```sh
npm i
npm run codegen
```

start project

```sh
npm start
```

## Test

start the test stack (mongo, redis, local chain and SMS)

```sh
npm run start-test-stack
```

install dependencies and run tests

```sh
npm ci
npm run codegen
npm test
```

stop the test stack

```sh
npm run stop-test-stack
```

## API

The API is documented with [OpenAPI](./openapi.yaml).

A swagger interface is exposed under the `/docs` endpoint.

## Socket.IO

rooms:

- `${chainId}:${topic}` with topic `'orders' | 'deals'` (join by emitting `join` with `{ chainId, topic }`)

orders events:

- `apporder_published`: order
- `apporder_updated`: order
- `apporder_unpublished`: orderHash
- `datasetorder_published`: order
- `datasetorder_updated`: order
- `datasetorder_unpublished`: orderHash
- `workerpoolorder_published`: order
- `workerpoolorder_updated`: order
- `workerpoolorder_unpublished`: orderHash
- `requestorder_published`: order
- `requestorder_updated`: order
- `requestorder_unpublished`: orderHash

deals events:

- `deal_created`: deal

> `*_updated` and `deal_created` events are emitted by the [watcher](../watcher/README.md) when on-chain events are processed.
