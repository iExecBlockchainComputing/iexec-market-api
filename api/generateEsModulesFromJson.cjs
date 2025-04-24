const path = require('path');
const { writeFile, stat, mkdir } = require('fs/promises');

const minifiers = {
  package: ({ name, version, description }) => ({ name, version, description }),
  abi: ({ abi }) => ({ abi }),
  truffleDeployment: ({ abi, networks }) => ({
    abi,
    networks: Object.fromEntries(
      Object.entries(networks).map(([chainId, { address }]) => [
        chainId,
        { address },
      ]),
    ),
  }),
  hardhatDeployment: ({ address }) => ({ address }),
};

const sources = [
  [
    './package.json',
    {
      dir: 'api',
      minifier: minifiers.package,
    },
  ],
  [
    '@iexec/poco/artifacts/contracts/registries/RegistryEntry.sol/RegistryEntry.json',
    { dir: '@iexec/poco', minifier: minifiers.abi },
  ],
  [
    '@iexec/poco/artifacts/contracts/IexecInterfaceToken.sol/IexecInterfaceToken.json',
    { dir: '@iexec/poco', minifier: minifiers.abi },
  ],
  [
    '@iexec/poco/artifacts/contracts/IexecInterfaceNative.sol/IexecInterfaceNative.json',
    { dir: '@iexec/poco', minifier: minifiers.abi },
  ],
  [
    '@iexec/poco/artifacts/contracts/registries/apps/AppRegistry.sol/AppRegistry.json',
    { dir: '@iexec/poco', minifier: minifiers.abi },
  ],
  [
    '@iexec/poco/artifacts/contracts/registries/workerpools/WorkerpoolRegistry.sol/WorkerpoolRegistry.json',
    { dir: '@iexec/poco', minifier: minifiers.abi },
  ],
  [
    '@iexec/poco/artifacts/contracts/registries/datasets/DatasetRegistry.sol/DatasetRegistry.json',
    { dir: '@iexec/poco', minifier: minifiers.abi },
  ],
  [
    '@iexec/poco/artifacts/contracts/registries/apps/App.sol/App.json',
    { dir: '@iexec/poco', minifier: minifiers.abi },
  ],
  [
    '@iexec/poco/artifacts/contracts/registries/workerpools/Workerpool.sol/Workerpool.json',
    { dir: '@iexec/poco', minifier: minifiers.abi },
  ],
  [
    '@iexec/poco/artifacts/contracts/registries/datasets/Dataset.sol/Dataset.json',
    { dir: '@iexec/poco', minifier: minifiers.abi },
  ],
];

const createEsModule = (jsonObj) => {
  let module = '// this file is auto generated do not edit it\n\n';
  Object.entries(jsonObj).forEach(([key, value]) => {
    module += `export const ${key} = ${JSON.stringify(value)};\n`;
  });
  module += `export default { ${Object.keys(jsonObj).join(', ')} };`;
  return module;
};

console.log('converting json files to es modules');

sources.map(async ([src, options]) => {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const jsonObj = require(src);
  const minifiedJsonObj = options.minifier
    ? options.minifier(jsonObj)
    : jsonObj;
  const name =
    (options && options.name) ||
    `${src.split('/').pop().split('.json').shift()}.js`;
  const module = createEsModule(minifiedJsonObj);
  const outDir = path.join(`src/generated`, options && options.dir);

  const outDirExists = await stat(outDir)
    .then((outDirStat) => outDirStat.isDirectory())
    .catch(() => false);
  if (!outDirExists) {
    await mkdir(outDir, {
      recursive: true,
    });
  }
  const outPath = path.join(outDir, name);
  await writeFile(outPath, module);
  console.log(`${src} => ${outPath}`);
});
