import { TypedDataEncoder, recoverAddress } from 'ethers';
import { logger } from './logger.js';

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
  return recoverAddress(digest, signature);
};

export { hashEIP712, recoverAddressEIP712 };
