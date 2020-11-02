const ethers = require('ethers');
const BN = require('bn.js');
const { chains } = require('../config');

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
const NULL_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

const getContract = (contractName, chainId, { at } = {}) => {
  const chain = chains[chainId];
  const provider = ethers.getDefaultProvider(chain.host);
  let address;
  if (contractName === 'hub') {
    address = chain.hubAddress;
  } else {
    address = at;
  }
  if (!address) {
    throw Error(
      `Missing address for contract ${contractName} on chain ${chainId}`,
    );
  }
  const abi = chain.abi[contractName];
  if (!address) throw Error(`Missing abi for contract ${contractName} on chain ${chainId}`);
  const contract = new ethers.Contract(address, abi, provider);
  return contract;
};

const ethersBnToBn = ethersBn => new BN(ethersBn.toString());

module.exports = {
  NULL_ADDRESS,
  NULL_BYTES32,
  getContract,
  ethersBnToBn,
};
