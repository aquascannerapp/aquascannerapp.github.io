module.exports = {
  apps : [{
    name   : "AquaScannerApp",
    script : "server.js",
watch: false,
      autorestart: false, 
    env: {
      NODE_ENV: "production",
      PORT: 5050
    }
  }]
}