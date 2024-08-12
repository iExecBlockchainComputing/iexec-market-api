const { start, server } = require('./app');
const { serverPort } = require('./config');
const { getLogger, APP_NAMESPACE } = require('./utils/logger');
const logger = getLogger(APP_NAMESPACE);

server.listen(serverPort);
logger.log(`Server listening on port ${serverPort}`);

start();
