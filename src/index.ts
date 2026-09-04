import { config, validateProductionConfig } from './config.js';
import { createApp } from './app.js';
import { createNotifier } from './notify.js';
import { loadSigner } from './signing.js';
import { createStore } from './store/index.js';

validateProductionConfig();
const signer = loadSigner();
const store = createStore(signer);
const notifier = createNotifier();
const app = createApp(store, notifier);

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`doof listening on :${config.port} (${config.store} store, notices ${config.resendApiKey ? 'via Resend' : 'to stdout'}, signing kid ${signer.kid})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      store.close().finally(() => process.exit(0));
    });
  });
}
