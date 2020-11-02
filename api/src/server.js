const app = require('./app');
const { logger } = require('./utils/logger');

const PORT = 3000;

app.listen(PORT);
logger(`Server listening on port ${PORT}`);
