import dotenv from 'dotenv';
import { app } from './app.js';

dotenv.config();

const port = process.env.PORT || 3333;

app.listen(port, () => {
  console.log(`API disponível em http://localhost:${port}`);
});
