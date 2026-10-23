import dotenv from 'dotenv';
import { app } from './app.js';

dotenv.config();

const port = process.env.PORT || 3333;

app.listen(port, process.env.BIND_HOST || '127.0.0.1', () => {
  console.log(`API disponível em http://localhost:${port}`);
});
