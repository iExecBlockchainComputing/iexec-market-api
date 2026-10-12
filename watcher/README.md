# iexec-market-watcher

Watch events emitted by iexec smart contracts and update market database

## Run

start databases

```sh
docker run --rm -p 27017:27017 mongo:latest
docker run --rm -p 6379:6379 redis:alpine redis-server --appendonly yes
```

configure blockchain access in `.env` file (see [.env.template](.env.template))

```text
## chain to watch (ARBITRUM_MAINNET or ARBITRUM_SEPOLIA_TESTNET)
CHAIN=ARBITRUM_MAINNET
## configure the ethereum websocket and RPC endpoints (archive nodes required)
ETH_WS_HOST=wss://my-node:8546
ETH_RPC_HOST=https://my-node:8545
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

## Known issues

### First synchronization error

When the watcher synchronizes from scratch, the data retrieved from the blockchain is huge. Some RPC providers limit the response size, which can prevent the first synchronization from succeeding.
Use `BLOCKS_BATCH_SIZE` (default `1000`) to tune the maximum number of blocks synced per request: lower it if your RPC provider rejects large responses.
