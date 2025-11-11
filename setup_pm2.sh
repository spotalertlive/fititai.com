#!/bin/bash
# ===========================================
# SpotAlert AWS PM2 Auto-Setup Script (Final)
# ===========================================

echo "🚀 Starting SpotAlert backend setup..."

# Navigate to app folder (adjust path if needed)
cd ~/spotalertlive || exit

# Update & install Node dependencies
sudo apt update -y
sudo apt install -y nodejs npm sqlite3

# Install PM2 globally
sudo npm install -g pm2

# Install project dependencies
npm install

# Create uploads folder if not exists
mkdir -p uploads

# Export environment variables
if [ -f "final.env" ]; then
  export $(grep -v '^#' final.env | xargs)
fi

# Start app with PM2
pm2 start server.js --name "spotalert" --env production

# Save PM2 process list & enable startup on reboot
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo "✅ SpotAlert successfully started and set to run on boot."
echo "🌐 Access your API at: http://api.spotalert.live or http://<your-public-ip>:3000"
