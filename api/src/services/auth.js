const randomstring = require('randomstring');
const challengeModel = require('../models/challengeModel');
const { logger } = require('../utils/logger');
const { throwIfMissing, AuthError } = require('../utils/error');
const { hashEIP712, recoverAddressEIP712 } = require('../utils/sig-utils');
const { NULL_ADDRESS } = require('../utils/eth-utils');

const log = logger.extend('services:auth');

log('instanciating service');

const getEIP712 = (chainId, challengeValue) => {
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      Challenge: [{ name: 'challenge', type: 'string' }],
    },
    domain: {
      name: 'iExec Gateway',
      version: '1',
      chainId,
    },
    primaryType: 'Challenge',
    message: {
      challenge: challengeValue,
    },
  };
  return typedData;
};

const getChallengeText = (value) => 'Sign this message to log into iExec Gateway: '.concat(value);

const getChallenge = async ({
  chainId = throwIfMissing(),
  address = throwIfMissing(),
} = {}) => {
  try {
    const ChallengeModel = await challengeModel.getModel(chainId);
    const current = await ChallengeModel.findOne({ address });
    if (current) {
      const challengeText = getChallengeText(current.value);
      const typedData = getEIP712(chainId, challengeText);
      return typedData;
    }
    const value = randomstring.generate();
    const challengeText = getChallengeText(value);
    const typedData = getEIP712(chainId, challengeText);
    const hash = hashEIP712(typedData);
    const challenge = new ChallengeModel({
      address,
      hash,
      value,
    });
    await challenge.save();
    return typedData;
  } catch (e) {
    log('getChallenge() error', e);
    throw e;
  }
};

const checkAuthorization = async ({
  chainId = throwIfMissing(),
  authorization = throwIfMissing(),
}) => {
  try {
    const authArray = authorization.split('_');
    const hash = authArray[0];
    const signature = authArray[1];
    const address = authArray[2];
    if (address === NULL_ADDRESS) throw new AuthError('Null address');
    const ChallengeModel = await challengeModel.getModel(chainId);
    const current = await ChallengeModel.findOne({ hash });
    if (!current || !current.value || !current.address) {
      throw new AuthError(
        'Challenge not valid. Need to request a new challenge.',
      );
    }
    const typedData = getEIP712(chainId, getChallengeText(current.value));
    const signerAddress = recoverAddressEIP712(typedData, signature);
    if (signerAddress === NULL_ADDRESS) throw Error('Null signerAddress');
    log('signerAddress', signerAddress);
    if (signerAddress.toLowerCase() !== address.toLowerCase()) throw new AuthError('Failed to verify signer, addresses mismatch.');
    await current.remove();
    return {
      address,
      chainId,
    };
  } catch (e) {
    log('checkAuthorization() error', e);
    throw e;
  }
};

module.exports = {
  getChallenge,
  checkAuthorization,
};
