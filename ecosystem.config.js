'use strict';

module.exports = {
  apps: [
    {
      name: 'wasl-bot',
      script: 'src/app.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '550M',
      restart_delay: 4000,
      exp_backoff_restart_delay: 200,
      env: {
        NODE_ENV: 'production',
      },
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
