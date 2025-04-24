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
## configure the ethereum RPC endpoint
# MAINNET_ETH_RPC_HOST=https://mainnet-node:8545
```

install dependencies

```sh
npm i
```

start project

```sh
npm start
```

## Test

```sh
docker-compose -f test/docker-compose.yml up -d
npm ci
npm test
```

## API

The API is documented with [OpenAPI](./openapi.yaml).

A swagger interface is exposed under the `/docs` endpoint.

## Socket.IO

rooms:

- chainId
- topic: 'orders' | 'deals'

orders events:

- `apporder_published`: order
- `apporder_published`: order
- `apporder_unpublished`: orderHash
- `datasetorder_published`: order
- `datasetorder_published`: order
- `datasetorder_unpublished`: orderHash
- `workerpoolorder_published`: order
- `workerpoolorder_published`: order
- `workerpoolorder_unpublished`: orderHash
- `requestorder_published`: order
- `requestorder_published`: order
- `requestorder_unpublished`: orderHash

deals events:

- `deal_created`: deal
