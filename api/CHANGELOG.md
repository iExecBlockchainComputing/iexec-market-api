# CHANGELOG

## [7.1.0](https://github.com/iExecBlockchainComputing/iexec-market-api/compare/iexec-market-api-v7.0.0...iexec-market-api-v7.1.0) (2025-10-14)


### Added

* add support for dataset bulk orders ([#38](https://github.com/iExecBlockchainComputing/iexec-market-api/issues/38)) ([edd32cc](https://github.com/iExecBlockchainComputing/iexec-market-api/commit/edd32ccad62735698cc033e36ab229a57a4b8fa7))

## [7.0.0](https://github.com/iExecBlockchainComputing/iexec-market-api/compare/iexec-market-api-v6.4.1...iexec-market-api-v7.0.0) (2025-09-30)


### ⚠ BREAKING CHANGES

* iExec Enterprise (eRLC) is no longer supported

### Added

* add engines requirements ([df420fd](https://github.com/iExecBlockchainComputing/iexec-market-api/commit/df420fd442ef2d3bad09ef983cb288dfa51ea114))
* raise orders volume limit to MAX_SAFE_INTEGER ([#36](https://github.com/iExecBlockchainComputing/iexec-market-api/issues/36)) ([549a6f8](https://github.com/iExecBlockchainComputing/iexec-market-api/commit/549a6f88017a4d4a73c106cf83ce8d9c71d22087))


### Changed

* **api:** resolve mongoose connection race condition with asPromise() ([b52a1db](https://github.com/iExecBlockchainComputing/iexec-market-api/commit/b52a1db580ea46dc21dfc45e0acc66d9e81268f4))
* avoid possible withdraw 0 in tests ([e652743](https://github.com/iExecBlockchainComputing/iexec-market-api/commit/e6527436d6a4a3cc5800b3661d3c8f7325c3f42e))
* set default value for BELLECOUR_IEXEC_ADDRESS ([9e0c7bd](https://github.com/iExecBlockchainComputing/iexec-market-api/commit/9e0c7bdfafb61adc51d3f56624bb389e33c244fc))


### Misc

* migrate codebase to esm (migrate to iexec v8 + drop enterprise) ([bd9b536](https://github.com/iExecBlockchainComputing/iexec-market-api/commit/bd9b53695617c43e39ffeb0c005f2e5c6f449559))

## v6.4.1

* fix openapi for `GET /requestorders`

## v6.4.0

* add new filters to retrieve orders on strict or non-strict assets authorization, excluding or including orders with "any" asset authorized for GET `/apporders`, `/datasetorders`, `/workerpoolorders`, `/requestorders`

## v6.3.0

* changed API pagination
  * paginable requests now have optional params `pageSize` (min `10`, max `1000`, default `20`) and `pageIndex` (default `0`)
  * \[DEPRECATED\] the legacy `page` param is deprecated
* added OpenAPI spec for the API
* added a `/docs` endpoint hosting a Swagger UI

## v6.2.0

* add `"any"` as allowed keyword wherever an address was expected for GET `/apporders`, `/datasetorders`, `/workerpoolorders`, `/requestorders`

## v6.1.0

* add `"any"` as allowed keyword on restrict filtering fields for GET `/apporders`, `/datasetorders`, `/workerpoolorders`
* add `"any"` as allowed keyword on workerpool filtering field for GET `/requestorders`

## v6.0.0

* \[BREAKING\] removed mainnet, viviani and goerli default configuration
* \[BREAKING\] CREATE_INDEX default value is now set to `true` to create DB indexes by default
* \[BREAKING\] BLOCKS_BATCH_SIZE default value is now set to `1000` to better adapt to bellecour indexation
* better tracking of indexed block number
* start replayer before initial synchro's end to achieve faster checkpoint sync
* fix avoid multiple replay of past events running simultaneous on an overlapping range
* fix avoid checkpoint further than last indexed block
* fix avoid possible clunky state on ws close recover
* fix typos
* update dependencies

## v5.3.1

* use ethers implementation for EIP712 hash
* fix prevent a user to consume a challenge generated for another user

## v5.3.0

* added custom value for maximum orders per wallet with env `MAX_OPEN_ORDERS_PER_WALLET`
* added custom value for server port with env `PORT`
* dependencies update
* upgrade to node 16 & npm 8

## v5.2.1

* dependencies update

## v5.2.0

* added enterprise flavour with eRlc whitelist checks

## v5.1.0 initial release
