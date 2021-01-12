const STANDARD_FLAVOUR = 'standard';
const ENTERPRISE_FLAVOUR = 'enterprise';
const FLAVOURS = [STANDARD_FLAVOUR, ENTERPRISE_FLAVOUR];

const isEnterpriseFlavour = (flavour) => flavour === ENTERPRISE_FLAVOUR;

module.exports = {
  FLAVOURS,
  STANDARD_FLAVOUR,
  ENTERPRISE_FLAVOUR,
  isEnterpriseFlavour,
};
