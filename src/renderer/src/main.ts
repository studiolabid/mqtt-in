import './assets/main.css'
import 'vue-sonner/style.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initApp } from './app/bootstrap'
import { installNavigationRecovery } from './app/navigation-recovery'
import { router } from './router'

async function start(): Promise<void> {
  const app = createApp(App)
  app.config.errorHandler = (err, _instance, info) => {
    console.error(`[mqtt-in] unhandled error (${info}):`, err)
  }
  app.use(createPinia())
  // Before the router starts its first navigation (a failed chunk must not leave a blank window).
  installNavigationRecovery(router)
  app.use(router)
  try {
    await initApp(router)
  } finally {
    app.mount('#app')
  }
}

void start()
