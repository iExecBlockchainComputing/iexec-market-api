import BN from 'bn.js';

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

const STATUS_MAP = {
  OPEN: 'open',
  FILLED: 'filled',
  CANCELED: 'canceled',
  DEAD: 'dead',
};

const TAG_MAP = {
  tee: 1,
  gpu: 9,
};

export { tagToArray, TAG_MAP, STATUS_MAP };
