const BN = require('bn.js');
const {
  OPEN,
  FILLED,
  CANCELED,
  DEAD,
  UNPUBLISH_ORDERHASH,
  UNPUBLISH_LAST,
  UNPUBLISH_ALL,
} = require('./keywords');

const OBJ_MAP = {
  EIP712Domain: {
    primaryType: 'EIP712Domain',
    structMembers: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
  },
  apporder: {
    collectionName: 'apporders',
    primaryType: 'AppOrder',
    structMembers: [
      { name: 'app', type: 'address' },
      { name: 'appprice', type: 'uint256' },
      { name: 'volume', type: 'uint256' },
      { name: 'tag', type: 'bytes32' },
      { name: 'datasetrestrict', type: 'address' },
      { name: 'workerpoolrestrict', type: 'address' },
      { name: 'requesterrestrict', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    addressField: 'app',
    resourceName: 'app',
    priceField: 'appprice',
    requestPriceField: 'appmaxprice',
    contractName: 'app',
    registryName: 'appregistry',
  },
  datasetorder: {
    collectionName: 'datasetorders',
    primaryType: 'DatasetOrder',
    structMembers: [
      { name: 'dataset', type: 'address' },
      { name: 'datasetprice', type: 'uint256' },
      { name: 'volume', type: 'uint256' },
      { name: 'tag', type: 'bytes32' },
      { name: 'apprestrict', type: 'address' },
      { name: 'workerpoolrestrict', type: 'address' },
      { name: 'requesterrestrict', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    addressField: 'dataset',
    resourceName: 'dataset',
    priceField: 'datasetprice',
    requestPriceField: 'datasetmaxprice',
    contractName: 'dataset',
    registryName: 'datasetregistry',
  },
  workerpoolorder: {
    collectionName: 'workerpoolorders',
    primaryType: 'WorkerpoolOrder',
    structMembers: [
      { name: 'workerpool', type: 'address' },
      { name: 'workerpoolprice', type: 'uint256' },
      { name: 'volume', type: 'uint256' },
      { name: 'tag', type: 'bytes32' },
      { name: 'category', type: 'uint256' },
      { name: 'trust', type: 'uint256' },
      { name: 'apprestrict', type: 'address' },
      { name: 'datasetrestrict', type: 'address' },
      { name: 'requesterrestrict', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    addressField: 'workerpool',
    contractName: 'workerpool',
    registryName: 'workerpoolregistry',
  },
  requestorder: {
    collectionName: 'requestorders',
    primaryType: 'RequestOrder',
    structMembers: [
      { name: 'app', type: 'address' },
      { name: 'appmaxprice', type: 'uint256' },
      { name: 'dataset', type: 'address' },
      { name: 'datasetmaxprice', type: 'uint256' },
      { name: 'workerpool', type: 'address' },
      { name: 'workerpoolmaxprice', type: 'uint256' },
      { name: 'requester', type: 'address' },
      { name: 'volume', type: 'uint256' },
      { name: 'tag', type: 'bytes32' },
      { name: 'category', type: 'uint256' },
      { name: 'trust', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'callback', type: 'address' },
      { name: 'params', type: 'string' },
      { name: 'salt', type: 'bytes32' },
    ],
    addressField: 'requester',
  },
};

const STATUS_MAP = {
  OPEN,
  FILLED,
  CANCELED,
  DEAD,
};

const UNPUBLISH_TARGET_MAP = {
  ORDERHASH: UNPUBLISH_ORDERHASH,
  LAST: UNPUBLISH_LAST,
  ALL: UNPUBLISH_ALL,
};

const TAG_MAP = {
  tee: 1,
  gpu: 9,
};

const tagToArray = (tag) => {
  const tagBinString = new BN(tag.substr(2), 'hex').toString(2);
  const bitsArray = [];
  for (let i = 1; i <= tagBinString.length; i += 1) {
    if (tagBinString.charAt(tagBinString.length - i) === '1') {
      bitsArray.push(i);
    }
  }
  return bitsArray;
};

const excludeTagArray = (tagArray) => {
  const excluded = new Array(256)
    .fill(null)
    .map((e, i) => {
      if (!tagArray.includes(i + 1)) return i + 1;
      return null;
    })
    .filter((e) => e !== null);
  return excluded;
};

module.exports = {
  OBJ_MAP,
  STATUS_MAP,
  TAG_MAP,
  UNPUBLISH_TARGET_MAP,
  tagToArray,
  excludeTagArray,
};
