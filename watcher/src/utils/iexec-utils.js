import { toBeHex, getAddress } from 'ethers';

const tokenIdToAddress = (tokenId) => {
  const lowerCaseAddress = toBeHex(tokenId, 20);
  return getAddress(lowerCaseAddress);
};

const tagToArray = (tag) => {
  const tagBinString = BigInt(tag).toString(2);
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

const STATUS_MAP = {
  OPEN: 'open',
  FILLED: 'filled',
  CANCELED: 'canceled',
  DEAD: 'dead',
};

export { tokenIdToAddress, tagToArray, TAG_MAP, STATUS_MAP };
