// loaders/mongoose.js
import mongoose from 'mongoose';
import { mongo as mongoConfig } from '../config.js';
import { logger } from '../utils/logger.js';

// Important for compatibility with Mongoose v8+
// Prevents strict query errors when filtering by fields not in schema
mongoose.set('strictQuery', false);

const log = logger.extend('mongoose');

// Cache for connections
const mongooseConnections = {};

/**
 * Returns a Mongoose connection for a given server and db name.
 * Caches connections for reuse across calls.
 */
const getMongoose = async ({ server = mongoConfig.host, db } = {}) => {
  if (!db) throw new Error('Missing db name');

  // Return existing connection if present
  if (mongooseConnections[server]?.[db]) {
    log(`Using cached connection: ${server}${db}`);
    return mongooseConnections[server][db];
  }

  log(`Creating new connection: ${server}${db}`);
  const uri = `${server}${db}`;
  const connection = mongoose.createConnection(uri, {
    // Removed deprecated options
    // useNewUrlParser and useUnifiedTopology are defaults in Mongoose 8+

    autoIndex: mongoConfig.createIndex ?? false, // Create indexes if needed
    autoCreate: true, // Ensure collections are auto-created
    bufferCommands: false, // ❗ Important for strict connection behavior in Mongoose 8+
  });

  // Cache the connection
  mongooseConnections[server] = mongooseConnections[server] || {};
  mongooseConnections[server][db] = connection;

  // Return promise that resolves once connected
  return new Promise((resolve, reject) => {
    connection.once('open', () => {
      log(`Connected to ${server}${db}`);
      resolve(connection);
    });

    connection.on('error', (err) => {
      log(`Connection error on ${server}${db}:`, err);
      reject(err);
    });
  });
};

export { getMongoose };
