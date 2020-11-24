const ethers = require('ethers');
const BN = require('bn.js');

const tokenIdToAddress = (tokenId) => {
  const hexTokenId = ethers.BigNumber.from(tokenId.toString()).toHexString();
  const lowerCaseAddress = ethers.utils.hexZeroPad(hexTokenId, 20);
  return ethers.utils.getAddress(lowerCaseAddress);
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

const TAG_MAP = {
  tee: 1,
  gpu: 9,
};

const STANDARD_FLAVOUR = 'standard';
const ENTERPRISE_FLAVOUR = 'enterprise';
const FLAVOURS = [STANDARD_FLAVOUR, ENTERPRISE_FLAVOUR];

const isEnterpriseFlavour = flavour => flavour === ENTERPRISE_FLAVOUR;

const KYC_MEMBER_ROLE = '0xce55f595624c86c7e93aa4cf15cb4a958406550ae728a9b7ffda71a7d62eca73';

module.exports = {
  tokenIdToAddress,
  tagToArray,
  TAG_MAP,
  FLAVOURS,
  STANDARD_FLAVOUR,
  ENTERPRISE_FLAVOUR,
  isEnterpriseFlavour,
  KYC_MEMBER_ROLE,
};
