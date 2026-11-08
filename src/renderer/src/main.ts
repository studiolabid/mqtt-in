import './assets/main.css'
import 'vue-sonner/style.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initApp } from './app/bootstrap'
import { router } from './router'

async function start(): Promise<void> {
  const app = createApp(App)
  app.config.errorHandler = (err, _instance, info) => {
    console.error(`[mqtt-in] unhandled error (${info}):`, err)
  }
  app.use(createPinia())
  app.use(router)
  try {
    await initApp(router)
  } finally {
    app.mount('#app')
  }
}

void start()
