const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const express = require('express');
const path = require('path');
const fs = require('fs');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express();

  // Root for Admin Portal
  const adminDist = path.join(__dirname, '../tenx-frontend/admin-portal/dist');
  if (fs.existsSync(adminDist)) {
    server.use('/admin', express.static(adminDist));
    server.get('/admin/*', (req, res) => {
      res.sendFile(path.join(adminDist, 'index.html'));
    });
  }

  // Root for Consultant Portal
  const consultantDist = path.join(__dirname, '../tenx-frontend/consultant-portal/dist');
  if (fs.existsSync(consultantDist)) {
    server.use('/consultant', express.static(consultantDist));
    server.get('/consultant/*', (req, res) => {
      res.sendFile(path.join(consultantDist, 'index.html'));
    });
  }

  // Root for User Portal (as default)
  const userDist = path.join(__dirname, '../tenx-frontend/user-portal/dist');
  if (fs.existsSync(userDist)) {
    server.use('/user', express.static(userDist));
    // Also serve user portal at root if no other route matches and it's not a Next.js route
    server.get('/user/*', (req, res) => {
      res.sendFile(path.join(userDist, 'index.html'));
    });
  }

  // All other requests handled by Next.js
  server.all('*', (req, res) => {
    return handle(req, res);
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
