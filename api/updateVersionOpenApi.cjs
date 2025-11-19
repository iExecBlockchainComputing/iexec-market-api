const path = require('path');
const { writeFile, readFile } = require('fs/promises');

const OPEN_API_SPECIFICATION_FILE = 'openapi.yaml';

async function updateVersionOpenApi() {
  const packagePath = path.join(__dirname, 'package.json');
  const packageContent = await readFile(packagePath, 'utf8');
  const packageJson = JSON.parse(packageContent);
  const packageVersion = packageJson.version;

  const openApiPath = path.join(__dirname, OPEN_API_SPECIFICATION_FILE);
  const openApiContent = await readFile(openApiPath, 'utf8');
  const openApiVersionPattern = /version: \d+\.\d+\.\d+(-\S+)?/;

  const [match] = openApiContent.match(openApiVersionPattern);

  const currentVersion = match.split('version: ')[1];
  if (currentVersion === packageVersion) {
    return;
  }
  const updatedContent = openApiContent.replace(
    openApiVersionPattern,
    `version: ${packageVersion}`,
  );
  await writeFile(openApiPath, updatedContent, 'utf8');
  console.log(
    `version updated from ${currentVersion} to ${packageVersion} in ${OPEN_API_SPECIFICATION_FILE}`,
  );
}

updateVersionOpenApi().catch((error) => {
  console.error('Error updating OpenAPI version:', error);
  process.exit(1);
});
