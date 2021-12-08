# iexec-market-watcher

Watch events emitted by iexec smart contracts and update market database

## Run

start databases

```sh
docker run --rm -p 27017:27017 mongo:latest
docker run --rm -p 6379:6379 redis:alpine redis-server --appendonly yes
```

configure blockchain access in `.env` file (infura, alchemy or custom node)

```text
## configure the ethereum websocket and RPC endpoints
# ETH_WS_HOST=wss://goerli-node:8546
# ETH_RPC_HOST=https://goerli-node:8545

## or set INFURA_PROJECT_ID to access public chains through infura.io
# INFURA_PROJECT_ID=abcdef1234567890

## or set ALCHEMY_API_KEY to access public chains through alchemyapi.io
# ALCHEMY_API_KEY=myKey
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

## Monitor jobs

```sh
npx agendash --db=mongodb://localhost:27017/65535_jobs --port=8080
```

## Known issues

### First synchronization error

When the watcher synchronize from scratch, the data retrieved from the blockchain is huge. Some RPC providers limit the response size and can prevent the first synchronization to succeed.
For example with Infura you can get an `Error: query returned more than 10000 results`.
Use `BLOCKS_BATCH_SIZE` to limit the maximal number of blocks synced per request.
