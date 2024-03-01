# CHANGELOG

## Next

- fix openapi for `GET /requestorders`

## v6.4.0

- add new filters to retrieve orders on strict or non-strict assets authorization, excluding or including orders with "any" asset authorized for GET `/apporders`, `/datasetorders`, `/workerpoolorders`, `/requestorders`

## v6.3.0

- changed API pagination
  - paginable requests now have optional params `pageSize` (min `10`, max `1000`, default `20`) and `pageIndex` (default `0`)
  - \[DEPRECATED\] the legacy `page` param is deprecated
- added OpenAPI spec for the API
- added a `/docs` endpoint hosting a Swagger UI

## v6.2.0

- add `"any"` as allowed keyword wherever an address was expected for GET `/apporders`, `/datasetorders`, `/workerpoolorders`, `/requestorders`

## v6.1.0

- add `"any"` as allowed keyword on restrict filtering fields for GET `/apporders`, `/datasetorders`, `/workerpoolorders`
- add `"any"` as allowed keyword on workerpool filtering field for GET `/requestorders`

## v6.0.0

- \[BREAKING\] removed mainnet, viviani and goerli default configuration
- \[BREAKING\] CREATE_INDEX default value is now set to `true` to create DB indexes by default
- \[BREAKING\] BLOCKS_BATCH_SIZE default value is now set to `1000` to better adapt to bellecour indexation
- better tracking of indexed block number
- start replayer before initial synchro's end to achieve faster checkpoint sync
- fix avoid multiple replay of past events running simultaneous on an overlapping range
- fix avoid checkpoint further than last indexed block
- fix avoid possible clunky state on ws close recover
- fix typos
- update dependencies

## v5.3.1

- use ethers implementation for EIP712 hash
- fix prevent a user to consume a challenge generated for another user

## v5.3.0

- added custom value for maximum orders per wallet with env `MAX_OPEN_ORDERS_PER_WALLET`
- added custom value for server port with env `PORT`
- dependencies update
- upgrade to node 16 & npm 8

## v5.2.1

- dependencies update

## v5.2.0

- added enterprise flavour with eRlc whitelist checks

## v5.1.0 initial release
