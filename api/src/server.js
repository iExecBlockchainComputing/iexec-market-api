import app from './app.js';
import { logger } from './utils/logger.js';
import { serverPort } from './config.js';

app.listen(serverPort);
logger(`Server listening on port ${serverPort}`);
