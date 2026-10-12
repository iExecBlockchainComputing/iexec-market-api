# iExec Market API

## overview

### api

Allow offchain order sharing

See [API readme](api/README.md) for more details.

### watcher

Watch events emitted by iexec smart contracts and update market database

See [Watcher readme](watcher/README.md) for more details.

## Run with docker

configure blockchain access in `.env` file (see [.env.template](.env.template))

start the stack with published images

```sh
docker compose up -d
```

or build images from local sources (Arbitrum Sepolia testnet)

```sh
docker compose -f docker-compose-dev.yml up -d --build
```
