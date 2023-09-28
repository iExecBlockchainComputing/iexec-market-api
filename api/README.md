# iexec-market-api/api

iExec marketplace API implementation

## Run

start databases

```sh
docker run --rm -p 27017:27017 mongo:latest
docker run --rm -p 6379:6379 redis:alpine redis-server --appendonly yes
```

configure blockchain access in `.env` file

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

- GET /challenge

  - query chainId\* address\*
  - response {ok, data:EIP712}

- GET /apporders/:orderHash

  - query chainId\*
  - response {ok, orderHash, order, remaining, status, publicationTimestamp} || 404

- GET /apporders

  - query chainId\* app\* | appOwner\* requester dataset workerpool minTag maxTag minVolume pageIndex pageSize (page _DEPRECATED_)
  - filter by app/requester/dataset/workerpool/appOwner/minTag/maxTag/maxPrice/minVolume
  - order by price asc + publicationTimestamp asc + orderHash asc
  - paginate pageIndex + pageSize
  - response {ok, orders: []{orderHash, order, remaining, status, publicationTimestamp}, count, ([nextPage] _DEPRECATED_)}

- POST /apporders

  - header authorization\*
  - query chainId\*
  - body {order}
  - response {ok, published: {orderHash, order, remaining, status, publicationTimestamp}}

- PUT /apporders

  - header authorization\*
  - query chainId\*
  - body {target:"unpublish_orderHash"|"unpublish_all"|"unpublish_last", orderHash|app}
  - response {ok, target, unpublished: [...orderHash]}

- GET /datasetorders/:orderHash

  - query chainId\*
  - response {ok, orderHash, order, remaining, status, publicationTimestamp} || 404

- GET /datasetorders

  - query chainId\* dataset\* | datasetOwner\* app requester workerpool minTag maxTag minVolume pageIndex pageSize (page _DEPRECATED_)
  - filter by dataset/app/requester/workerpool/datasetOwner/minTag/maxTag/maxPrice/minVolume
  - order by price asc + publicationTimestamp asc + orderHash asc
  - paginate pageIndex + pageSize
  - response {ok, orders: []{orderHash, order, remaining, status, publicationTimestamp}, count, ([nextPage] _DEPRECATED_)}

- POST /datasetorders

  - header authorization\*
  - query chainId\*
  - body {order}
  - response {ok, published: {orderHash, order, remaining, status, publicationTimestamp}}

- PUT /datasetorders

  - header authorization\*
  - query chainId\*
  - body {target:"unpublish_orderHash"|"unpublish_all"|"unpublish_last", orderHash|dataset}
  - response {ok, target, unpublished: [...orderHash]}

- GET /workerpoolorders/:orderHash

  - query chainId\*
  - response {ok, orderHash, order, remaining, status, publicationTimestamp} || 404

- GET /workerpoolorders

  - query chainId\* category workerpool workerpoolOwner app requester dataset minTag maxTag minTrust minVolume [maxPrice] page
  - filter by category/workerpool/app/requester/dataset/workerpoolOwner/minTag/maxTag/minTrust/minVolume [maxPrice]
  - order by price asc + publicationTimestamp asc + orderHash asc
  - paginate pageIndex + pageSize
  - response {ok, orders: []{orderHash, order, remaining, status, publicationTimestamp}, count, ([nextPage] _DEPRECATED_)}

- POST /workerpoolorders

  - header authorization\*
  - query chainId\*
  - body {order}
  - response {ok, published: {orderHash, order, remaining, status, publicationTimestamp}}

- PUT /workerpoolorders

  - header authorization\*
  - query chainId\*
  - body {target:"unpublish_orderHash"|"unpublish_all"|"unpublish_last", orderHash|workerpool}
  - response {ok, target, unpublished: [...orderHash]}

- GET /requestorders/:orderHash

  - query chainId\*
  - response {ok, orderHash, order, remaining, status, publicationTimestamp} || 404

- GET /requestorders

  - query chainId\* category requester beneficiary workerpool app dataset minTag maxTag maxTrust minVolume minPrice pageIndex pageSize (page _DEPRECATED_)
  - filter by category/requester/beneficiary/app/dataset/workerpool/minTag/maxTag/maxTrust/minVolume
  - order by workerpoolmaxprice desc + publicationTimestamp asc + orderHash asc
  - paginate pageIndex + pageSize
  - response {ok, orders: []{orderHash, order, remaining, status, publicationTimestamp}, count, ([nextPage] _DEPRECATED_)}

- POST /requestorders

  - header authorization\*
  - query chainId\*
  - body {order}
  - response {ok, published: {orderHash, order, remaining, status, publicationTimestamp}}

- PUT /requestorders

  - header authorization\*
  - query chainId\*
  - body {target:"unpublish_orderHash"|"unpublish_all"|"unpublish_last", orderHash|requester}
  - response {ok, target, unpublished: [...orderHash]}

- GET /categories/:catid

  - query chainId\*
  - response {ok, ...category}

- GET /categories

  - query chainId\* minWorkClockTimeRef maxWorkClockTimeRef pageIndex pageSize (page _DEPRECATED_)
  - filter by minWorkClockTimeRef/maxWorkClockTimeRef
  - order by workClockTimeRef asc + catid asc
  - paginate pageIndex + pageSize
  - response {ok, categories: []Category, count, ([nextPage] _DEPRECATED_)}

- GET /deals

  - query chainId\* category requester beneficiary workerpoolowner requestorderHash, apporderHash, datasetorderHash, workerpoolorderHash, workerpool app dataset pageIndex pageSize (page _DEPRECATED_)
  - filter by category/requester/beneficiary/workerpoolowner/apporderHash/ datasetorderHash/workerpoolorderHash/requestorderHash/workerpool/app/dataset
  - order by blocknumber desc + dealid asc
  - paginate pageIndex + pageSize
  - response {ok, deals:[]Deal, count, ([nextPage] _DEPRECATED_)}

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
