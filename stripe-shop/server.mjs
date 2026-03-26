import dotenv from 'dotenv';
import app from './app.mjs';

dotenv.config();

const PORT = parseInt(process.env.PORT || '8787', 10);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[stripe-shop] listening on :${PORT}`);
});

