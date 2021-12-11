const app = require('./app');
const { logger } = require('./utils/logger');
const { serverPort } = require('./config');

app.listen(serverPort);
logger(`Server listening on port ${serverPort}`);
