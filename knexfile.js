require('dotenv').config();

module.exports = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL || {
      host: '127.0.0.1',
      port: 5432,
      user: 'tournament_bot',
      password: 'tournament_bot_pwd_2026',
      database: 'tournament_bot',
    },
    migrations: {
      directory: './migrations',
    },
    pool: {
      min: 2,
      max: 10,
    },
  },

  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL || {
      host: '127.0.0.1',
      port: 5432,
      user: 'tournament_bot',
      password: 'tournament_bot_pwd_2026',
      database: 'tournament_bot',
    },
    migrations: {
      directory: './migrations',
    },
    pool: {
      min: 2,
      max: 10,
    },
  },
};
