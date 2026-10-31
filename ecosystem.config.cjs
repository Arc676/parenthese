module.exports = {
  apps: [
    {
      name: 'parenthese-api',
      cwd: './backend',
      script: 'dist/server.js',
      node_args: '--enable-source-maps',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
        // nginx relaie vers 127.0.0.1:4000 (deploy/nginx.conf) : l'API n'écoute pas sur les interfaces publiques
        HOST: '127.0.0.1',
        // Instance hébergée app.parenthese.io : invite la famille et la démo à créer leur arbre (SIGNUP_PROMPTS,
        // éteint par défaut en auto-hébergement)
        SIGNUP_PROMPTS: 'true',
      },
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
}
