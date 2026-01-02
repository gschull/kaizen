const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API endpoint to save data (stores in localStorage on client side)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'kaiZEN is running!' });
});

// Serve the main app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🌱 kaiZEN running at http://localhost:${PORT}`);
  console.log(`   Press Ctrl+C to stop the server`);
});
