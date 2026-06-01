import express from 'express';
import { runIndexer } from './indexer';
import apiRouter from './api';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API Layer
app.use('/api/v1', apiRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Indexer microservice API listening on port ${PORT}`);
  
  // Start the indexer background process
  runIndexer().catch(err => {
    console.error('Fatal indexer error:', err);
    process.exit(1);
  });
});
