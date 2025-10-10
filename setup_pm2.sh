#!/bin/bash
npm install -g pm2
pm2 start server.js --name spotalert
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu
