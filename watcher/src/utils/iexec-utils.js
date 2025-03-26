import ethers from 'ethers';
import BN from 'bn.js';

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

export { tokenIdToAddress, tagToArray, TAG_MAP };
