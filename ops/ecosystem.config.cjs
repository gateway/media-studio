const cwd = process.env.MEDIA_STUDIO_ROOT || process.cwd();

module.exports = {
  apps: [
    {
      name: "media-studio-api",
      cwd,
      script: "./scripts/start_api.sh",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      env: {
        NODE_ENV: "production",
        MEDIA_STUDIO_SUPERVISOR: "pm2",
      },
    },
    {
      name: "media-studio-web",
      cwd,
      script: "npm",
      args: "run start:web",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        MEDIA_STUDIO_SUPERVISOR: "pm2",
      },
    },
  ],
};
