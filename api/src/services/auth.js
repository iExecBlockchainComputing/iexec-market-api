import randomstring from 'randomstring';
import * as challengeModel from '../models/challengeModel.js';
import { logger } from '../utils/logger.js';
import { throwIfMissing, AuthError } from '../utils/error.js';
import { hashEIP712, recoverAddressEIP712 } from '../utils/sig-utils.js';
import { NULL_ADDRESS } from '../utils/eth-utils.js';
import { addressSchema } from '../utils/validator.js';

const log = logger.extend('services:auth');

log('instantiating service');

const getEIP712 = (chainId, challengeValue) => ({
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
});

const getChallengeText = (value) =>
  'Sign this message to log into iExec Gateway: '.concat(value);

const getChallenge = async ({
  chainId = throwIfMissing(),
  address = throwIfMissing(),
} = {}) => {
  try {
    const ChallengeModel = await challengeModel.getModel(chainId);
    const current = await ChallengeModel.findOne({ address });
    if (current) {
      const challengeText = getChallengeText(current.value);
      return getEIP712(chainId, challengeText);
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
    const address = await addressSchema().validate(authArray[2]);
    if (address === NULL_ADDRESS) throw new AuthError('Null address');
    const ChallengeModel = await challengeModel.getModel(chainId).catch(() => {
      throw new AuthError('Invalid authorization');
    });
    const current = await ChallengeModel.findOne({
      hash,
      address,
    });
    if (!current || !current.value) {
      throw new AuthError(
        'Challenge not valid. Need to request a new challenge.',
      );
    }
    const typedData = getEIP712(chainId, getChallengeText(current.value));
    const signerAddress = recoverAddressEIP712(typedData, signature);
    if (signerAddress === NULL_ADDRESS) throw Error('Null signerAddress');
    log('signerAddress', signerAddress);
    if (signerAddress.toLowerCase() !== address.toLowerCase())
      throw new AuthError('Failed to verify signer, addresses mismatch.');
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

export { getChallenge, checkAuthorization };
