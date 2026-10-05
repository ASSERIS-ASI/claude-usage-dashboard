module.exports = {
  apps: [{
    name: 'claude-usage-dashboard',
    cwd: __dirname,
    script: 'dashboard.js',
    instances: 1,
    exec_mode: 'fork',
    windowsHide: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};