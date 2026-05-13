const fs = require('fs');
const tokenFile = require('os').homedir() + '/.config/op/service-account-token';
const opToken = fs.readFileSync(tokenFile, 'utf8').trim().split('=').slice(1).join('=');

module.exports = {
  apps: [
    {
      name: 'concrnt2SNS',
      script: 'op',
      args: 'run --env-file .env -- npm start',
      cwd: '/home/taro/aihome/concrnt2SNS',
      env: {
        OP_SERVICE_ACCOUNT_TOKEN: opToken,
      },
      min_uptime: 60000,
      max_restarts: 10,
      restart_delay: 30000,
      exp_backoff_restart_delay: 100,
    }
  ]
}
