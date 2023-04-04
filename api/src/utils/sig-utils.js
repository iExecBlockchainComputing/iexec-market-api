// use experimental ether utils._TypedDataEncoder (to remove when TypedDataEncoder is included)
// https://docs.ethers.io/v5/api/utils/hashing/#TypedDataEncoder
const { recoverAddress, _TypedDataEncoder: TypedDataEncoder } =
  require('ethers').utils;
const { logger } = require('./logger');

const log = logger.extend('utils:sig-utils');

const hashEIP712 = (typedData) => {
  try {
    const { domain, message } = typedData;
    const { EIP712Domain, ...types } = typedData.types;
    return TypedDataEncoder.hash(domain, types, message);
  } catch (error) {
    log('hashEIP712()', error);
    throw error;
  }
};

const recoverAddressEIP712 = (typedData, signature) => {
  const digest = hashEIP712(typedData);
  const signerAddress = recoverAddress(digest, signature);
  return signerAddress;
};

module.exports = {
  hashEIP712,
  recoverAddressEIP712,
};
